//go:build darwin

package mpv

import (
	"encoding/json"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"javboss/internal/common"
)

// Opt in separately from headless tests because this opens real macOS windows.
func TestDarwinWindowGeometryIsOnlyAppliedInitially(t *testing.T) {
	mpvPath := os.Getenv("JAVBOSS_TEST_MPV_GUI")
	if mpvPath == "" {
		t.Skip("set JAVBOSS_TEST_MPV_GUI to run the macOS window regression test")
	}
	dir := t.TempDir()
	// Darwin Unix socket paths must fit within 104 bytes.
	socketDir, err := os.MkdirTemp("", "mpv-geo-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(socketDir) })
	probe := filepath.Join(dir, "window-bounds")
	if output, err := exec.Command("clang", "-framework", "Cocoa", "testdata/window_bounds.m", "-o", probe).CombinedOutput(); err != nil {
		t.Fatalf("compile window bounds probe: %v\n%s", err, output)
	}
	sourceDir, err := findModernZSourceDir()
	if err != nil {
		t.Fatal(err)
	}
	previousDB := common.DB
	common.DB = nil
	t.Cleanup(func() { common.DB = previousDB })
	config, err := buildConfigContent()
	if err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(dir, "mpv.conf")
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}
	first, err := filepath.Abs("../../web/public/icon-192.png")
	if err != nil {
		t.Fatal(err)
	}
	second, err := filepath.Abs("../../web/public/icon-512.png")
	if err != nil {
		t.Fatal(err)
	}
	for _, startIdle := range []bool{true, false} {
		t.Run("start-idle="+strconv.FormatBool(startIdle), func(t *testing.T) {
			endpoint := filepath.Join(socketDir, "mpv-"+strconv.FormatBool(startIdle)+".sock")
			args := []string{
				"--no-config", "--load-scripts=no", "--include=" + configPath,
				"--script=" + filepath.Join(sourceDir, "window_geometry.lua"),
				"--input-ipc-server=" + endpoint, "--ao=null", "--image-display-duration=inf",
				"--save-position-on-quit=no", "--resume-playback=no", "--pause",
			}
			if startIdle {
				args = append(args, "--idle=yes", "--force-window=yes")
			} else {
				args = append(args, first)
			}
			cmd := exec.Command(mpvPath, args...)
			if err := cmd.Start(); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() { done <- cmd.Wait() }()
			t.Cleanup(func() {
				_ = runIPCCommand(endpoint, []any{"quit"})
				select {
				case <-done:
				case <-time.After(3 * time.Second):
					_ = cmd.Process.Kill()
					<-done
				}
			})
			if err := waitForIPCReady(endpoint); err != nil {
				t.Fatal(err)
			}
			waitMPVTestProperty(t, endpoint, "geometry", "80%x80%")
			// The geometry option is applied asynchronously by the macOS main thread.
			time.Sleep(200 * time.Millisecond)
			bounds := readDarwinWindowBounds(t, probe, cmd.Process.Pid)
			for axis := 0; axis < 2; axis++ {
				assertWindowCoordinate(t, bounds.Window[axis+2], bounds.Screen[axis+2]*0.8)
				assertWindowCoordinate(t, bounds.Window[axis]+bounds.Window[axis+2]/2, bounds.Screen[axis]+bounds.Screen[axis+2]/2)
			}
			command := func(args ...any) {
				t.Helper()
				if err := runIPCCommand(endpoint, args); err != nil {
					t.Fatal(err)
				}
			}
			if startIdle {
				command("loadfile", first, "replace")
			}
			waitMPVTestProperty(t, endpoint, "video-out-params/w", float64(192))
			command("loadfile", second, "append")
			// This resizes through the native window-size API, without changing geometry.
			command("set_property", "window-scale", 3)
			time.Sleep(300 * time.Millisecond)
			adjusted := readDarwinWindowBounds(t, probe, cmd.Process.Pid)
			if math.Abs(adjusted.Window[2]-bounds.Window[2]) < 10 {
				t.Fatal("native window resize did not take effect")
			}
			for _, index := range []int{1, 0, 1} {
				command("playlist-play-index", index)
				width := float64(192)
				if index == 1 {
					width = 512
				}
				waitMPVTestProperty(t, endpoint, "video-out-params/w", width)
				time.Sleep(200 * time.Millisecond)
				current := readDarwinWindowBounds(t, probe, cmd.Process.Pid)
				for coordinate := range current.Window {
					assertWindowCoordinate(t, current.Window[coordinate], adjusted.Window[coordinate])
				}
			}
		})
	}
}

type darwinWindowBounds struct {
	Window [4]float64 `json:"window"`
	Screen [4]float64 `json:"screen"`
}

func readDarwinWindowBounds(t *testing.T, probe string, pid int) darwinWindowBounds {
	t.Helper()
	output, err := exec.Command(probe, strconv.Itoa(pid)).CombinedOutput()
	if err != nil {
		t.Fatalf("read window bounds: %v\n%s", err, output)
	}
	var bounds darwinWindowBounds
	if err := json.Unmarshal(output, &bounds); err != nil {
		t.Fatalf("decode window bounds: %v\n%s", err, output)
	}
	return bounds
}

func assertWindowCoordinate(t *testing.T, actual, expected float64) {
	t.Helper()
	if math.Abs(actual-expected) > 2 {
		t.Fatalf("window coordinate = %.2f, want %.2f", actual, expected)
	}
}
