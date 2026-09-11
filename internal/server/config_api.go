package server

import (
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"javboss/internal/common/logging"
	dbpkg "javboss/internal/db"
	"javboss/internal/mpv"
	"javboss/internal/runtimeconfig"
	"javboss/internal/util"
)

const maxPageSize = 500
const maxJavDisplayRows = 12
const maxJavSortRules = 50

var validWebHotkeyActions = map[string]struct{}{
	"content_page_up":        {},
	"content_page_down":      {},
	"continuous_scroll_up":   {},
	"continuous_scroll_down": {},
	"edit_jav_query":         {},
	"open_page_jump":         {},
	"previous_page":          {},
	"next_page":              {},
	"browser_back":           {},
	"browser_forward":        {},
}

type javSortRule struct {
	ID      string   `json:"id"`
	Enabled bool     `json:"enabled"`
	Mode    string   `json:"mode"`
	Active  []string `json:"active"`
	Sort    string   `json:"sort"`
}

type javSortRulesConfig struct {
	Version int           `json:"version"`
	Rules   []javSortRule `json:"rules"`
}

var javSortRuleFilterOrder = map[string]int{
	"search": 0, "idol": 1, "tag": 2, "studio": 3, "series": 4,
	"prefix": 5, "solo": 6, "favorite_rating": 7, "favorite_group": 8,
}

var validJavSortValues = map[string]struct{}{
	"recent": {}, "recent_asc": {}, "code": {}, "code_desc": {},
	"duration": {}, "duration_asc": {}, "release": {}, "release_asc": {},
	"play_count": {}, "play_count_asc": {}, "favorite_rating": {}, "favorite_rating_asc": {},
}

func getConfig(c *gin.Context) {
	cfg, err := dbpkg.ListConfig(c.Request.Context())
	if err != nil {
		logging.Error("list config error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "加载配置失败", "Failed to load configuration")
		return
	}
	applyRuntimeConfigFields(cfg, c.Request.RemoteAddr)
	c.JSON(http.StatusOK, cfg)
}

func updateConfig(c *gin.Context) {
	type playerHotkeyPayload struct {
		Key    string  `json:"key"`
		Action string  `json:"action"`
		Amount float64 `json:"amount"`
	}
	type webHotkeyPayload struct {
		Key    string `json:"key"`
		Action string `json:"action"`
	}

	var req struct {
		VideoPageSize          *int                  `json:"video_page_size"`
		VideoWaterfallDefault  *bool                 `json:"video_waterfall_default"`
		JavPageSize            *int                  `json:"jav_page_size"`
		JavGridColumns         *int                  `json:"jav_grid_columns"`
		JavTitleMaxRows        *int                  `json:"jav_title_max_rows"`
		JavIdolTagMaxRows      *int                  `json:"jav_idol_tag_max_rows"`
		JavTagMaxRows          *int                  `json:"jav_tag_max_rows"`
		JavHideSeries          *bool                 `json:"jav_hide_series"`
		JavHideIdols           *bool                 `json:"jav_hide_idols"`
		JavHideTags            *bool                 `json:"jav_hide_tags"`
		JavHideActions         *bool                 `json:"jav_hide_actions"`
		JavFavoriteRatingFull  *bool                 `json:"jav_favorite_rating_show_full"`
		JavWaterfallDefault    *bool                 `json:"jav_waterfall_default"`
		IdolPageSize           *int                  `json:"idol_page_size"`
		IdolWaterfallDefault   *bool                 `json:"idol_waterfall_default"`
		StudioPageSize         *int                  `json:"studio_page_size"`
		StudioWaterfallDefault *bool                 `json:"studio_waterfall_default"`
		SeriesPageSize         *int                  `json:"series_page_size"`
		SeriesWaterfallDefault *bool                 `json:"series_waterfall_default"`
		VideoHideJav           *bool                 `json:"video_hide_jav"`
		VideoSort              string                `json:"video_sort"`
		JavSort                string                `json:"jav_sort"`
		JavSortRules           *javSortRulesConfig   `json:"jav_sort_rules"`
		IdolSort               string                `json:"idol_sort"`
		JavIdolPreferChinese   *bool                 `json:"jav_idol_prefer_chinese_name"`
		JavTagShowSimplified   *bool                 `json:"jav_tag_show_simplified"`
		DefaultPlayer          string                `json:"default_player"`
		InitialViewMode        string                `json:"initial_view_mode"`
		AllowLANAccess         *bool                 `json:"allow_lan_access"`
		ProxyHost              *string               `json:"proxy_host"`
		ProxyPort              *int                  `json:"proxy_port"`
		PlayerWindowSize       *int                  `json:"player_window_size"`
		PlayerWindowWidth      *int                  `json:"player_window_width"`
		PlayerWindowHeight     *int                  `json:"player_window_height"`
		PlayerVolume           *int                  `json:"player_volume"`
		PlayerOntop            *bool                 `json:"player_ontop"`
		PlayerReuseWindow      *bool                 `json:"player_reuse_window"`
		PlayerResumePlayback   *bool                 `json:"player_resume_playback"`
		PlayerShowHotkeyHint   *bool                 `json:"player_show_hotkey_hint"`
		BrowserShowHotkeyHint  *bool                 `json:"browser_player_show_hotkey_hint"`
		PlayerHotkeys          []playerHotkeyPayload `json:"player_hotkeys"`
		WebHotkeys             []webHotkeyPayload    `json:"web_hotkeys"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "配置请求无效", "Invalid configuration request")
		return
	}

	entries := make(map[string]string)
	clampSize := func(n int) (string, bool) {
		if n <= 0 {
			return "", false
		}
		if n > maxPageSize {
			n = maxPageSize
		}
		return strconv.Itoa(n), true
	}

	if req.VideoPageSize != nil {
		if v, ok := clampSize(*req.VideoPageSize); ok {
			entries["video_page_size"] = v
		}
	}
	if req.VideoWaterfallDefault != nil {
		entries["video_waterfall_default"] = strconv.FormatBool(*req.VideoWaterfallDefault)
	}
	if req.JavPageSize != nil {
		if v, ok := clampSize(*req.JavPageSize); ok {
			entries["jav_page_size"] = v
		}
	}
	if req.JavGridColumns != nil {
		columns := *req.JavGridColumns
		if columns < 0 {
			columns = 0
		}
		if columns > 12 {
			columns = 12
		}
		entries["jav_grid_columns"] = strconv.Itoa(columns)
	}
	if req.JavTitleMaxRows != nil {
		rows := *req.JavTitleMaxRows
		if rows < 0 {
			rows = 0
		}
		if rows > maxJavDisplayRows {
			rows = maxJavDisplayRows
		}
		entries["jav_title_max_rows"] = strconv.Itoa(rows)
	}
	if req.JavIdolTagMaxRows != nil {
		rows := *req.JavIdolTagMaxRows
		if rows < 0 {
			rows = 0
		}
		if rows > maxJavDisplayRows {
			rows = maxJavDisplayRows
		}
		entries["jav_idol_tag_max_rows"] = strconv.Itoa(rows)
	}
	if req.JavTagMaxRows != nil {
		rows := *req.JavTagMaxRows
		if rows < 0 {
			rows = 0
		}
		if rows > maxJavDisplayRows {
			rows = maxJavDisplayRows
		}
		entries["jav_tag_max_rows"] = strconv.Itoa(rows)
	}
	if req.JavHideSeries != nil {
		entries["jav_hide_series"] = strconv.FormatBool(*req.JavHideSeries)
	}
	if req.JavHideIdols != nil {
		entries["jav_hide_idols"] = strconv.FormatBool(*req.JavHideIdols)
	}
	if req.JavHideTags != nil {
		entries["jav_hide_tags"] = strconv.FormatBool(*req.JavHideTags)
	}
	if req.JavHideActions != nil {
		entries["jav_hide_actions"] = strconv.FormatBool(*req.JavHideActions)
	}
	if req.JavFavoriteRatingFull != nil {
		entries["jav_favorite_rating_show_full"] = strconv.FormatBool(*req.JavFavoriteRatingFull)
	}
	if req.JavWaterfallDefault != nil {
		entries["jav_waterfall_default"] = strconv.FormatBool(*req.JavWaterfallDefault)
	}
	if req.IdolPageSize != nil {
		if v, ok := clampSize(*req.IdolPageSize); ok {
			entries["idol_page_size"] = v
		}
	}
	if req.IdolWaterfallDefault != nil {
		entries["idol_waterfall_default"] = strconv.FormatBool(*req.IdolWaterfallDefault)
	}
	if req.StudioPageSize != nil {
		if v, ok := clampSize(*req.StudioPageSize); ok {
			entries["studio_page_size"] = v
		}
	}
	if req.StudioWaterfallDefault != nil {
		entries["studio_waterfall_default"] = strconv.FormatBool(*req.StudioWaterfallDefault)
	}
	if req.SeriesPageSize != nil {
		if v, ok := clampSize(*req.SeriesPageSize); ok {
			entries["series_page_size"] = v
		}
	}
	if req.SeriesWaterfallDefault != nil {
		entries["series_waterfall_default"] = strconv.FormatBool(*req.SeriesWaterfallDefault)
	}
	if req.VideoHideJav != nil {
		entries["video_hide_jav"] = strconv.FormatBool(*req.VideoHideJav)
	}
	if s := strings.ToLower(strings.TrimSpace(req.VideoSort)); s != "" {
		switch s {
		case "recent", "recent_asc", "filename", "filename_desc", "duration", "duration_asc", "play_count", "play_count_asc":
			entries["video_sort"] = s
		default:
			// ignore invalid values
		}
	}
	if s := strings.ToLower(strings.TrimSpace(req.JavSort)); s != "" {
		if _, ok := validJavSortValues[s]; ok {
			entries["jav_sort"] = s
		} else {
			// ignore invalid values
		}
	}
	if req.JavSortRules != nil {
		clean, ok := normalizeJavSortRulesConfig(*req.JavSortRules)
		if !ok {
			respondLocalizedError(c, http.StatusBadRequest, "JAV 排序规则无效", "Invalid JAV sort rules")
			return
		}
		raw, err := json.Marshal(clean)
		if err != nil {
			respondLocalizedError(c, http.StatusInternalServerError, "保存 JAV 排序规则失败", "Failed to save JAV sort rules")
			return
		}
		entries["jav_sort_rules"] = string(raw)
	}
	if s := strings.ToLower(strings.TrimSpace(req.IdolSort)); s != "" {
		switch s {
		case "recent", "recent_asc", "work", "work_asc", "birth", "birth_asc", "height", "height_desc", "bust", "bust_asc", "hips", "hips_asc", "waist", "waist_desc", "measurements", "cup", "cup_asc":
			entries["idol_sort"] = s
		default:
			// ignore invalid values
		}
	}
	if req.JavIdolPreferChinese != nil {
		entries["jav_idol_prefer_chinese_name"] = strconv.FormatBool(*req.JavIdolPreferChinese)
	}
	if req.JavTagShowSimplified != nil {
		entries["jav_tag_show_simplified"] = strconv.FormatBool(*req.JavTagShowSimplified)
	}
	if s := strings.ToLower(strings.TrimSpace(req.DefaultPlayer)); s != "" {
		switch s {
		case "browser", "mpv", "system":
			entries["default_player"] = s
		default:
			respondLocalizedError(c, http.StatusBadRequest, "默认播放器无效", "Invalid default player")
			return
		}
	}
	if s := strings.ToLower(strings.TrimSpace(req.InitialViewMode)); s != "" {
		switch s {
		case "video", "jav":
			entries["initial_view_mode"] = s
		default:
			respondLocalizedError(c, http.StatusBadRequest, "初始页面模式无效", "Invalid initial page mode")
			return
		}
	}
	if req.AllowLANAccess != nil {
		entries["allow_lan_access"] = strconv.FormatBool(*req.AllowLANAccess)
	}
	if req.ProxyPort != nil {
		port := *req.ProxyPort
		if port <= 0 {
			entries["proxy_port"] = ""
		} else if port <= 65535 {
			entries["proxy_port"] = strconv.Itoa(port)
		} else {
			respondLocalizedError(c, http.StatusBadRequest, "代理端口必须在 1-65535 之间", "Proxy port must be between 1 and 65535")
			return
		}
	}
	if req.ProxyHost != nil {
		host := strings.TrimSpace(*req.ProxyHost)
		if host == "" {
			entries["proxy_host"] = ""
		} else if cleanHost, ok := normalizeProxyHost(host); ok {
			entries["proxy_host"] = cleanHost
		} else {
			respondLocalizedError(c, http.StatusBadRequest, "代理主机无效", "Invalid proxy host")
			return
		}
	}
	if req.PlayerWindowSize != nil {
		size := *req.PlayerWindowSize
		if size < 10 || size > 100 {
			respondLocalizedError(c, http.StatusBadRequest, "播放器窗口大小必须在 10-100 之间", "Player window size must be between 10 and 100")
			return
		}
		entries["player_window_size"] = strconv.Itoa(size)
	}
	if req.PlayerWindowWidth != nil {
		width := *req.PlayerWindowWidth
		if width < 10 || width > 100 {
			respondLocalizedError(c, http.StatusBadRequest, "播放器窗口宽度必须在 10-100 之间", "Player window width must be between 10 and 100")
			return
		}
		entries["player_window_width"] = strconv.Itoa(width)
	}
	if req.PlayerWindowHeight != nil {
		height := *req.PlayerWindowHeight
		if height < 10 || height > 100 {
			respondLocalizedError(c, http.StatusBadRequest, "播放器窗口高度必须在 10-100 之间", "Player window height must be between 10 and 100")
			return
		}
		entries["player_window_height"] = strconv.Itoa(height)
	}
	if req.PlayerVolume != nil {
		volume := *req.PlayerVolume
		if volume < 0 || volume > 130 {
			respondLocalizedError(c, http.StatusBadRequest, "播放器音量必须在 0-130 之间", "Player volume must be between 0 and 130")
			return
		}
		entries["player_volume"] = strconv.Itoa(volume)
	}
	if req.PlayerOntop != nil {
		entries["player_ontop"] = strconv.FormatBool(*req.PlayerOntop)
	}
	if req.PlayerReuseWindow != nil {
		entries["player_reuse_window"] = strconv.FormatBool(*req.PlayerReuseWindow)
	}
	if req.PlayerResumePlayback != nil {
		entries["player_resume_playback"] = strconv.FormatBool(*req.PlayerResumePlayback)
	}
	if req.PlayerShowHotkeyHint != nil {
		entries["player_show_hotkey_hint"] = strconv.FormatBool(*req.PlayerShowHotkeyHint)
	}
	if req.BrowserShowHotkeyHint != nil {
		entries["browser_player_show_hotkey_hint"] = strconv.FormatBool(*req.BrowserShowHotkeyHint)
	}
	if req.PlayerHotkeys != nil {
		clean := make([]playerHotkeyPayload, 0, len(req.PlayerHotkeys))
		seen := make(map[string]struct{}, len(req.PlayerHotkeys))
		for _, item := range req.PlayerHotkeys {
			key := strings.TrimSpace(item.Key)
			action := strings.ToLower(strings.TrimSpace(item.Action))
			if len(key) == 1 {
				key = strings.ToLower(key)
			}
			if key == "" {
				respondLocalizedError(c, http.StatusBadRequest, "播放器快捷键不能为空", "Player hotkey key is required")
				return
			}
			if key == " " || strings.EqualFold(key, "spacebar") || strings.EqualFold(key, "escape") {
				respondLocalizedError(c, http.StatusBadRequest, "Space 和 Escape 是保留按键", "Space and Escape are reserved")
				return
			}
			if _, ok := seen[key]; ok {
				respondLocalizedError(c, http.StatusBadRequest, "播放器快捷键重复", "Duplicate player hotkeys")
				return
			}
			if action != "seek" && action != "volume" && action != "screenshot" {
				respondLocalizedError(c, http.StatusBadRequest, "播放器快捷键动作无效", "Invalid player hotkey action")
				return
			}
			if action != "screenshot" && item.Amount == 0 {
				respondLocalizedError(c, http.StatusBadRequest, "播放器快捷键数值不能为空", "Player hotkey amount is required")
				return
			}
			if action == "volume" && (item.Amount < -100 || item.Amount > 100) {
				respondLocalizedError(c, http.StatusBadRequest, "音量快捷键数值必须在 -100 到 100 之间", "Player volume hotkey amount must be between -100 and 100")
				return
			}
			seen[key] = struct{}{}
			clean = append(clean, playerHotkeyPayload{
				Key:    key,
				Action: action,
				Amount: normalizedPlayerHotkeyAmount(action, item.Amount),
			})
		}
		raw, err := json.Marshal(clean)
		if err != nil {
			respondLocalizedError(c, http.StatusInternalServerError, "保存播放器快捷键失败", "Failed to save player hotkeys")
			return
		}
		entries["player_hotkeys"] = string(raw)
	}
	if req.WebHotkeys != nil {
		if len(req.WebHotkeys) != len(validWebHotkeyActions) {
			respondLocalizedError(c, http.StatusBadRequest, "网页快捷键配置不完整", "Incomplete web shortcut configuration")
			return
		}
		clean := make([]webHotkeyPayload, 0, len(req.WebHotkeys))
		seenActions := make(map[string]struct{}, len(req.WebHotkeys))
		seenKeys := make(map[string]struct{}, len(req.WebHotkeys))
		for _, item := range req.WebHotkeys {
			action := strings.ToLower(strings.TrimSpace(item.Action))
			if _, ok := validWebHotkeyActions[action]; !ok {
				respondLocalizedError(c, http.StatusBadRequest, "网页快捷键动作无效", "Invalid web shortcut action")
				return
			}
			if _, ok := seenActions[action]; ok {
				respondLocalizedError(c, http.StatusBadRequest, "网页快捷键动作重复", "Duplicate web shortcut actions")
				return
			}

			key := strings.TrimSpace(item.Key)
			if utf8.RuneCountInString(key) > 32 {
				respondLocalizedError(c, http.StatusBadRequest, "网页快捷键按键无效", "Invalid web shortcut key")
				return
			}
			shifted := false
			if strings.HasPrefix(strings.ToLower(key), "shift+") {
				shifted = true
				key = strings.TrimSpace(key[len("shift+"):])
			}
			if strings.Contains(key, "+") && key != "+" {
				respondLocalizedError(c, http.StatusBadRequest, "网页快捷键组合无效", "Invalid web shortcut combination")
				return
			}
			if utf8.RuneCountInString(key) == 1 {
				key = strings.ToLower(key)
			}
			if key == "" {
				respondLocalizedError(c, http.StatusBadRequest, "网页快捷键按键无效", "Invalid web shortcut key")
				return
			}
			switch strings.ToLower(key) {
			case "alt", "control", "meta", "shift", "escape", "tab":
				respondLocalizedError(c, http.StatusBadRequest, "该按键不能用作网页快捷键", "That key cannot be used as a web shortcut")
				return
			}
			if shifted {
				key = "Shift+" + key
			}
			keyID := strings.ToLower(key)
			if _, ok := seenKeys[keyID]; ok {
				respondLocalizedError(c, http.StatusBadRequest, "网页快捷键重复", "Duplicate web shortcuts")
				return
			}
			seenActions[action] = struct{}{}
			seenKeys[keyID] = struct{}{}
			clean = append(clean, webHotkeyPayload{Key: key, Action: action})
		}
		raw, err := json.Marshal(clean)
		if err != nil {
			respondLocalizedError(c, http.StatusInternalServerError, "保存网页快捷键失败", "Failed to save web shortcuts")
			return
		}
		entries["web_hotkeys"] = string(raw)
	}

	if err := dbpkg.UpsertConfig(c.Request.Context(), entries); err != nil {
		logging.Error("update config error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "保存配置失败", "Failed to save configuration")
		return
	}
	playerSessionResetNeeded := false
	if req.PlayerHotkeys != nil {
		mpv.InvalidateHotkeysCache()
		playerSessionResetNeeded = true
	}
	if req.PlayerReuseWindow != nil {
		mpv.InvalidateHotkeysCache()
		playerSessionResetNeeded = true
	}
	if req.PlayerResumePlayback != nil {
		mpv.InvalidateHotkeysCache()
		playerSessionResetNeeded = true
	}
	if req.PlayerWindowSize != nil ||
		req.PlayerWindowWidth != nil ||
		req.PlayerWindowHeight != nil ||
		req.PlayerVolume != nil ||
		req.PlayerOntop != nil ||
		req.PlayerReuseWindow != nil ||
		req.PlayerResumePlayback != nil {
		mpv.InvalidatePlayerConfigCache()
		playerSessionResetNeeded = true
	}
	if req.PlayerShowHotkeyHint != nil {
		playerSessionResetNeeded = true
	}
	if playerSessionResetNeeded {
		mpv.ResetPlayerSession()
	}

	cfg, err := dbpkg.ListConfig(c.Request.Context())
	if err != nil {
		logging.Error("list config after update error: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "读取已保存的配置失败", "Failed to load the saved configuration")
		return
	}
	util.SetProxyFromStrings(cfg["proxy_host"], cfg["proxy_port"])
	applyRuntimeConfigFields(cfg, c.Request.RemoteAddr)
	c.JSON(http.StatusOK, cfg)
}

func applyRuntimeConfigFields(cfg map[string]string, remoteAddr string) {
	remoteRequest := isRemoteRequest(remoteAddr)
	cfg["runtime_os"] = runtime.GOOS
	cfg["runtime_container"] = strconv.FormatBool(runtimeconfig.ContainerMode())
	cfg["runtime_remote_request"] = strconv.FormatBool(remoteRequest)
	cfg["directory_picker_enabled"] = strconv.FormatBool(!runtimeconfig.DisableDirectoryPicker())
	cfg["desktop_integration_enabled"] = strconv.FormatBool(!runtimeconfig.DisableDesktopIntegration())
	cfg["mpv_enabled"] = strconv.FormatBool(!runtimeconfig.DisableMPVPlayback())
	browserPlaybackOnly := runtimeconfig.DisableMPVPlayback() && runtimeconfig.DisableDesktopIntegration()
	cfg["browser_playback_only"] = strconv.FormatBool(browserPlaybackOnly || remoteRequest)
	cfg["host_path_prefix_enabled"] = strconv.FormatBool(runtimeconfig.HostPathPrefixEnabled())
}

func isRemoteRequest(remoteAddr string) bool {
	host := strings.TrimSpace(remoteAddr)
	if parsedHost, _, err := net.SplitHostPort(host); err == nil {
		host = parsedHost
	}
	host = strings.Trim(host, "[]")
	ip := net.ParseIP(host)
	return ip != nil && !ip.IsLoopback()
}

func normalizeProxyHost(host string) (string, bool) {
	host = strings.TrimSpace(host)
	if host == "" {
		return "", true
	}
	if strings.Contains(host, "://") {
		u, err := url.Parse(host)
		if err != nil || u.Hostname() == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return "", false
		}
		host = u.Hostname()
	}
	if strings.HasPrefix(host, "[") && strings.HasSuffix(host, "]") {
		host = strings.TrimPrefix(strings.TrimSuffix(host, "]"), "[")
	}
	if strings.ContainsAny(host, "/\\?#@ \t\r\n") {
		return "", false
	}
	if strings.Contains(host, ":") && net.ParseIP(host) == nil {
		return "", false
	}
	return host, true
}

func normalizedPlayerHotkeyAmount(action string, amount float64) float64 {
	if action == "screenshot" {
		return 0
	}
	return amount
}

func normalizeJavSortRulesConfig(config javSortRulesConfig) (javSortRulesConfig, bool) {
	if config.Version != 1 || len(config.Rules) > maxJavSortRules {
		return javSortRulesConfig{}, false
	}
	clean := javSortRulesConfig{Version: 1, Rules: make([]javSortRule, 0, len(config.Rules))}
	seenIDs := make(map[string]struct{}, len(config.Rules))
	for _, rule := range config.Rules {
		id := strings.TrimSpace(rule.ID)
		mode := strings.ToLower(strings.TrimSpace(rule.Mode))
		sortValue := strings.ToLower(strings.TrimSpace(rule.Sort))
		if !validJavSortRuleID(id) {
			return javSortRulesConfig{}, false
		}
		switch mode {
		case "all", "contains", "exact":
			mode = "all"
		case "any":
		default:
			return javSortRulesConfig{}, false
		}
		if _, exists := seenIDs[id]; exists {
			return javSortRulesConfig{}, false
		}
		if _, ok := validJavSortValues[sortValue]; !ok {
			return javSortRulesConfig{}, false
		}
		seenFilters := make(map[string]struct{}, len(rule.Active))
		active := make([]string, 0, len(rule.Active))
		for _, rawFilter := range rule.Active {
			filter := strings.ToLower(strings.TrimSpace(rawFilter))
			if _, ok := javSortRuleFilterOrder[filter]; !ok {
				return javSortRulesConfig{}, false
			}
			if _, exists := seenFilters[filter]; exists {
				return javSortRulesConfig{}, false
			}
			seenFilters[filter] = struct{}{}
			active = append(active, filter)
		}
		sort.Slice(active, func(i, j int) bool {
			return javSortRuleFilterOrder[active[i]] < javSortRuleFilterOrder[active[j]]
		})
		seenIDs[id] = struct{}{}
		clean.Rules = append(clean.Rules, javSortRule{
			ID: id, Enabled: rule.Enabled, Mode: mode, Active: active, Sort: sortValue,
		})
	}
	return clean, true
}

func validJavSortRuleID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, char := range id {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') || char == '-' || char == '_' {
			continue
		}
		return false
	}
	return true
}
