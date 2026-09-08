package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"javboss/internal/common"
	"javboss/internal/db"
	"javboss/internal/models"
)

func TestDirectoryScanProgressCountsCurrentFilesAndSuccessfulLinks(t *testing.T) {
	resetDirectoryScanSessions(t)
	gdb, err := db.Open(filepath.Join(t.TempDir(), "scan-progress.db"))
	if err != nil {
		t.Fatal(err)
	}
	previousDB := common.DB
	common.DB = gdb
	t.Cleanup(func() {
		common.DB = previousDB
		if sqlDB, err := gdb.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})
	dir := models.Directory{Path: t.TempDir()}
	metadata := models.Jav{Code: "ABC-123"}
	video := models.Video{Fingerprint: "scan-progress", Size: 1, DurationSec: 1800}
	for _, row := range []any{&dir, &metadata, &video} {
		if err := gdb.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, fixture := range []struct {
		name    string
		linked  bool
		present bool
	}{
		{"already-linked.mp4", true, true},
		{"ABC-123.mp4", false, true},
		{"clip.mp4", false, true},
		{"old-missing.mp4", true, false},
	} {
		loc := models.VideoLocation{VideoID: video.ID, DirectoryID: dir.ID, RelativePath: fixture.name, Filename: fixture.name}
		if fixture.linked {
			loc.JavID = &metadata.ID
		}
		if fixture.present {
			path := filepath.Join(dir.Path, fixture.name)
			if err := os.WriteFile(path, []byte{0}, 0600); err != nil {
				t.Fatal(err)
			}
			info, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			loc.ModifiedAt = info.ModTime().UTC()
		}
		if err := gdb.Create(&loc).Error; err != nil {
			t.Fatal(err)
		}
	}

	// Non-video files count too, including nested files; folders themselves do not.
	if err := os.Mkdir(filepath.Join(dir.Path, "extras"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"cover.jpg", filepath.Join("extras", "info.nfo")} {
		if err := os.WriteFile(filepath.Join(dir.Path, name), []byte{0}, 0600); err != nil {
			t.Fatal(err)
		}
	}

	assertProgress := func(files, scanned, scraped int64) {
		t.Helper()
		status, progress := DirectoryWorkSnapshot(dir.ID)
		if status != DirectoryWorkScanning || progress == nil ||
			progress.ScannedFileCount != files ||
			progress.ScannedVideoCount != scanned || progress.ScrapedVideoCount != scraped {
			t.Fatalf("status=%s progress=%+v, want scanning with %d files and %d/%d videos", status, progress, files, scanned, scraped)
		}
	}
	scanCtx, finish, err := acquireDirectoryScanSession(t.Context(), dir.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer finish()
	assertProgress(0, 0, 0)
	// Delay workers so the file-scan and metadata stages can be checked independently.
	batch := &javLinkBatch{ctx: scanCtx, tasks: make(chan int64, 10), seen: make(map[int64]struct{})}
	state, err := loadDirectorySyncState(scanCtx, dir.ID, batch)
	if err != nil {
		t.Fatal(err)
	}
	if err := walkAndReconcileVideoFiles(scanCtx, dir, state, &Summary{}); err != nil {
		t.Fatal(err)
	}
	assertProgress(5, 3, 0)
	for id := range batch.seen {
		batch.Enqueue(id) // Duplicate queue entries must not inflate either counter.
	}
	batch.workers.Add(1)
	go batch.worker()
	batch.Wait()
	assertProgress(5, 3, 2)
	if status, progress := DirectoryWorkSnapshot(dir.ID + 1); status != DirectoryWorkIdle || progress != nil {
		t.Fatalf("another directory inherited scan progress: %s %+v", status, progress)
	}
	finish()
	if status, progress := DirectoryWorkSnapshot(dir.ID); status != DirectoryWorkIdle || progress != nil {
		t.Fatalf("finished scan still exposes progress: %s %+v", status, progress)
	}
	_, nextFinish, err := acquireDirectoryScanSession(t.Context(), dir.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer nextFinish()
	assertProgress(0, 0, 0)
	nextFinish()
	release, err := CancelAndReserveDirectoryScan(t.Context(), dir.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if status, progress := DirectoryWorkSnapshot(dir.ID); status != DirectoryWorkIdle || progress != nil {
		t.Fatalf("reservation exposes scan progress: %s %+v", status, progress)
	}
}

func TestCancelAndReserveDirectoryScanCancelsActiveSession(t *testing.T) {
	resetDirectoryScanSessions(t)

	scanCtx, finish, err := acquireDirectoryScanSession(context.Background(), 42)
	if err != nil {
		t.Fatalf("begin scan: %v", err)
	}
	scanDone := make(chan struct{})
	go func() {
		<-scanCtx.Done()
		finish()
		close(scanDone)
	}()

	release, err := CancelAndReserveDirectoryScan(context.Background(), 42)
	if err != nil {
		t.Fatalf("cancel and reserve scan: %v", err)
	}
	defer func() {
		if release != nil {
			release()
		}
	}()

	select {
	case <-scanDone:
	default:
		t.Fatal("active scan should be canceled and finished before reservation is returned")
	}
	if _, _, err := acquireDirectoryScanSession(context.Background(), 42); !errors.Is(err, ErrDirectoryScanInProgress) {
		t.Fatalf("reservation should block new scans: %v", err)
	}

	release()
	release = nil
	_, nextFinish, err := acquireDirectoryScanSession(context.Background(), 42)
	if err != nil {
		t.Fatalf("begin scan after reservation release: %v", err)
	}
	nextFinish()
}

func TestCancelAndReserveDirectoryScanHonorsContext(t *testing.T) {
	resetDirectoryScanSessions(t)

	_, finish, err := acquireDirectoryScanSession(context.Background(), 42)
	if err != nil {
		t.Fatalf("begin scan: %v", err)
	}
	defer finish()

	ctx, cancel := context.WithTimeout(context.Background(), time.Nanosecond)
	defer cancel()
	release, err := CancelAndReserveDirectoryScan(ctx, 42)
	if release != nil {
		release()
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("cancel should honor context deadline: %v", err)
	}
}

func TestIsDirectoryScanning(t *testing.T) {
	resetDirectoryScanSessions(t)

	if IsDirectoryScanning(42) {
		t.Fatal("directory should be idle before a scan starts")
	}

	_, finish, err := acquireDirectoryScanSession(context.Background(), 42)
	if err != nil {
		t.Fatalf("begin scan: %v", err)
	}
	if !IsDirectoryScanning(42) {
		t.Fatal("directory should report scanning while its session is active")
	}

	finish()
	if IsDirectoryScanning(42) {
		t.Fatal("directory should be idle after its scan finishes")
	}

	release, err := CancelAndReserveDirectoryScan(context.Background(), 42)
	if err != nil {
		t.Fatalf("reserve scan: %v", err)
	}
	defer release()
	if IsDirectoryScanning(42) {
		t.Fatal("directory update reservation should not be reported as scanning")
	}
}

func TestDifferentDirectoryScansCanRunConcurrently(t *testing.T) {
	resetDirectoryScanSessions(t)

	_, finishFirst, err := acquireDirectoryScanSession(context.Background(), 41)
	if err != nil {
		t.Fatalf("begin first scan: %v", err)
	}
	defer finishFirst()

	_, finishSecond, err := acquireDirectoryScanSession(context.Background(), 42)
	if err != nil {
		t.Fatalf("begin concurrent scan for another directory: %v", err)
	}
	finishSecond()
}

func TestDirectoryScanStaysActiveUntilJAVBatchCompletes(t *testing.T) {
	resetDirectoryScanSessions(t)
	gdb, err := db.Open(filepath.Join(t.TempDir(), "scan-jav-wait.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	previousDB := common.DB
	common.DB = gdb
	t.Cleanup(func() {
		common.DB = previousDB
		sqlDB, dbErr := gdb.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	dir := models.Directory{Path: t.TempDir()}
	if err := gdb.Create(&dir).Error; err != nil {
		t.Fatalf("create directory: %v", err)
	}
	scanCtx, finish, err := acquireDirectoryScanSession(t.Context(), dir.ID)
	if err != nil {
		t.Fatalf("acquire scan session: %v", err)
	}

	javWaitStarted := make(chan struct{})
	releaseJAVWorker := make(chan struct{})
	batch := &javLinkBatch{
		ctx:   scanCtx,
		tasks: make(chan int64),
		seen:  make(map[int64]struct{}),
	}
	batch.workers.Add(1)
	go func() {
		defer batch.workers.Done()
		for range batch.tasks {
		}
		close(javWaitStarted)
		<-releaseJAVWorker
	}()

	scanDone := make(chan error, 1)
	go func() {
		_, scanErr := runDirectoryScanWithSession(scanCtx, dir, batch)
		finish()
		scanDone <- scanErr
	}()

	var releaseOnce sync.Once
	scanCompleted := false
	releaseWorker := func() {
		releaseOnce.Do(func() { close(releaseJAVWorker) })
	}
	defer func() {
		releaseWorker()
		if scanCompleted {
			return
		}
		select {
		case <-scanDone:
		case <-time.After(5 * time.Second):
		}
	}()

	select {
	case <-javWaitStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("directory scan did not reach JAV batch wait")
	}
	if !IsDirectoryScanning(dir.ID) {
		t.Fatal("directory should remain scanning while its JAV batch is incomplete")
	}
	var waiting models.Directory
	if err := gdb.First(&waiting, dir.ID).Error; err != nil {
		t.Fatalf("reload directory while waiting for JAV: %v", err)
	}
	if waiting.LastScanSummary.FinishedAtUnixMS != 0 {
		t.Fatalf("scan summary was completed before JAV batch: %+v", waiting.LastScanSummary)
	}

	releaseWorker()
	scanErr := <-scanDone
	scanCompleted = true
	if scanErr != nil {
		t.Fatalf("scan directory: %v", scanErr)
	}
	if IsDirectoryScanning(dir.ID) {
		t.Fatal("directory should become idle after its JAV batch completes")
	}
	var completed models.Directory
	if err := gdb.First(&completed, dir.ID).Error; err != nil {
		t.Fatalf("reload completed directory: %v", err)
	}
	if completed.LastScanSummary.FinishedAtUnixMS == 0 {
		t.Fatal("scan summary should be completed after JAV batch")
	}
}

func TestScanDirectoryPersistsLatestSuccessfulSummary(t *testing.T) {
	resetDirectoryScanSessions(t)
	gdb, err := db.Open(filepath.Join(t.TempDir(), "scan-summary.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	previousDB := common.DB
	common.DB = gdb
	t.Cleanup(func() {
		common.DB = previousDB
		sqlDB, dbErr := gdb.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	dir := models.Directory{Path: t.TempDir()}
	if err := gdb.Create(&dir).Error; err != nil {
		t.Fatalf("create directory: %v", err)
	}
	startedAt := time.Now().Add(-time.Second).UnixMilli()
	summary, err := ScanDirectory(t.Context(), dir)
	if err != nil {
		t.Fatalf("sync directory: %v", err)
	}
	if summary.Directories != 1 {
		t.Fatalf("scanned directories = %d, want 1", summary.Directories)
	}

	var refreshed models.Directory
	if err := gdb.First(&refreshed, dir.ID).Error; err != nil {
		t.Fatalf("reload directory: %v", err)
	}
	got := refreshed.LastScanSummary
	if got.FinishedAtUnixMS < startedAt || got.FinishedAtUnixMS > time.Now().UnixMilli() {
		t.Fatalf("scan finished time = %d, want current timestamp", got.FinishedAtUnixMS)
	}
	if got.FilesSeen != summary.FilesSeen ||
		got.Inserted != summary.Inserted ||
		got.Updated != summary.Updated ||
		got.Removed != summary.Removed {
		t.Fatalf("stored summary = %+v, runtime summary = %+v", got, summary)
	}
	if got.DurationMS < 0 || got.DurationMS > summary.Duration.Milliseconds() {
		t.Fatalf("stored duration = %dms, total runtime = %s", got.DurationMS, summary.Duration)
	}

	canceledCtx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := ScanDirectory(canceledCtx, dir); err == nil {
		t.Fatal("canceled scan should fail")
	}
	var afterCanceled models.Directory
	if err := gdb.First(&afterCanceled, dir.ID).Error; err != nil {
		t.Fatalf("reload directory after canceled scan: %v", err)
	}
	if afterCanceled.LastScanSummary != got {
		t.Fatalf(
			"canceled scan replaced successful summary: got %+v, want %+v",
			afterCanceled.LastScanSummary,
			got,
		)
	}
}

func TestIsAutomaticDirectoryScanDue(t *testing.T) {
	now := time.Unix(1750000000, 0)
	tests := []struct {
		name      string
		directory models.Directory
		want      bool
	}{
		{
			name:      "disabled",
			directory: models.Directory{ID: 1, AutoScanEnabled: false, AutoScanIntervalMinutes: 1},
			want:      false,
		},
		{
			name:      "never scanned",
			directory: models.Directory{ID: 1, AutoScanEnabled: true, AutoScanIntervalMinutes: 30},
			want:      true,
		},
		{
			name: "interval not elapsed",
			directory: models.Directory{
				ID:                      1,
				AutoScanEnabled:         true,
				AutoScanIntervalMinutes: 30,
				LastScanSummary: models.DirectoryScanSummary{
					FinishedAtUnixMS: now.Add(-29 * time.Minute).UnixMilli(),
				},
			},
			want: false,
		},
		{
			name: "interval elapsed",
			directory: models.Directory{
				ID:                      1,
				AutoScanEnabled:         true,
				AutoScanIntervalMinutes: 30,
				LastScanSummary: models.DirectoryScanSummary{
					FinishedAtUnixMS: now.Add(-30 * time.Minute).UnixMilli(),
				},
			},
			want: true,
		},
		{
			name:      "deleted",
			directory: models.Directory{ID: 1, IsDelete: true, AutoScanEnabled: true, AutoScanIntervalMinutes: 1},
			want:      false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isAutomaticDirectoryScanDue(test.directory, now); got != test.want {
				t.Fatalf("isAutomaticDirectoryScanDue() = %t, want %t", got, test.want)
			}
		})
	}
}

func TestLoadDirectoryIfAutomaticScanDueRechecksLatestState(t *testing.T) {
	gdb, err := db.Open(filepath.Join(t.TempDir(), "scan-recheck.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	previousDB := common.DB
	common.DB = gdb
	t.Cleanup(func() {
		common.DB = previousDB
		sqlDB, dbErr := gdb.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	dir := models.Directory{Path: t.TempDir()}
	if err := gdb.Create(&dir).Error; err != nil {
		t.Fatalf("create directory: %v", err)
	}
	now := time.Now()
	enabled := false
	if _, err := db.UpdateDirectoryScanSettings(t.Context(), dir.ID, &enabled, nil); err != nil {
		t.Fatalf("disable automatic scan: %v", err)
	}
	current, err := loadDirectoryIfAutomaticScanDue(t.Context(), dir.ID, now)
	if err != nil {
		t.Fatalf("recheck disabled directory: %v", err)
	}
	if current != nil {
		t.Fatalf("disabled directory remained queued: %#v", current)
	}

	enabled = true
	intervalMinutes := 60
	if _, err := db.UpdateDirectoryScanSettings(t.Context(), dir.ID, &enabled, &intervalMinutes); err != nil {
		t.Fatalf("enable automatic scan: %v", err)
	}
	if err := db.UpdateDirectoryLastScanSummary(t.Context(), dir.ID, models.DirectoryScanSummary{
		FinishedAtUnixMS: now.Add(-time.Minute).UnixMilli(),
	}); err != nil {
		t.Fatalf("record newer manual scan: %v", err)
	}
	current, err = loadDirectoryIfAutomaticScanDue(t.Context(), dir.ID, now)
	if err != nil {
		t.Fatalf("recheck recently scanned directory: %v", err)
	}
	if current != nil {
		t.Fatalf("recently scanned directory remained queued: %#v", current)
	}

	newPath := t.TempDir()
	if err := gdb.Model(&models.Directory{}).Where("id = ?", dir.ID).Update("path", newPath).Error; err != nil {
		t.Fatalf("update directory path: %v", err)
	}
	if err := db.UpdateDirectoryLastScanSummary(t.Context(), dir.ID, models.DirectoryScanSummary{
		FinishedAtUnixMS: now.Add(-2 * time.Hour).UnixMilli(),
	}); err != nil {
		t.Fatalf("make directory due: %v", err)
	}
	current, err = loadDirectoryIfAutomaticScanDue(t.Context(), dir.ID, now)
	if err != nil {
		t.Fatalf("load refreshed directory: %v", err)
	}
	if current == nil || current.Path != newPath {
		t.Fatalf("directory scan did not use latest path: got %#v want %q", current, newPath)
	}
}

func resetDirectoryScanSessions(t *testing.T) {
	t.Helper()

	dirScanMu.Lock()
	previous := dirScanActive
	dirScanActive = map[int64]*directoryScanSession{}
	dirScanMu.Unlock()

	t.Cleanup(func() {
		dirScanMu.Lock()
		dirScanActive = previous
		dirScanMu.Unlock()
	})
}
