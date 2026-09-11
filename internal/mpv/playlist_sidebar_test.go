package mpv

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPlaylistSidebarHiDPI(t *testing.T) {
	mpvPath := os.Getenv("JAVBOSS_TEST_MPV")
	if mpvPath == "" {
		t.Skip("set JAVBOSS_TEST_MPV to run the sidebar Lua regression test")
	}
	sourceDir, err := findModernZSourceDir()
	if err != nil {
		t.Fatal(err)
	}
	script, err := filepath.Abs(filepath.Join(sourceDir, "playlist_sidebar.lua"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, mpvPath,
		"--no-config", "--load-scripts=no", "--idle=yes", "--vo=null", "--ao=null",
		"--script=testdata/playlist_sidebar_hidpi.lua", "--script-opts=sidebar-script="+script,
	)
	output, err := cmd.CombinedOutput()
	if err != nil || !strings.Contains(string(output), "SIDEBAR_HIDPI_TESTS_PASSED") {
		t.Fatalf("sidebar Lua regression failed: %v\n%s", err, output)
	}
}
