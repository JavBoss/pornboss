package manager

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"javboss/internal/common/logging"
	"javboss/internal/models"
	"javboss/internal/runtimeconfig"
	"javboss/internal/util"
)

// Task represents a request to capture a screenshot for a specific video.
type Task struct {
	VideoID    int64
	Second     int
	ModifiedAt time.Time
	Size       int64
}

// VideoFetcher loads a video record by ID.
type VideoFetcher func(ctx context.Context, id int64) (*models.Video, error)

const (
	maxScreenshotWorkers          = 8
	maxRemoteScreenshotConcurrent = 1
	screenshotExecutionTimeout    = 2 * time.Minute
)

// ScreenshotManager coordinates asynchronous screenshot generation using the worker.
type ScreenshotManager struct {
	tasks       chan Task
	workers     int
	dataDir     string
	fetchVideo  VideoFetcher
	remoteSlots chan struct{}
}

// NewScreenshotManager creates a manager when dataDir and fetchVideo are provided.
// Returns nil when either is missing, effectively disabling screenshot generation.
func NewScreenshotManager(dataDir string, fetchVideo VideoFetcher) *ScreenshotManager {
	dataDir = strings.TrimSpace(dataDir)
	if dataDir == "" || fetchVideo == nil {
		return nil
	}
	workers := runtime.GOMAXPROCS(0)
	if workers <= 0 {
		workers = 1
	}
	if workers > maxScreenshotWorkers {
		workers = maxScreenshotWorkers
	}
	logging.Info(
		"screenshot manager initialized with %d workers (remote concurrency=%d)",
		workers,
		maxRemoteScreenshotConcurrent,
	)
	return &ScreenshotManager{
		tasks:       make(chan Task, 5000),
		workers:     workers,
		dataDir:     dataDir,
		fetchVideo:  fetchVideo,
		remoteSlots: make(chan struct{}, maxRemoteScreenshotConcurrent),
	}
}

// Start launches the background worker. Safe to call with nil manager.
func (m *ScreenshotManager) Start(ctx context.Context) {
	if m == nil {
		return
	}
	if m.workers <= 0 {
		m.workers = runtime.GOMAXPROCS(0)
		if m.workers <= 0 {
			m.workers = 1
		}
		if m.workers > maxScreenshotWorkers {
			m.workers = maxScreenshotWorkers
		}
	}
	for i := 0; i < m.workers; i++ {
		go m.startWorker(ctx)
	}
}

// Enqueue schedules a single screenshot task. Invalid or empty tasks are ignored.
func (m *ScreenshotManager) Enqueue(task Task) {
	if m == nil {
		return
	}
	if task.VideoID <= 0 || task.Second <= 0 || task.ModifiedAt.IsZero() {
		return
	}
	// Block until the worker takes it to ensure screenshots are always generated.
	m.tasks <- task
}

// EnqueueForVideo schedules a screenshot task using the standard second selection logic.
func (m *ScreenshotManager) EnqueueForVideo(video *models.Video) {
	if m == nil {
		return
	}
	task, ok := TaskForVideo(video)
	if !ok {
		return
	}
	m.Enqueue(task)
}

// ScreenshotPath builds the on-disk screenshot path for a video ID and second.
func (m *ScreenshotManager) ScreenshotPath(videoID int64, second int) string {
	if m == nil {
		return ""
	}
	return ScreenshotPath(m.dataDir, videoID, second)
}

// CaptureFile captures a screenshot for videoPath at second into outputPath.
func (m *ScreenshotManager) CaptureFile(ctx context.Context, videoPath string, second float64, outputPath string) error {
	if m == nil {
		return errors.New("screenshot manager is not configured")
	}
	return m.capture(ctx, videoPath, second, outputPath)
}

// ScreenshotPath builds the on-disk screenshot path for a video ID and second.
func ScreenshotPath(dataDir string, videoID int64, second int) string {
	dataDir = strings.TrimSpace(dataDir)
	if dataDir == "" || videoID <= 0 || second <= 0 {
		return ""
	}
	fileName := fmt.Sprintf("%d.jpg", second)
	return filepath.Join(dataDir, "video", strconv.FormatInt(videoID, 10), "screenshot", fileName)
}

var screenshotSeconds = []int{128, 63, 32, 16, 8, 4, 2, 1}

// PickScreenshotSecond picks the closest configured second that does not exceed durationSec.
func PickScreenshotSecond(durationSec int64) (int, bool) {
	if durationSec <= 0 {
		return 0, false
	}
	for _, candidate := range screenshotSeconds {
		if durationSec >= int64(candidate) {
			return candidate, true
		}
	}
	return 0, false
}

// TaskForVideo builds a screenshot task for the given video using standard selection logic.
func TaskForVideo(video *models.Video) (Task, bool) {
	if video == nil {
		return Task{}, false
	}
	modifiedAt, size, ok := videoTaskMeta(video)
	if video.ID <= 0 || !ok || modifiedAt.IsZero() {
		return Task{}, false
	}
	second, ok := PickScreenshotSecond(video.DurationSec)
	if !ok {
		return Task{}, false
	}
	return Task{
		VideoID:    video.ID,
		Second:     second,
		ModifiedAt: modifiedAt,
		Size:       size,
	}, true
}

func videoTaskMeta(video *models.Video) (time.Time, int64, bool) {
	if video == nil {
		return time.Time{}, 0, false
	}
	if len(video.Locations) > 0 {
		loc := video.Locations[0]
		return loc.ModifiedAt, video.Size, !loc.ModifiedAt.IsZero()
	}
	return video.ModifiedAt, video.Size, !video.ModifiedAt.IsZero()
}

// startWorker launches a background loop that consumes screenshot generation
// tasks. The worker stops when the context is done or the channel is closed.
func (m *ScreenshotManager) startWorker(ctx context.Context) {
	if m == nil || m.dataDir == "" || m.fetchVideo == nil {
		logging.Info("screenshot worker disabled: data directory or fetcher missing")
		return
	}

	for {
		select {
		case <-ctx.Done():
			logging.Info("screenshot worker exiting: context cancelled")
			return
		case task, ok := <-m.tasks:
			if !ok {
				logging.Info("screenshot worker exiting: task channel closed")
				return
			}
			if err := m.processTask(ctx, task); err != nil {
				logging.Error("screenshot task failed (video_id=%d, second=%d): %v", task.VideoID, task.Second, err)
			}
		}
	}
}

func (m *ScreenshotManager) processTask(parent context.Context, task Task) error {
	if task.VideoID <= 0 || task.Second <= 0 || task.ModifiedAt.IsZero() {
		return errors.New("invalid screenshot task: missing video id, second, or modified_at")
	}
	screenshotPath := m.ScreenshotPath(task.VideoID, task.Second)
	if screenshotPath == "" {
		return errors.New("invalid screenshot task: missing screenshot path")
	}
	if _, err := os.Stat(screenshotPath); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("stat screenshot: %w", err)
	}

	video, err := m.fetchVideo(parent, task.VideoID)
	if err != nil {
		return err
	}
	if video == nil {
		return nil
	}
	modifiedAt, size, ok := videoTaskMeta(video)
	if !ok || !sameVideoMeta(modifiedAt, size, task) {
		return nil
	}

	locatorPath, err := resolveVideoPath(video)
	if err != nil {
		return err
	}

	info, err := os.Stat(locatorPath)
	if err != nil {
		return err
	}
	if !info.ModTime().Equal(task.ModifiedAt) {
		return nil
	}
	if !util.IsSTRMPath(locatorPath) && info.Size() != task.Size {
		return nil
	}
	source, err := util.ResolveMediaSource(locatorPath)
	if err != nil {
		return err
	}

	return m.capture(parent, source.Input, float64(task.Second), screenshotPath)
}

func (m *ScreenshotManager) capture(ctx context.Context, videoPath string, second float64, outputPath string) error {
	if videoPath == "" {
		return errors.New("video path is required")
	}
	if second < 0 {
		return errors.New("second is required")
	}
	if outputPath == "" {
		return errors.New("output path is required")
	}
	releaseRemoteSlot, err := m.acquireRemoteSlot(ctx, videoPath)
	if err != nil {
		return err
	}
	defer releaseRemoteSlot()

	// Start the media-tool timeout only after a remote task owns the slot. Time
	// spent waiting behind another STRM screenshot must not consume its runtime.
	executionCtx, cancel := context.WithTimeout(ctx, screenshotExecutionTimeout)
	defer cancel()

	if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
		return fmt.Errorf("ensure screenshot dir: %w", err)
	}

	tempDir, err := os.MkdirTemp(filepath.Dir(outputPath), ".screenshot-*")
	if err != nil {
		return fmt.Errorf("create screenshot temp dir: %w", err)
	}
	defer func() { _ = os.RemoveAll(tempDir) }()
	shotPath := filepath.Join(tempDir, "00000001.jpg")

	if runtime.GOOS == "darwin" || runtimeconfig.UseFFmpegScreenshots() {
		ffmpegPath, err := util.ResolveFFmpegPath()
		if err != nil {
			return fmt.Errorf("resolve ffmpeg path: %w", err)
		}
		if err := runFFmpegScreenshot(executionCtx, ffmpegPath, videoPath, second, shotPath); err != nil {
			return err
		}
		return moveScreenshot(shotPath, outputPath)
	}

	mpvPath, pathErr := util.ResolveMPVPath()
	if pathErr != nil {
		return fmt.Errorf("resolve mpv path: %w", pathErr)
	}
	args := buildMPVScreenshotArgs(second, tempDir, videoPath)

	cmd := exec.CommandContext(executionCtx, mpvPath, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		_ = os.Remove(shotPath)
		if errors.Is(err, exec.ErrNotFound) {
			return fmt.Errorf("mpv not found: %w", err)
		}
		lastOut := strings.TrimSpace(string(out))
		if lastOut != "" {
			return fmt.Errorf("mpv screenshot failed: %w: %s", err, lastOut)
		}
		return fmt.Errorf("mpv screenshot failed: %w", err)
	}

	info, err := os.Stat(shotPath)
	if err != nil {
		return errors.New("mpv produced no screenshot file")
	}
	if info.Size() == 0 {
		_ = os.Remove(shotPath)
		return errors.New("mpv produced empty screenshot file")
	}

	return moveScreenshot(shotPath, outputPath)
}

func (m *ScreenshotManager) acquireRemoteSlot(ctx context.Context, videoPath string) (func(), error) {
	if !isRemoteScreenshotInput(videoPath) {
		return func() {}, nil
	}
	if m == nil || m.remoteSlots == nil {
		return nil, errors.New("remote screenshot concurrency limiter is not configured")
	}
	select {
	case m.remoteSlots <- struct{}{}:
		return func() { <-m.remoteSlots }, nil
	case <-ctx.Done():
		return nil, fmt.Errorf("wait for remote screenshot slot: %w", ctx.Err())
	}
}

func isRemoteScreenshotInput(input string) bool {
	parsed, err := url.Parse(strings.TrimSpace(input))
	if err != nil || parsed.Hostname() == "" {
		return false
	}
	return strings.EqualFold(parsed.Scheme, "http") || strings.EqualFold(parsed.Scheme, "https")
}

func runFFmpegScreenshot(ctx context.Context, ffmpegPath string, videoPath string, second float64, outputPath string) error {
	args := buildFFmpegScreenshotArgs(second, outputPath, videoPath)
	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		_ = os.Remove(outputPath)
		lastOut := strings.TrimSpace(string(out))
		if lastOut != "" {
			return fmt.Errorf("ffmpeg screenshot failed: %w: %s", err, lastOut)
		}
		return fmt.Errorf("ffmpeg screenshot failed: %w", err)
	}

	info, err := os.Stat(outputPath)
	if err != nil {
		return errors.New("ffmpeg produced no screenshot file")
	}
	if info.Size() == 0 {
		_ = os.Remove(outputPath)
		return errors.New("ffmpeg produced empty screenshot file")
	}
	return nil
}

func moveScreenshot(shotPath string, outputPath string) error {
	if err := os.Rename(shotPath, outputPath); err != nil {
		return fmt.Errorf("rename screenshot: %w", err)
	}
	return nil
}

func buildFFmpegScreenshotArgs(second float64, outputPath string, videoPath string) []string {
	return []string{
		"-nostdin",
		"-hide_banner",
		"-loglevel", "error",
		"-y",
		"-ss", formatScreenshotSecond(second),
		"-i", videoPath,
		"-map", "0:v:0",
		"-frames:v", "1",
		"-q:v", "2",
		outputPath,
	}
}

func buildMPVScreenshotArgs(second float64, tempDir string, videoPath string) []string {
	return []string{
		"--no-config",
		"--really-quiet",
		"--msg-level=all=error",
		"--ao=null",
		"--hr-seek=yes",
		"--start=" + formatScreenshotSecond(second),
		"--frames=1",
		"--vo=image",
		"--vo-image-format=jpg",
		"--vo-image-outdir=" + tempDir,
		videoPath,
	}
}

func formatScreenshotSecond(second float64) string {
	if second == float64(int64(second)) {
		return strconv.FormatInt(int64(second), 10)
	}
	return strconv.FormatFloat(second, 'f', 3, 64)
}

func resolveVideoPath(video *models.Video) (string, error) {
	if video == nil {
		return "", errors.New("video is nil")
	}
	if len(video.Locations) > 0 {
		loc := video.Locations[0]
		dirPath := strings.TrimSpace(loc.DirectoryRef.Path)
		relPath := strings.TrimSpace(loc.RelativePath)
		if dirPath != "" && relPath != "" {
			return filepath.Join(dirPath, filepath.FromSlash(relPath)), nil
		}
	}
	return "", errors.New("video location missing")
}

func sameVideoMeta(modifiedAt time.Time, size int64, task Task) bool {
	if task.ModifiedAt.IsZero() {
		return false
	}
	if size != task.Size {
		return false
	}
	return modifiedAt.Equal(task.ModifiedAt)
}
