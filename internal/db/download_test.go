package db

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"javboss/internal/common"
	"javboss/internal/models"
)

func TestCreateDownloadJobAllowsRepeatedMagnet(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "download.db"))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	previousDB := common.DB
	common.DB = database
	t.Cleanup(func() {
		common.DB = previousDB
		if sqlDB, dbErr := database.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	downloadDirectory := t.TempDir()
	defaults, err := GetDownloaderSettings(context.Background())
	if err != nil {
		t.Fatalf("get default downloader settings: %v", err)
	}
	if defaults.ActiveProvider != models.DownloaderProviderCloudDrive2 || defaults.MinVideoSizeBytes != models.DefaultMinVideoSizeBytes {
		t.Fatalf("default small-video settings = %#v", defaults)
	}
	if err := SaveDownloaderSettings(context.Background(), &models.DownloaderSettings{
		ActiveProvider:    models.DownloaderProviderCloudDrive2,
		DownloadDirectory: downloadDirectory, LocalConcurrency: 2,
	}); err != nil {
		t.Fatalf("save downloader settings: %v", err)
	}

	job := &models.DownloadJob{
		DownloadDirectory: downloadDirectory,
		InfoHash:          "0123456789abcdef0123456789abcdef01234567",
		MagnetURL:         "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
		MagnetName:        "manual download",
		Provider:          models.DownloaderProviderCloudDrive2,
	}
	if err := CreateDownloadJob(context.Background(), job); err != nil {
		t.Fatalf("create download job: %v", err)
	}
	if job.ID <= 0 || job.Status != models.DownloadQueued {
		t.Fatalf("created download job = %#v", job)
	}

	duplicate := *job
	duplicate.ID = 0
	if err := CreateDownloadJob(context.Background(), &duplicate); err != nil {
		t.Fatalf("create repeated download job: %v", err)
	}
	if duplicate.ID <= 0 || duplicate.ID == job.ID {
		t.Fatalf("repeated download job id = %d, first id = %d", duplicate.ID, job.ID)
	}
	var count int64
	if err := database.Model(&models.DownloadJob{}).
		Where("download_directory = ? AND info_hash = ?", downloadDirectory, job.InfoHash).
		Count(&count).Error; err != nil {
		t.Fatalf("count repeated download jobs: %v", err)
	}
	if count != 2 {
		t.Fatalf("repeated download job count = %d, want 2", count)
	}
	jobs, err := ListDownloadJobs(context.Background(), 10, 0)
	if err != nil {
		t.Fatalf("list download jobs: %v", err)
	}
	if len(jobs.Items) != 2 || jobs.Items[0].MagnetURL != job.MagnetURL {
		t.Fatalf("listed download jobs = %#v", jobs)
	}
}

func TestCreateDownloadJobUsesForcedCloudDrive2Provider(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "forced-provider.db"))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	previousDB := common.DB
	common.DB = database
	t.Cleanup(func() {
		common.DB = previousDB
		if sqlDB, dbErr := database.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	downloadDirectory := t.TempDir()
	if err := SaveDownloaderSettings(context.Background(), &models.DownloaderSettings{
		DownloadDirectory: downloadDirectory, LocalConcurrency: 2,
		MinVideoSizeBytes: 75 * 1024 * 1024,
	}); err != nil {
		t.Fatalf("save downloader settings: %v", err)
	}
	settings, err := GetDownloaderSettings(context.Background())
	if err != nil {
		t.Fatalf("get downloader settings: %v", err)
	}
	if settings.ActiveProvider != models.DownloaderProviderCloudDrive2 || settings.MinVideoSizeBytes != 75*1024*1024 {
		t.Fatalf("stored small-video settings = %#v", settings)
	}
	job := &models.DownloadJob{
		DownloadDirectory: downloadDirectory,
		InfoHash:          "0123456789abcdef0123456789abcdef01234567",
		MagnetURL:         "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
		Provider:          models.DownloaderProviderCloudDrive2,
	}
	if err := CreateDownloadJob(context.Background(), job); err != nil {
		t.Fatalf("create download job: %v", err)
	}
}

func TestListDownloadJobsPaginationAndGlobalCounts(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "download-pages.db"))
	if err != nil {
		t.Fatal(err)
	}
	previousDB := common.DB
	common.DB = database
	t.Cleanup(func() {
		common.DB = previousDB
		if sqlDB, err := database.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})
	empty, err := ListDownloadJobs(t.Context(), 20, 0)
	if err != nil {
		t.Fatal(err)
	}
	if empty.Items == nil || len(empty.Items) != 0 || empty.Total != 0 || empty.Counts != (DownloadJobCounts{}) {
		t.Fatalf("unexpected empty page: %+v", empty)
	}
	statuses := []string{models.DownloadQueued, models.DownloadOfflineDownloading, models.DownloadResolvingFiles, models.DownloadWaitingLocal, models.DownloadLocalDownloading, models.DownloadCompleted, models.DownloadFailed, models.DownloadCanceled}
	jobs := make([]models.DownloadJob, 123)
	// Matching timestamps exercise the stable ID ordering at page boundaries.
	createdAt := time.Now().UTC()
	for i := range jobs {
		jobs[i] = models.DownloadJob{ID: int64(i + 1), Status: statuses[i%len(statuses)], CreatedAt: createdAt, MagnetURL: "magnet:test", LocalFilesJSON: `["/downloads/movie.mp4"]`}
	}
	if err := database.Create(&jobs).Error; err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		name                  string
		limit, offset, length int
		firstID               int64
	}{
		{"first", 20, 0, 20, 123},
		{"second", 20, 20, 20, 103},
		{"past old 100 limit", 20, 100, 20, 23},
		{"last partial page", 20, 120, 3, 3},
		{"out of range", 20, 140, 0, 0},
		{"negative offset", 20, -1, 20, 123},
		{"default limit", 0, 0, 20, 123},
		{"excessive limit", 501, 0, 20, 123},
	} {
		t.Run(tt.name, func(t *testing.T) {
			page, err := ListDownloadJobs(t.Context(), tt.limit, tt.offset)
			if err != nil {
				t.Fatal(err)
			}
			if page.Total != 123 || page.Counts != (DownloadJobCounts{Active: 78, Completed: 15, Failed: 15}) {
				t.Fatalf("incorrect global totals: %+v", page)
			}
			if len(page.Items) != tt.length {
				t.Fatalf("length = %d, want %d", len(page.Items), tt.length)
			}
			for i, item := range page.Items {
				if item.ID != tt.firstID-int64(i) {
					t.Fatalf("item %d: id = %d", i, item.ID)
				}
				if item.MagnetURL != "magnet:test" || len(item.LocalFiles) != 1 || item.LocalFiles[0] != "/downloads/movie.mp4" {
					t.Fatalf("missing task details: %+v", item)
				}
			}
		})
	}
}
