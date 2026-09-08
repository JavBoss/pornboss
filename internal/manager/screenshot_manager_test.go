package manager

import (
	"context"
	"slices"
	"testing"
	"time"
)

func TestIsRemoteScreenshotInput(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{input: "https://media.example/video.mp4", want: true},
		{input: "HTTP://127.0.0.1:12333/video.mp4", want: true},
		{input: "/videos/example.mp4", want: false},
		{input: "file:///videos/example.mp4", want: false},
	}
	for _, tt := range tests {
		if got := isRemoteScreenshotInput(tt.input); got != tt.want {
			t.Errorf("isRemoteScreenshotInput(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestRemoteScreenshotConcurrencyIsSerialized(t *testing.T) {
	manager := &ScreenshotManager{
		remoteSlots: make(chan struct{}, maxRemoteScreenshotConcurrent),
	}
	firstRelease, err := manager.acquireRemoteSlot(context.Background(), "https://media.example/one.mp4")
	if err != nil {
		t.Fatalf("acquire first remote slot: %v", err)
	}

	secondAcquired := make(chan func(), 1)
	secondErrors := make(chan error, 1)
	go func() {
		release, err := manager.acquireRemoteSlot(context.Background(), "https://media.example/two.mp4")
		if err != nil {
			secondErrors <- err
			return
		}
		secondAcquired <- release
	}()

	select {
	case err := <-secondErrors:
		t.Fatalf("acquire second remote slot: %v", err)
	case release := <-secondAcquired:
		release()
		t.Fatal("second remote screenshot acquired a slot before the first released it")
	case <-time.After(50 * time.Millisecond):
	}

	firstRelease()
	select {
	case err := <-secondErrors:
		t.Fatalf("acquire second remote slot after release: %v", err)
	case release := <-secondAcquired:
		release()
	case <-time.After(time.Second):
		t.Fatal("second remote screenshot did not acquire the released slot")
	}
}

func TestRemoteScreenshotConcurrencyWaitHonorsContext(t *testing.T) {
	manager := &ScreenshotManager{
		remoteSlots: make(chan struct{}, maxRemoteScreenshotConcurrent),
	}
	release, err := manager.acquireRemoteSlot(context.Background(), "https://media.example/one.mp4")
	if err != nil {
		t.Fatalf("acquire first remote slot: %v", err)
	}
	defer release()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := manager.acquireRemoteSlot(ctx, "https://media.example/two.mp4"); err == nil {
		t.Fatal("acquireRemoteSlot() error = nil for cancelled context")
	}
}

func TestLocalScreenshotsDoNotUseRemoteSlots(t *testing.T) {
	manager := &ScreenshotManager{
		remoteSlots: make(chan struct{}, maxRemoteScreenshotConcurrent),
	}
	remoteRelease, err := manager.acquireRemoteSlot(context.Background(), "https://media.example/video.mp4")
	if err != nil {
		t.Fatalf("acquire remote slot: %v", err)
	}
	defer remoteRelease()

	localRelease, err := manager.acquireRemoteSlot(context.Background(), "/videos/example.mp4")
	if err != nil {
		t.Fatalf("acquire local slot: %v", err)
	}
	localRelease()
}

func TestBuildFFmpegScreenshotArgsIncludesHeadlessImageOptions(t *testing.T) {
	args := buildFFmpegScreenshotArgs(12, "/tmp/screenshots/00000001.jpg", "/videos/example.mp4")

	required := []string{
		"-nostdin",
		"-hide_banner",
		"-loglevel",
		"error",
		"-y",
		"-ss",
		"12",
		"-i",
		"/videos/example.mp4",
		"-map",
		"0:v:0",
		"-frames:v",
		"1",
		"-q:v",
		"2",
		"/tmp/screenshots/00000001.jpg",
	}
	for _, option := range required {
		if !slices.Contains(args, option) {
			t.Fatalf("expected ffmpeg screenshot args to include %q, got %v", option, args)
		}
	}
}

func TestBuildMPVScreenshotArgsIncludesImageOutputOptions(t *testing.T) {
	args := buildMPVScreenshotArgs(12, "/tmp/screenshots", "/videos/example.mp4")

	required := []string{
		"--no-config",
		"--ao=null",
		"--start=12",
		"--frames=1",
		"--vo=image",
		"--vo-image-format=jpg",
		"--vo-image-outdir=/tmp/screenshots",
		"/videos/example.mp4",
	}
	for _, option := range required {
		if !slices.Contains(args, option) {
			t.Fatalf("expected mpv screenshot args to include %q, got %v", option, args)
		}
	}
}
