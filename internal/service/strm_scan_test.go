package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"javboss/internal/common"
	"javboss/internal/db"
	"javboss/internal/models"
	"javboss/internal/util"

	"gorm.io/gorm"
)

func TestScanSTRMUsesDigestAndMtimeWithoutUnnecessaryRemoteProbe(t *testing.T) {
	resetDirectoryScanSessions(t)
	directoryPath := t.TempDir()
	gdb, err := db.Open(filepath.Join(t.TempDir(), "strm-scan.db"))
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

	directory := models.Directory{Path: directoryPath}
	if err := gdb.Create(&directory).Error; err != nil {
		t.Fatalf("create directory: %v", err)
	}
	strmPath := filepath.Join(directoryPath, "movie.strm")
	firstTime := time.Unix(1_750_000_000, 0).UTC()
	writeSTRMAt(t, strmPath, "https://media.example/first.mp4\n", firstTime)

	previousProbe := probeVideoContext
	probeCalls := 0
	probeVideoContext = func(_ context.Context, input string) (*util.VideoMetadata, error) {
		probeCalls++
		switch input {
		case "https://media.example/first.mp4":
			return strmTestMetadata(1000, 120), nil
		case "https://media.example/second.mp4":
			return strmTestMetadata(2000, 240), nil
		case "https://media.example/unavailable.mp4":
			return nil, errors.New("remote unavailable")
		default:
			return nil, errors.New("unexpected input")
		}
	}
	t.Cleanup(func() { probeVideoContext = previousProbe })

	if _, err := ScanDirectory(t.Context(), directory); err != nil {
		t.Fatalf("first scan: %v", err)
	}
	if probeCalls != 1 {
		t.Fatalf("probe calls after first scan = %d, want 1", probeCalls)
	}
	firstLoc, firstVideo := loadSTRMScanState(t, gdb, directory.ID)
	if firstLoc.StrmDigest == "" || firstVideo.Size != 1000 || firstVideo.DurationSec != 120 {
		t.Fatalf("unexpected first state: loc=%#v video=%#v", firstLoc, firstVideo)
	}

	secondTime := firstTime.Add(time.Minute)
	writeSTRMAt(t, strmPath, "https://media.example/first.mp4\n", secondTime)
	if _, err := ScanDirectory(t.Context(), directory); err != nil {
		t.Fatalf("mtime-only scan: %v", err)
	}
	if probeCalls != 1 {
		t.Fatalf("mtime-only change triggered probe: calls=%d", probeCalls)
	}
	mtimeLoc, mtimeVideo := loadSTRMScanState(t, gdb, directory.ID)
	if !mtimeLoc.ModifiedAt.Equal(secondTime) || mtimeLoc.StrmDigest != firstLoc.StrmDigest || mtimeVideo.ID != firstVideo.ID {
		t.Fatalf("unexpected mtime-only state: loc=%#v video=%#v", mtimeLoc, mtimeVideo)
	}

	// Preserve mtime while changing content: scanning must still read the locator,
	// notice the digest change, and probe the new target.
	writeSTRMAt(t, strmPath, "https://media.example/second.mp4\n", secondTime)
	if _, err := ScanDirectory(t.Context(), directory); err != nil {
		t.Fatalf("digest-change scan: %v", err)
	}
	if probeCalls != 2 {
		t.Fatalf("digest change probe calls = %d, want 2", probeCalls)
	}
	secondLoc, secondVideo := loadSTRMScanState(t, gdb, directory.ID)
	if secondLoc.StrmDigest == firstLoc.StrmDigest || secondVideo.Size != 2000 || secondVideo.DurationSec != 240 {
		t.Fatalf("unexpected digest-change state: loc=%#v video=%#v", secondLoc, secondVideo)
	}

	failedTime := secondTime.Add(time.Minute)
	writeSTRMAt(t, strmPath, "https://media.example/unavailable.mp4\n", failedTime)
	if _, err := ScanDirectory(t.Context(), directory); err != nil {
		t.Fatalf("failed-probe scan: %v", err)
	}
	if probeCalls != 3 {
		t.Fatalf("failed target probe calls = %d, want 3", probeCalls)
	}
	failedLoc, failedVideo := loadSTRMScanState(t, gdb, directory.ID)
	if failedLoc.StrmDigest != secondLoc.StrmDigest || !failedLoc.ModifiedAt.Equal(secondLoc.ModifiedAt) || failedVideo.ID != secondVideo.ID || failedLoc.IsDelete {
		t.Fatalf("failed probe should preserve prior state: loc=%#v video=%#v", failedLoc, failedVideo)
	}
}

func TestScanSTRMRequiresRemoteDurationAndSize(t *testing.T) {
	tests := []struct {
		name string
		meta *util.VideoMetadata
	}{
		{name: "missing duration", meta: strmTestMetadata(1000, 0)},
		{name: "missing size", meta: strmTestMetadata(0, 120)},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			resetDirectoryScanSessions(t)
			directoryPath := t.TempDir()
			gdb, err := db.Open(filepath.Join(t.TempDir(), "strm-required.db"))
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

			directory := models.Directory{Path: directoryPath}
			if err := gdb.Create(&directory).Error; err != nil {
				t.Fatalf("create directory: %v", err)
			}
			writeSTRMAt(t, filepath.Join(directoryPath, "movie.strm"), "https://media.example/movie.mp4\n", time.Now().UTC())

			previousProbe := probeVideoContext
			probeVideoContext = func(context.Context, string) (*util.VideoMetadata, error) { return test.meta, nil }
			t.Cleanup(func() { probeVideoContext = previousProbe })

			if _, err := ScanDirectory(t.Context(), directory); err != nil {
				t.Fatalf("scan: %v", err)
			}
			var count int64
			if err := gdb.Model(&models.VideoLocation{}).Count(&count).Error; err != nil {
				t.Fatalf("count locations: %v", err)
			}
			if count != 0 {
				t.Fatalf("locations = %d, want 0", count)
			}
		})
	}
}

func writeSTRMAt(t *testing.T, path, content string, modifiedAt time.Time) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write strm: %v", err)
	}
	if err := os.Chtimes(path, modifiedAt, modifiedAt); err != nil {
		t.Fatalf("set strm mtime: %v", err)
	}
}

func strmTestMetadata(size int64, duration float64) *util.VideoMetadata {
	return &util.VideoMetadata{
		Width:           1920,
		Height:          1080,
		FormatBitRate:   size * 8,
		VideoBitRate:    size * 6,
		AudioBitRate:    size,
		DurationSeconds: duration,
		Size:            size,
	}
}

func loadSTRMScanState(t *testing.T, gdb *gorm.DB, directoryID int64) (models.VideoLocation, models.Video) {
	t.Helper()
	var loc models.VideoLocation
	if err := gdb.Where("directory_id = ?", directoryID).First(&loc).Error; err != nil {
		t.Fatalf("load strm location: %v", err)
	}
	var video models.Video
	if err := gdb.First(&video, loc.VideoID).Error; err != nil {
		t.Fatalf("load strm video: %v", err)
	}
	return loc, video
}
