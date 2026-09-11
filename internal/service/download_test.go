package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"

	"javboss/internal/common"
	"javboss/internal/db"
	"javboss/internal/models"
	"path/filepath"
	"testing"
	"time"

	"javboss/internal/downloader"
)

func TestParseMagnetInfoHash(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		want    string
		wantErr bool
	}{
		{name: "hex", value: "magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567&dn=test", want: "0123456789abcdef0123456789abcdef01234567"},
		{name: "base32", value: "magnet:?xt=urn:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", want: "abcdefghijklmnopqrstuvwxyz234567"},
		{name: "missing hash", value: "magnet:?dn=test", wantErr: true},
		{name: "wrong scheme", value: "https://example.com/file", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := ParseMagnetInfoHash(test.value)
			if test.wantErr {
				if err == nil {
					t.Fatalf("ParseMagnetInfoHash() = %q, want error", got)
				}
				return
			}
			if err != nil || got != test.want {
				t.Fatalf("ParseMagnetInfoHash() = %q, %v; want %q", got, err, test.want)
			}
		})
	}
}

func TestFilterSmallRemoteVideos(t *testing.T) {
	files := []downloader.RemoteFile{
		{Name: "large.mp4", Size: 51 * 1024 * 1024},
		{Name: "small.mp4", Size: 49 * 1024 * 1024},
		{Name: "archive.zip", Size: 10 * 1024 * 1024},
		{Name: "subtitle.srt", Size: 1024},
		{Name: "unknown.mp4", Size: 0},
	}
	got := filterSmallRemoteVideos(files, 50*1024*1024)
	if len(got) != 4 || got[0].Name != "large.mp4" || got[1].Name != "archive.zip" || got[2].Name != "subtitle.srt" || got[3].Name != "unknown.mp4" {
		t.Fatalf("filterSmallRemoteVideos() = %#v", got)
	}
	if unfiltered := filterSmallRemoteVideos(files, 0); len(unfiltered) != len(files) {
		t.Fatalf("disabled filter returned %d files, want %d", len(unfiltered), len(files))
	}
}

func TestSafeLocalDownloadPathStaysInsideRoot(t *testing.T) {
	root := t.TempDir()
	got, err := safeLocalDownloadPath(root, "../../folder/ABC-001.mp4")
	if err != nil {
		t.Fatalf("safeLocalDownloadPath() error = %v", err)
	}
	want := filepath.Join(root, "folder", "ABC-001.mp4")
	if got != want {
		t.Fatalf("safeLocalDownloadPath() = %q, want %q", got, want)
	}
}

func TestSafeLocalNamePreservesUnicodeAndExtension(t *testing.T) {
	if got := safeLocalName("作品：ABC-001.mp4"); got != "作品：ABC-001.mp4" {
		t.Fatalf("safeLocalName() = %q", got)
	}
}

func TestLocalDownloadLimiterCanIncreaseWhileJobsWait(t *testing.T) {
	limiter := newLocalDownloadLimiter(1)
	if err := limiter.acquire(context.Background()); err != nil {
		t.Fatalf("acquire first slot: %v", err)
	}

	acquired := make(chan error, 1)
	go func() {
		acquired <- limiter.acquire(context.Background())
	}()
	select {
	case err := <-acquired:
		t.Fatalf("second slot acquired before limit changed: %v", err)
	case <-time.After(25 * time.Millisecond):
	}

	limiter.setLimit(2)
	select {
	case err := <-acquired:
		if err != nil {
			t.Fatalf("acquire second slot: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("second slot did not acquire after limit increased")
	}
	limiter.release()
	limiter.release()
}

func TestLocalDownloadLimiterWaitHonorsCancellation(t *testing.T) {
	limiter := newLocalDownloadLimiter(1)
	if err := limiter.acquire(context.Background()); err != nil {
		t.Fatalf("acquire first slot: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := limiter.acquire(ctx); err != context.Canceled {
		t.Fatalf("waiting acquire error = %v, want context.Canceled", err)
	}
	limiter.release()
}

func TestLocalDownloadLimiterAllowsThreeDownloads(t *testing.T) {
	limiter := newLocalDownloadLimiter(3)
	for i := 0; i < 3; i++ {
		if err := limiter.acquire(t.Context()); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := limiter.acquire(ctx); err != context.Canceled {
		t.Fatalf("fourth download acquired a slot: %v", err)
	}
	limiter.release()
	if err := limiter.acquire(t.Context()); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		limiter.release()
	}
}

type downloadFilesTestClient struct {
	downloader.Client
	source func(context.Context, string) (*downloader.DownloadSource, error)
}

func (c downloadFilesTestClient) DownloadSource(ctx context.Context, remotePath string) (*downloader.DownloadSource, error) {
	return c.source(ctx, remotePath)
}

func setupDownloadFilesTest(t *testing.T) *models.DownloadJob {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "download-files.db"))
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
	job := &models.DownloadJob{DownloadDirectory: t.TempDir(), Status: models.DownloadLocalDownloading, BytesTotal: 10}
	if err := database.Create(job).Error; err != nil {
		t.Fatal(err)
	}
	return job
}

func TestDownloadJobFilesContinuesAfterFileErrors(t *testing.T) {
	for _, failure := range []string{"rename", "http", "source", "subdirectory"} {
		t.Run(failure, func(t *testing.T) {
			job := setupDownloadFilesTest(t)
			failedName := "bad.htm"
			if failure == "rename" {
				// A directory at the final target makes renaming the completed .part fail.
				if err := os.Mkdir(filepath.Join(job.DownloadDirectory, failedName), 0700); err != nil {
					t.Fatal(err)
				}
			}
			if failure == "subdirectory" {
				if err := os.WriteFile(filepath.Join(job.DownloadDirectory, "blocked"), []byte("file"), 0600); err != nil {
					t.Fatal(err)
				}
				failedName = "blocked/bad.htm"
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if failure == "http" && strings.HasSuffix(r.URL.Path, "bad.htm") {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				_, _ = w.Write([]byte("video"))
			}))
			defer server.Close()
			client := downloadFilesTestClient{source: func(ctx context.Context, remotePath string) (*downloader.DownloadSource, error) {
				if failure == "source" && strings.HasSuffix(remotePath, "bad.htm") {
					return nil, errors.New("file unavailable")
				}
				return &downloader.DownloadSource{URL: server.URL + remotePath, Headers: make(http.Header)}, nil
			}}
			files := []downloader.RemoteFile{{Name: "earlier.mp4", Path: "/remote/earlier.mp4", Size: 5}, {Name: failedName, Path: "/remote/" + failedName, Size: 5}, {Name: "movie.mp4", Path: "/remote/movie.mp4", Size: 5}}
			if err := downloadJobFiles(t.Context(), job, client, "/remote", files); err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(job.DownloadDirectory, "movie.mp4")
			content, err := os.ReadFile(target)
			if err != nil || string(content) != "video" {
				t.Fatalf("later video not downloaded: %q, %v", content, err)
			}
			stored, err := db.GetDownloadJob(t.Context(), job.ID)
			if err != nil {
				t.Fatal(err)
			}
			if stored.Status != models.DownloadCompleted || stored.CompletedAt == nil {
				t.Fatalf("task not complete: %+v", stored)
			}
			if stored.BytesDownloaded != 10 || stored.BytesTotal != 10 {
				t.Fatalf("failed file included in totals: %+v", stored)
			}
			if !strings.Contains(stored.ErrorMessage, "Skipped 1 of 3") || !strings.Contains(stored.ErrorMessage, failedName) {
				t.Fatalf("missing skipped-file warning: %s", stored.ErrorMessage)
			}
			var localFiles []string
			if err := json.Unmarshal([]byte(stored.LocalFilesJSON), &localFiles); err != nil {
				t.Fatal(err)
			}
			if len(localFiles) != 2 || localFiles[0] != filepath.Join(job.DownloadDirectory, "earlier.mp4") || localFiles[1] != target {
				t.Fatalf("unexpected completed files: %v", localFiles)
			}
		})
	}
}

func TestDownloadJobFilesAllFailuresStillAttemptsEveryFile(t *testing.T) {
	job := setupDownloadFilesTest(t)
	attempts := 0
	client := downloadFilesTestClient{source: func(context.Context, string) (*downloader.DownloadSource, error) {
		attempts++
		return nil, errors.New("source unavailable")
	}}
	files := []downloader.RemoteFile{{Name: "first.mp4", Size: 5}, {Name: "second.mp4", Size: 5}}
	err := downloadJobFiles(t.Context(), job, client, "/remote", files)
	if err == nil || !strings.Contains(err.Error(), "all files failed") || attempts != 2 {
		t.Fatalf("attempts=%d, error=%v", attempts, err)
	}
	stored, err := db.GetDownloadJob(t.Context(), job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status == models.DownloadCompleted || stored.CompletedAt != nil {
		t.Fatal("all-failed task marked completed")
	}
}

func TestDownloadJobFilesCancellationStopsFollowingFiles(t *testing.T) {
	job := setupDownloadFilesTest(t)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	attempts := 0
	client := downloadFilesTestClient{source: func(context.Context, string) (*downloader.DownloadSource, error) {
		attempts++
		cancel()
		return nil, context.Canceled
	}}
	err := downloadJobFiles(ctx, job, client, "/remote", []downloader.RemoteFile{{Name: "first.mp4"}, {Name: "second.mp4"}})
	if !errors.Is(err, context.Canceled) || attempts != 1 {
		t.Fatalf("attempts=%d, error=%v", attempts, err)
	}
}

func TestCompleteDownloadJobPreservesCancellation(t *testing.T) {
	job := setupDownloadFilesTest(t)
	if err := db.CancelDownloadJob(t.Context(), job.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.CompleteDownloadJob(t.Context(), job.ID, []string{"movie.mp4"}, 5, "warning"); err != nil {
		t.Fatal(err)
	}
	stored, err := db.GetDownloadJob(t.Context(), job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != models.DownloadCanceled || stored.CompletedAt != nil {
		t.Fatalf("cancellation overwritten: %+v", stored)
	}
}
