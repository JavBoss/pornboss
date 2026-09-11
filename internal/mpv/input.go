package mpv

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"

	"javboss/internal/common"
	"javboss/internal/common/logging"
	dbpkg "javboss/internal/db"
)

const playerHotkeysConfigKey = "player_hotkeys"
const playerWindowSizeConfigKey = "player_window_size"
const playerWindowWidthConfigKey = "player_window_width"
const playerWindowHeightConfigKey = "player_window_height"
const playerVolumeConfigKey = "player_volume"
const playerOntopConfigKey = "player_ontop"
const playerReuseWindowConfigKey = "player_reuse_window"
const playerResumePlaybackConfigKey = "player_resume_playback"
const playerShowHotkeyHintConfigKey = "player_show_hotkey_hint"

const (
	defaultWindowWidth  = 80
	defaultWindowHeight = 80
	defaultVolume       = 70
	defaultOntop        = false
	defaultReuseWindow  = true
	defaultResume       = true
	startupHintDuration = 5000
)

type hotkeyConfig struct {
	Key    string  `json:"key"`
	Action string  `json:"action"`
	Amount float64 `json:"amount"`
}

var defaultHotkeys = []hotkeyConfig{
	{Key: "a", Action: "seek", Amount: -1},
	{Key: "z", Action: "seek", Amount: 1},
	{Key: "s", Action: "seek", Amount: -5},
	{Key: "x", Action: "seek", Amount: 5},
	{Key: "d", Action: "seek", Amount: -30},
	{Key: "c", Action: "seek", Amount: 30},
	{Key: "f", Action: "seek", Amount: -300},
	{Key: "v", Action: "seek", Amount: 300},
	{Key: "q", Action: "volume", Amount: -5},
	{Key: "w", Action: "volume", Amount: 5},
	{Key: "e", Action: "screenshot", Amount: 0},
}

var (
	inputConfMu      sync.Mutex
	inputConfPath    string
	inputConfContent string
	inputConfReady   bool

	configMu      sync.Mutex
	configPath    string
	configContent string
	configReady   bool

	playerConfigProviderMu sync.RWMutex
	playerConfigProvider   func() (map[string]string, error)
)

// SetPlayerConfigProvider overrides player configuration loading. It is used by
// the standalone client mode, which intentionally does not open the server DB.
// Passing nil restores the default DB-backed behavior.
func SetPlayerConfigProvider(provider func() (map[string]string, error)) {
	playerConfigProviderMu.Lock()
	playerConfigProvider = provider
	playerConfigProviderMu.Unlock()
	InvalidateHotkeysCache()
	InvalidatePlayerConfigCache()
}

func loadPlayerConfig() (map[string]string, error) {
	playerConfigProviderMu.RLock()
	provider := playerConfigProvider
	playerConfigProviderMu.RUnlock()
	if provider != nil {
		return provider()
	}
	if common.DB == nil {
		return nil, nil
	}
	return dbpkg.ListConfig(context.Background())
}

func InvalidateHotkeysCache() {
	inputConfMu.Lock()
	defer inputConfMu.Unlock()

	inputConfContent = ""
	inputConfReady = false
}

func InvalidatePlayerConfigCache() {
	configMu.Lock()
	defer configMu.Unlock()

	configContent = ""
	configReady = false
}

func ensureInputConf() (string, error) {
	inputConfMu.Lock()
	defer inputConfMu.Unlock()

	if inputConfPath == "" {
		path, err := sessionPath("mpv-input.conf")
		if err != nil {
			return "", err
		}
		inputConfPath = path
	}

	if inputConfReady {
		if _, err := os.Stat(inputConfPath); err == nil {
			return inputConfPath, nil
		}
		if err := os.WriteFile(inputConfPath, []byte(inputConfContent), 0o644); err != nil {
			return "", fmt.Errorf("restore mpv input conf: %w", err)
		}
		return inputConfPath, nil
	}

	return writeInputConf()
}

func writeInputConf() (string, error) {
	content, err := buildInputConfContent()
	if err != nil {
		return "", err
	}

	if err := os.WriteFile(inputConfPath, []byte(content), 0o644); err != nil {
		return "", fmt.Errorf("write mpv input conf: %w", err)
	}

	inputConfContent = content
	inputConfReady = true

	return inputConfPath, nil
}

func buildInputConfContent() (string, error) {
	hotkeys, err := loadConfiguredHotkeys()
	if err != nil {
		return "", err
	}

	var lines []string
	for _, item := range hotkeys {
		keyName, ok := keyName(item.Key)
		if !ok {
			continue
		}

		switch item.Action {
		case "seek":
			lines = append(lines, fmt.Sprintf("%s no-osd seek %s exact", keyName, formatAmount(item.Amount)))
		case "volume":
			lines = append(lines, fmt.Sprintf("%s no-osd add volume %s", keyName, formatAmount(item.Amount)))
		case "screenshot":
			lines = append(lines, fmt.Sprintf("%s screenshot", keyName))
		}
	}

	lines = append(lines, "SPACE cycle pause")
	lines = append(lines, buildEscapeHotkeyBinding())
	return strings.Join(lines, "\n") + "\n", nil
}

func buildEscapeHotkeyBinding() string {
	if loadConfiguredPlayerReuseWindow() {
		restoreFocusCommand := buildFocusRestoreCommand()
		restoreFocusSuffix := ""
		if restoreFocusCommand != "" {
			restoreFocusSuffix = "; " + restoreFocusCommand
		}
		if loadConfiguredPlayerResumePlayback() {
			return "ESC write-watch-later-config; stop; set window-minimized yes" + restoreFocusSuffix
		}
		return "ESC stop; set window-minimized yes" + restoreFocusSuffix
	}
	return "ESC quit"
}

func buildStartupHotkeyHint() (string, error) {
	showHint, err := loadConfiguredPlayerShowHotkeyHint()
	if err != nil {
		return "", err
	}
	if !showHint {
		return "", nil
	}

	hotkeys, err := loadConfiguredHotkeys()
	if err != nil {
		return "", err
	}

	parts := make([]string, 0, len(hotkeys)+2)
	for _, item := range hotkeys {
		keyName, ok := keyName(item.Key)
		if !ok {
			continue
		}
		switch item.Action {
		case "seek":
			parts = append(parts, fmt.Sprintf("%s：进度 %s 秒", keyName, formatSignedAmount(item.Amount)))
		case "volume":
			parts = append(parts, fmt.Sprintf("%s：音量 %s%%", keyName, formatSignedAmount(item.Amount)))
		case "screenshot":
			parts = append(parts, fmt.Sprintf("%s：截图", keyName))
		}
	}
	parts = append(parts, "空格：暂停/继续")
	parts = append(parts, buildEscapeHotkeyHint())
	parts = append(parts, "你可在「设置 → 播放器 → MPV播放器」里关闭此信息显示")
	return strings.Join(parts, "\n"), nil
}

func buildEscapeHotkeyHint() string {
	if loadConfiguredPlayerReuseWindow() {
		return "ESC：停止播放并最小化"
	}
	return "ESC：退出播放器"
}

func loadConfiguredHotkeys() ([]hotkeyConfig, error) {
	cfg, err := loadPlayerConfig()
	if err != nil {
		logging.Error("list player_hotkeys config failed, using defaults: %v", err)
		return cloneDefaultHotkeys(), nil
	}

	raw := strings.TrimSpace(cfg[playerHotkeysConfigKey])
	if raw == "" {
		return cloneDefaultHotkeys(), nil
	}

	var parsed []hotkeyConfig
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		logging.Error("parse player_hotkeys config failed, using defaults: %v", err)
		return cloneDefaultHotkeys(), nil
	}

	return normalizeHotkeys(parsed), nil
}

func cloneDefaultHotkeys() []hotkeyConfig {
	items := make([]hotkeyConfig, len(defaultHotkeys))
	copy(items, defaultHotkeys)
	return items
}

func normalizeHotkeys(items []hotkeyConfig) []hotkeyConfig {
	if len(items) == 0 {
		return nil
	}

	normalized := make([]hotkeyConfig, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		key := normalizeHotkeyKey(item.Key)
		if key == "" || key == " " || strings.EqualFold(key, "Escape") {
			continue
		}

		action := strings.ToLower(strings.TrimSpace(item.Action))
		if action != "seek" && action != "volume" && action != "screenshot" {
			continue
		}
		if action != "screenshot" && item.Amount == 0 {
			continue
		}
		if action == "volume" && (item.Amount < -100 || item.Amount > 100) {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		if _, ok := keyName(key); !ok {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, hotkeyConfig{
			Key:    key,
			Action: action,
			Amount: normalizedHotkeyAmount(action, item.Amount),
		})
	}

	return normalized
}

func normalizedHotkeyAmount(action string, amount float64) float64 {
	if action == "screenshot" {
		return 0
	}
	return amount
}

func normalizeHotkeyKey(raw string) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return ""
	}
	if len(text) == 1 {
		return strings.ToLower(text)
	}
	if text == "Esc" {
		return "Escape"
	}
	if text == "Spacebar" {
		return " "
	}
	return text
}

func keyName(key string) (string, bool) {
	normalized := normalizeHotkeyKey(key)
	if normalized == "" || normalized == " " || strings.EqualFold(normalized, "Escape") {
		return "", false
	}
	if len(normalized) == 1 {
		return normalized, true
	}

	switch normalized {
	case "ArrowLeft":
		return "LEFT", true
	case "ArrowRight":
		return "RIGHT", true
	case "ArrowUp":
		return "UP", true
	case "ArrowDown":
		return "DOWN", true
	case "Enter":
		return "ENTER", true
	case "Backspace":
		return "BS", true
	case "Delete":
		return "DEL", true
	case "Insert":
		return "INS", true
	case "Home":
		return "HOME", true
	case "End":
		return "END", true
	case "PageUp":
		return "PGUP", true
	case "PageDown":
		return "PGDWN", true
	default:
		if strings.HasPrefix(normalized, "F") {
			n, err := strconv.Atoi(normalized[1:])
			if err == nil && n >= 1 && n <= 12 {
				return normalized, true
			}
		}
		return "", false
	}
}

func formatAmount(amount float64) string {
	return strconv.FormatFloat(amount, 'f', -1, 64)
}

func formatSignedAmount(amount float64) string {
	if amount > 0 {
		return "+" + formatAmount(amount)
	}
	return formatAmount(amount)
}

func ensureConfig() (string, error) {
	configMu.Lock()
	defer configMu.Unlock()

	if configPath == "" {
		path, err := sessionPath("mpv.conf")
		if err != nil {
			return "", err
		}
		configPath = path
	}

	if configReady {
		if _, err := os.Stat(configPath); err == nil {
			return configPath, nil
		}
		if err := os.WriteFile(configPath, []byte(configContent), 0o644); err != nil {
			return "", fmt.Errorf("restore mpv config: %w", err)
		}
		return configPath, nil
	}

	return writeConfig()
}

func writeConfig() (string, error) {
	content, err := buildConfigContent()
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(configPath, []byte(content), 0o644); err != nil {
		return "", fmt.Errorf("write mpv config: %w", err)
	}

	configContent = content
	configReady = true

	return configPath, nil
}

func buildConfigContent() (string, error) {
	windowWidth, windowHeight, volume, ontop, err := loadConfiguredPlayerBaseSettings()
	if err != nil {
		return "", err
	}
	resumePlayback := loadConfiguredPlayerResumePlayback()

	lines := []string{
		"osc=no",
		"input-default-bindings=no",
		"keep-open=yes",
		"keepaspect-window=no",
		fmt.Sprintf("save-position-on-quit=%s", mpvBool(resumePlayback)),
		fmt.Sprintf("resume-playback=%s", mpvBool(resumePlayback)),
		fmt.Sprintf("ontop=%s", mpvBool(ontop)),
		fmt.Sprintf("osd-playing-msg-duration=%d", startupHintDuration),
		"video-align-y=0",
		"video-margin-ratio-bottom=0.105",
		"watch-later-options-remove=sub-pos,osd-margin-y",
	}
	if runtime.GOOS == "darwin" {
		lines = append(lines, "border=no")
	}
	lines = append(lines,
		"auto-window-resize=no",
		"geometry="+centeredWindowGeometry(windowWidth, windowHeight),
	)
	lines = append(lines, fmt.Sprintf("volume=%d", volume))

	return strings.Join(lines, "\n") + "\n", nil
}

func centeredWindowGeometry(width, height int) string {
	return fmt.Sprintf("%d%%x%d%%+50%%+50%%", width, height)
}

func loadConfiguredPlayerBaseSettings() (int, int, int, bool, error) {
	cfg, err := loadPlayerConfig()
	if err != nil {
		logging.Error("list player base config failed, using defaults: %v", err)
		return defaultWindowWidth, defaultWindowHeight, defaultVolume, defaultOntop, nil
	}

	windowWidth := defaultWindowWidth
	windowHeight := defaultWindowHeight
	if raw := strings.TrimSpace(cfg[playerWindowSizeConfigKey]); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= 10 && parsed <= 100 {
			windowWidth = parsed
			windowHeight = parsed
		}
	}
	if raw := strings.TrimSpace(cfg[playerWindowWidthConfigKey]); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= 10 && parsed <= 100 {
			windowWidth = parsed
		}
	}
	if raw := strings.TrimSpace(cfg[playerWindowHeightConfigKey]); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= 10 && parsed <= 100 {
			windowHeight = parsed
		}
	}

	volume := defaultVolume
	if raw := strings.TrimSpace(cfg[playerVolumeConfigKey]); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed >= 0 && parsed <= 130 {
			volume = parsed
		}
	}

	ontop := defaultOntop
	if raw := strings.TrimSpace(cfg[playerOntopConfigKey]); raw != "" {
		switch strings.ToLower(raw) {
		case "0", "false", "no", "off":
			ontop = false
		case "1", "true", "yes", "on":
			ontop = true
		}
	}

	return windowWidth, windowHeight, volume, ontop, nil
}

func loadConfiguredPlayerReuseWindow() bool {
	cfg, err := loadPlayerConfig()
	if err != nil {
		logging.Error("list player reuse window config failed, using default: %v", err)
		return defaultReuseWindow
	}

	raw := strings.TrimSpace(cfg[playerReuseWindowConfigKey])
	if raw == "" {
		return defaultReuseWindow
	}
	switch strings.ToLower(raw) {
	case "0", "false", "no", "off":
		return false
	case "1", "true", "yes", "on":
		return true
	default:
		return defaultReuseWindow
	}
}

func loadConfiguredPlayerResumePlayback() bool {
	cfg, err := loadPlayerConfig()
	if err != nil {
		logging.Error("list player resume playback config failed, using default: %v", err)
		return defaultResume
	}

	raw := strings.TrimSpace(cfg[playerResumePlaybackConfigKey])
	if raw == "" {
		return defaultResume
	}
	switch strings.ToLower(raw) {
	case "0", "false", "no", "off":
		return false
	case "1", "true", "yes", "on":
		return true
	default:
		return defaultResume
	}
}

func loadConfiguredPlayerShowHotkeyHint() (bool, error) {
	cfg, err := loadPlayerConfig()
	if err != nil {
		logging.Error("list player hotkey hint config failed, using defaults: %v", err)
		return true, nil
	}

	raw := strings.TrimSpace(cfg[playerShowHotkeyHintConfigKey])
	if raw == "" {
		return true, nil
	}
	switch strings.ToLower(raw) {
	case "0", "false", "no", "off":
		return false, nil
	case "1", "true", "yes", "on":
		return true, nil
	default:
		return true, nil
	}
}

func mpvBool(value bool) string {
	if value {
		return "yes"
	}
	return "no"
}
