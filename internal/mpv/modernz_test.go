package mpv

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureModernZAssetsCopiesScriptOptionsAndFont(t *testing.T) {
	files := map[string]string{
		"modernz.lua":           "-- test lua\n",
		"modernz.conf":          "layout=modern\n",
		"modernz-icons.ttf":     "test font",
		"thumbfast.lua":         "-- thumbfast lua\n",
		"thumbfast.conf":        "max_height=200\n",
		"playlist_sidebar.lua":  "-- playlist sidebar lua\n",
		"playlist_sidebar.conf": "width=280\n",
		"window_geometry.lua":   "-- window geometry lua\n",
	}
	sourceDir := writeModernZTestAssets(t)

	t.Setenv(modernZEnvDir, sourceDir)

	assets, err := ensureModernZAssets()
	if err != nil {
		t.Fatalf("ensureModernZAssets returned error: %v", err)
	}

	expected := map[string]string{
		filepath.Join(assets.ConfigDir, "scripts", "modernz.lua"):               files["modernz.lua"],
		filepath.Join(assets.ConfigDir, "script-opts", "modernz.conf"):          files["modernz.conf"],
		filepath.Join(assets.ConfigDir, "fonts", "modernz-icons.ttf"):           files["modernz-icons.ttf"],
		filepath.Join(assets.ConfigDir, "scripts", "thumbfast.lua"):             files["thumbfast.lua"],
		filepath.Join(assets.ConfigDir, "script-opts", "thumbfast.conf"):        files["thumbfast.conf"],
		filepath.Join(assets.ConfigDir, "scripts", "playlist_sidebar.lua"):      files["playlist_sidebar.lua"],
		filepath.Join(assets.ConfigDir, "script-opts", "playlist_sidebar.conf"): files["playlist_sidebar.conf"],
		assets.ScriptPath:               files["modernz.lua"],
		assets.ThumbfastScriptPath:      files["thumbfast.lua"],
		assets.PlaylistScriptPath:       files["playlist_sidebar.lua"],
		assets.WindowGeometryScriptPath: files["window_geometry.lua"],
	}
	for path, content := range expected {
		got, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read copied asset %s: %v", path, err)
		}
		if string(got) != content {
			t.Fatalf("expected copied asset %s to contain %q, got %q", path, content, string(got))
		}
	}
}

func TestBundledModernZEnablesFullscreenAutohide(t *testing.T) {
	sourceDir, err := findModernZSourceDir()
	if err != nil {
		t.Fatalf("find ModernZ source dir: %v", err)
	}

	config, err := os.ReadFile(filepath.Join(sourceDir, "modernz.conf"))
	if err != nil {
		t.Fatalf("read ModernZ config: %v", err)
	}
	if !strings.Contains(string(config), "fullscreen_autohide=yes\n") {
		t.Fatalf("expected bundled ModernZ config to enable fullscreen autohide")
	}
	if !strings.Contains(string(config), "osc_height=47\n") {
		t.Fatalf("expected bundled ModernZ config to use compact OSC height")
	}
	for _, expected := range []string{
		"playpause_size=22\n",
		"midbuttons_size=19\n",
		"sidebuttons_size=19\n",
	} {
		if !strings.Contains(string(config), expected) {
			t.Fatalf("expected bundled ModernZ config to contain %q", expected)
		}
	}

	script, err := os.ReadFile(filepath.Join(sourceDir, "modernz.lua"))
	if err != nil {
		t.Fatalf("read ModernZ script: %v", err)
	}
	for _, expected := range []string{
		`visibility_mode("auto", true)`,
		`mp.set_property_number("video-margin-ratio-bottom", 0)`,
		`user_opts.deadzonesize = 0`,
		`user_opts.keep_with_cursor = false`,
		`visibility_mode(restore_visibility, true)`,
	} {
		if !strings.Contains(string(script), expected) {
			t.Fatalf("expected bundled ModernZ script to contain %q", expected)
		}
	}
}

func TestBundledPlaylistSidebarIsPersistentAndInteractive(t *testing.T) {
	sourceDir, err := findModernZSourceDir()
	if err != nil {
		t.Fatalf("find ModernZ source dir: %v", err)
	}

	config, err := os.ReadFile(filepath.Join(sourceDir, "playlist_sidebar.conf"))
	if err != nil {
		t.Fatalf("read playlist sidebar config: %v", err)
	}
	for _, expected := range []string{
		"enabled=yes\n",
		"width=320\n",
		"min_width=240\n",
		"resize_handle_width=10\n",
		"font_size=20\n",
		"font=auto\n",
		"auto_hide_single=yes\n",
		"hide_fullscreen=yes\n",
	} {
		if !strings.Contains(string(config), expected) {
			t.Fatalf("expected bundled playlist sidebar config to contain %q", expected)
		}
	}

	script, err := os.ReadFile(filepath.Join(sourceDir, "playlist_sidebar.lua"))
	if err != nil {
		t.Fatalf("read playlist sidebar script: %v", err)
	}
	for _, expected := range []string{
		`mp.create_osd_overlay("ass-events")`,
		`mp.set_property_number("video-margin-ratio-right", value)`,
		`local left = math.max(0, pane_left - math.floor(opts.resize_handle_width / 2))`,
		`mp.commandv("playlist-play-index", index - 1)`,
		`publish_width(pane_width * scale_x)`,
		`{"mbtn_left", end_click, begin_click}`,
		`if mouse_x and math.abs(mouse_x - pane_left) <= opts.resize_handle_width then`,
		`{"mouse_move", handle_mouse_move}`,
		`local handle_active = dragging or handle_hovered`,
		`return "Microsoft YaHei UI"`,
		`return "PingFang SC"`,
		`return "Noto Sans CJK SC"`,
		`\\fn%s`,
		`update_interaction_area(width, height, dragging or handle_hovered)`,
		`local changed = hovered ~= handle_hovered`,
		`if not mouse_x or mouse_x < pane_left then`,
		`}↔`,
		`current_width = next_width`,
		`table.concat(parts, "\n")`,
		`{"wheel_up", function() scroll(-1) end}`,
		`{"wheel_down", function() scroll(1) end}`,
		`mp.get_property_native("options/save-position-on-quit", false)`,
		`mp.get_property_native("eof-reached", false)`,
		`mp.commandv("write-watch-later-config")`,
		`mp.add_hook("on_unload", 50, save_position_before_unload)`,
	} {
		if !strings.Contains(string(script), expected) {
			t.Fatalf("expected bundled playlist sidebar script to contain %q", expected)
		}
	}
	dragCheck := strings.Index(string(script), `if mouse_x and math.abs(mouse_x - pane_left) <= opts.resize_handle_width then`)
	videoAreaCheck := strings.Index(string(script), `if not mouse_x or mouse_x < pane_left then`)
	if dragCheck < 0 || videoAreaCheck < 0 || dragCheck >= videoAreaCheck {
		t.Fatal("expected resize handle detection before the video-area click guard")
	}

	modernZScript, err := os.ReadFile(filepath.Join(sourceDir, "modernz.lua"))
	if err != nil {
		t.Fatalf("read ModernZ script: %v", err)
	}
	for _, expected := range []string{
		`displayresx = 0`,
		`user-data/javboss/playlist-sidebar-width`,
		`osc_param.playresx = math.max(1, osc_param.displayresx - sidebar_virtual_width)`,
		`set_osd(state.osd, osc_param.displayresx, osc_param.playresy, ass.text, 1000)`,
	} {
		if !strings.Contains(string(modernZScript), expected) {
			t.Fatalf("expected ModernZ sidebar integration to contain %q", expected)
		}
	}
}

func TestSessionPathsSharePerProcessRoot(t *testing.T) {
	sourceDir := writeModernZTestAssets(t)
	t.Setenv(modernZEnvDir, sourceDir)

	inputPath, err := ensureInputConf()
	if err != nil {
		t.Fatalf("ensureInputConf returned error: %v", err)
	}
	configPath, err := ensureConfig()
	if err != nil {
		t.Fatalf("ensureConfig returned error: %v", err)
	}
	modernZ, err := ensureModernZAssets()
	if err != nil {
		t.Fatalf("ensureModernZAssets returned error: %v", err)
	}

	root, err := sessionDir()
	if err != nil {
		t.Fatalf("sessionDir returned error: %v", err)
	}
	expected := []string{inputPath, configPath, modernZ.ConfigDir, modernZ.ScriptPath, modernZ.ThumbfastScriptPath, modernZ.PlaylistScriptPath}
	for _, path := range expected {
		if !strings.HasPrefix(path, root+string(os.PathSeparator)) {
			t.Fatalf("expected %s to be under isolated mpv session dir %s", path, root)
		}
	}
}

func writeModernZTestAssets(t *testing.T) string {
	t.Helper()

	sourceDir := t.TempDir()
	files := map[string]string{
		"modernz.lua":           "-- test lua\n",
		"modernz.conf":          "layout=modern\n",
		"modernz-icons.ttf":     "test font",
		"thumbfast.lua":         "-- thumbfast lua\n",
		"thumbfast.conf":        "max_height=200\n",
		"playlist_sidebar.lua":  "-- playlist sidebar lua\n",
		"playlist_sidebar.conf": "width=280\n",
		"window_geometry.lua":   "-- window geometry lua\n",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(sourceDir, name), []byte(content), 0o644); err != nil {
			t.Fatalf("write source asset: %v", err)
		}
	}
	return sourceDir
}
