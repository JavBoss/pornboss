package server

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"testing"

	"javboss/internal/common"
	dbpkg "javboss/internal/db"

	"github.com/gin-gonic/gin"
)

func TestUpdateConfigPersistsWaterfallDefaults(t *testing.T) {
	gin.SetMode(gin.TestMode)
	database, err := dbpkg.Open(filepath.Join(t.TempDir(), "config.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatalf("database handle: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	previousDB := common.DB
	common.DB = database
	t.Cleanup(func() { common.DB = previousDB })

	router := gin.New()
	router.PATCH("/config", updateConfig)
	body := []byte(`{
		"video_waterfall_default": true,
		"jav_waterfall_default": true,
		"idol_waterfall_default": false,
		"studio_waterfall_default": true,
		"series_waterfall_default": false,
		"jav_tag_show_simplified": true,
		"jav_favorite_rating_show_full": false
	}`)
	req := httptest.NewRequest(http.MethodPatch, "/config", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("update config status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}

	got, err := dbpkg.ListConfig(context.Background())
	if err != nil {
		t.Fatalf("list config: %v", err)
	}
	want := map[string]string{
		"video_waterfall_default":       "true",
		"jav_waterfall_default":         "true",
		"idol_waterfall_default":        "false",
		"studio_waterfall_default":      "true",
		"series_waterfall_default":      "false",
		"jav_tag_show_simplified":       "true",
		"jav_favorite_rating_show_full": "false",
	}
	for key, value := range want {
		if got[key] != value {
			t.Errorf("config %s = %q, want %q", key, got[key], value)
		}
	}
}

func TestUpdateConfigPersistsJavSortRules(t *testing.T) {
	gin.SetMode(gin.TestMode)
	database, err := dbpkg.Open(filepath.Join(t.TempDir(), "config.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatalf("database handle: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	previousDB := common.DB
	common.DB = database
	t.Cleanup(func() { common.DB = previousDB })

	router := gin.New()
	router.PATCH("/config", updateConfig)
	body := []byte(`{"jav_sort_rules":{"version":1,"rules":[{"id":"idol","enabled":true,"mode":"all","active":["idol"],"sort":"release"},{"id":"search-or-tag","enabled":true,"mode":"any","active":["search","tag"],"sort":"code"}]}}`)
	req := httptest.NewRequest(http.MethodPatch, "/config", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("update config status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}

	got, err := dbpkg.ListConfig(context.Background())
	if err != nil {
		t.Fatalf("list config: %v", err)
	}
	want := `{"version":1,"rules":[{"id":"idol","enabled":true,"mode":"all","active":["idol"],"sort":"release"},{"id":"search-or-tag","enabled":true,"mode":"any","active":["search","tag"],"sort":"code"}]}`
	if got["jav_sort_rules"] != want {
		t.Fatalf("jav_sort_rules = %q, want %q", got["jav_sort_rules"], want)
	}
}

func TestUpdateConfigRejectsInvalidJavSortRules(t *testing.T) {
	gin.SetMode(gin.TestMode)
	database, err := dbpkg.Open(filepath.Join(t.TempDir(), "config.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatalf("database handle: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	previousDB := common.DB
	common.DB = database
	t.Cleanup(func() { common.DB = previousDB })

	router := gin.New()
	router.PATCH("/config", updateConfig)
	body := []byte(`{"jav_sort_rules":{"version":1,"rules":[{"id":"invalid-filter","enabled":true,"mode":"contains","active":["unknown"],"sort":"release"}]}}`)
	req := httptest.NewRequest(http.MethodPatch, "/config", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("update config status = %d, want %d; body=%s", response.Code, http.StatusBadRequest, response.Body.String())
	}
}

func TestNormalizeJavSortRulesConfigAcceptsLegacyModes(t *testing.T) {
	got, ok := normalizeJavSortRulesConfig(javSortRulesConfig{
		Version: 1,
		Rules: []javSortRule{
			{ID: "legacy-exact", Enabled: true, Mode: "exact", Active: []string{"idol"}, Sort: "release"},
			{ID: "legacy-contains", Enabled: true, Mode: "contains", Active: []string{"tag"}, Sort: "recent"},
		},
	})
	if !ok {
		t.Fatal("legacy sort rule modes should remain loadable")
	}
	for _, rule := range got.Rules {
		if rule.Mode != "all" {
			t.Fatalf("legacy mode normalized to %q, want all", rule.Mode)
		}
	}
}

func TestUpdateConfigAcceptsBrowserPlayerAndLANAccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	database, err := dbpkg.Open(filepath.Join(t.TempDir(), "config.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatalf("database handle: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	previousDB := common.DB
	common.DB = database
	t.Cleanup(func() { common.DB = previousDB })

	router := gin.New()
	router.PATCH("/config", updateConfig)
	req := httptest.NewRequest(
		http.MethodPatch,
		"/config",
		bytes.NewReader([]byte(`{"default_player":"browser","allow_lan_access":true,"browser_player_show_hotkey_hint":false}`)),
	)
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("update config status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}

	got, err := dbpkg.ListConfig(context.Background())
	if err != nil {
		t.Fatalf("list config: %v", err)
	}
	if got["default_player"] != "browser" {
		t.Fatalf("default_player = %q, want browser", got["default_player"])
	}
	if got["allow_lan_access"] != "true" {
		t.Fatalf("allow_lan_access = %q, want true", got["allow_lan_access"])
	}
	if got["browser_player_show_hotkey_hint"] != "false" {
		t.Fatalf(
			"browser_player_show_hotkey_hint = %q, want false",
			got["browser_player_show_hotkey_hint"],
		)
	}
}

func TestIsRemoteRequest(t *testing.T) {
	tests := []struct {
		name       string
		remoteAddr string
		want       bool
	}{
		{name: "IPv4 loopback", remoteAddr: "127.0.0.1:17654", want: false},
		{name: "IPv6 loopback", remoteAddr: "[::1]:17654", want: false},
		{name: "LAN IPv4", remoteAddr: "192.168.1.25:54321", want: true},
		{name: "LAN IPv6", remoteAddr: "[fd00::25]:54321", want: true},
		{name: "address without port", remoteAddr: "10.0.0.8", want: true},
		{name: "unknown address", remoteAddr: "", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isRemoteRequest(test.remoteAddr); got != test.want {
				t.Fatalf("isRemoteRequest(%q) = %t, want %t", test.remoteAddr, got, test.want)
			}
			cfg := map[string]string{}
			applyRuntimeConfigFields(cfg, test.remoteAddr)
			if got := cfg["runtime_os"]; got != runtime.GOOS {
				t.Fatalf("runtime_os = %q, want server OS %q", got, runtime.GOOS)
			}
			wantRuntimeValue := "false"
			if test.want {
				wantRuntimeValue = "true"
			}
			if got := cfg["runtime_remote_request"]; got != wantRuntimeValue {
				t.Fatalf("runtime_remote_request = %q, want %q", got, wantRuntimeValue)
			}
		})
	}
}

func TestUpdateConfigPersistsWebHotkeys(t *testing.T) {
	gin.SetMode(gin.TestMode)
	database, err := dbpkg.Open(filepath.Join(t.TempDir(), "config.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatalf("database handle: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	previousDB := common.DB
	common.DB = database
	t.Cleanup(func() { common.DB = previousDB })

	router := gin.New()
	router.PATCH("/config", updateConfig)
	body := []byte(`{"web_hotkeys":[{"action":"content_page_up","key":"i"},{"action":"content_page_down","key":"k"},{"action":"continuous_scroll_up","key":"Shift+i"},{"action":"continuous_scroll_down","key":"Shift+k"},{"action":"edit_jav_query","key":"Space"},{"action":"open_page_jump","key":"f"},{"action":"previous_page","key":"j"},{"action":"next_page","key":"l"},{"action":"browser_back","key":"u"},{"action":"browser_forward","key":"o"}]}`)
	req := httptest.NewRequest(http.MethodPatch, "/config", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("update config status = %d, want %d; body=%s", response.Code, http.StatusOK, response.Body.String())
	}

	got, err := dbpkg.ListConfig(context.Background())
	if err != nil {
		t.Fatalf("list config: %v", err)
	}
	want := `[{"key":"i","action":"content_page_up"},{"key":"k","action":"content_page_down"},{"key":"Shift+i","action":"continuous_scroll_up"},{"key":"Shift+k","action":"continuous_scroll_down"},{"key":"Space","action":"edit_jav_query"},{"key":"f","action":"open_page_jump"},{"key":"j","action":"previous_page"},{"key":"l","action":"next_page"},{"key":"u","action":"browser_back"},{"key":"o","action":"browser_forward"}]`
	if got["web_hotkeys"] != want {
		t.Fatalf("web_hotkeys = %q, want %q", got["web_hotkeys"], want)
	}
}

func TestUpdateConfigRejectsDuplicateWebHotkeys(t *testing.T) {
	gin.SetMode(gin.TestMode)
	database, err := dbpkg.Open(filepath.Join(t.TempDir(), "config.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatalf("database handle: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	previousDB := common.DB
	common.DB = database
	t.Cleanup(func() { common.DB = previousDB })

	router := gin.New()
	router.PATCH("/config", updateConfig)
	body := []byte(`{"web_hotkeys":[{"action":"content_page_up","key":"w"},{"action":"content_page_down","key":"W"},{"action":"continuous_scroll_up","key":"Shift+w"},{"action":"continuous_scroll_down","key":"Shift+s"},{"action":"edit_jav_query","key":"Space"},{"action":"open_page_jump","key":"f"},{"action":"previous_page","key":"a"},{"action":"next_page","key":"d"},{"action":"browser_back","key":"1"},{"action":"browser_forward","key":"2"}]}`)
	req := httptest.NewRequest(http.MethodPatch, "/config", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("update config status = %d, want %d; body=%s", response.Code, http.StatusBadRequest, response.Body.String())
	}
}

func TestUpdateConfigRejectsNestedWebHotkeyModifiers(t *testing.T) {
	gin.SetMode(gin.TestMode)
	database, err := dbpkg.Open(filepath.Join(t.TempDir(), "config.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatalf("database handle: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	previousDB := common.DB
	common.DB = database
	t.Cleanup(func() { common.DB = previousDB })

	router := gin.New()
	router.PATCH("/config", updateConfig)
	for _, key := range []string{"Shift+Control+i", "Shift+Shift+i"} {
		t.Run(key, func(t *testing.T) {
			body := []byte(`{"web_hotkeys":[{"action":"content_page_up","key":"i"},{"action":"content_page_down","key":"k"},{"action":"continuous_scroll_up","key":"` + key + `"},{"action":"continuous_scroll_down","key":"Shift+k"},{"action":"edit_jav_query","key":"Space"},{"action":"open_page_jump","key":"f"},{"action":"previous_page","key":"j"},{"action":"next_page","key":"l"},{"action":"browser_back","key":"u"},{"action":"browser_forward","key":"o"}]}`)
			req := httptest.NewRequest(http.MethodPatch, "/config", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			router.ServeHTTP(response, req)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("update config status = %d, want %d; body=%s", response.Code, http.StatusBadRequest, response.Body.String())
			}
		})
	}
}

func TestNormalizeProxyHost(t *testing.T) {
	tests := []struct {
		name string
		host string
		want string
		ok   bool
	}{
		{name: "ipv4", host: "192.168.1.10", want: "192.168.1.10", ok: true},
		{name: "hostname", host: "proxy.local", want: "proxy.local", ok: true},
		{name: "bracketed ipv6", host: "[::1]", want: "::1", ok: true},
		{name: "url host", host: "http://10.0.0.2", want: "10.0.0.2", ok: true},
		{name: "host with port", host: "10.0.0.2:7890", ok: false},
		{name: "path", host: "10.0.0.2/proxy", ok: false},
		{name: "space", host: "bad host", ok: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := normalizeProxyHost(tt.host)
			if ok != tt.ok || got != tt.want {
				t.Fatalf("normalizeProxyHost(%q) = (%q, %v), want (%q, %v)", tt.host, got, ok, tt.want, tt.ok)
			}
		})
	}
}
