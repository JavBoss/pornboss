package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"javboss/internal/common"
	"javboss/internal/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type DownloadJobResult struct {
	models.DownloadJob
	LocalFiles []string `json:"local_files"`
	MagnetURL  string   `json:"magnet_url"`
}

func GetDownloaderSettings(ctx context.Context) (*models.DownloaderSettings, error) {
	if common.DB == nil {
		return nil, errors.New("get downloader settings: nil db")
	}
	var settings models.DownloaderSettings
	err := common.DB.WithContext(ctx).First(&settings, 1).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &models.DownloaderSettings{
			ID: 1, ActiveProvider: models.DownloaderProviderCloudDrive2, LocalConcurrency: 2,
			MinVideoSizeBytes: models.DefaultMinVideoSizeBytes,
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get downloader settings: %w", err)
	}
	settings.ActiveProvider = models.DownloaderProviderCloudDrive2
	return &settings, nil
}

func SaveDownloaderSettings(ctx context.Context, settings *models.DownloaderSettings) error {
	if common.DB == nil {
		return errors.New("save downloader settings: nil db")
	}
	if settings == nil {
		return errors.New("save downloader settings: missing settings")
	}
	settings.ID = 1
	settings.ActiveProvider = models.DownloaderProviderCloudDrive2
	settings.DownloadDirectory = strings.TrimSpace(settings.DownloadDirectory)
	if settings.LocalConcurrency < 1 || settings.LocalConcurrency > models.MaxLocalDownloadConcurrency {
		settings.LocalConcurrency = 2
	}
	if settings.MinVideoSizeBytes <= 0 {
		settings.MinVideoSizeBytes = models.DefaultMinVideoSizeBytes
	}
	now := time.Now().UTC()
	if err := common.DB.WithContext(ctx).Exec(`
		INSERT INTO downloader_settings (
			id, active_provider, download_directory, local_concurrency,
			min_video_size_bytes, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			active_provider = excluded.active_provider,
			download_directory = excluded.download_directory,
			local_concurrency = excluded.local_concurrency,
			min_video_size_bytes = excluded.min_video_size_bytes,
			updated_at = excluded.updated_at`,
		settings.ID, settings.ActiveProvider, settings.DownloadDirectory, settings.LocalConcurrency,
		settings.MinVideoSizeBytes, now, now,
	).Error; err != nil {
		return fmt.Errorf("save downloader settings: %w", err)
	}
	return nil
}

func GetDownloaderProviderSettings(ctx context.Context, provider string) (*models.DownloaderProviderSettings, error) {
	if common.DB == nil {
		return nil, errors.New("get downloader provider settings: nil db")
	}
	provider = strings.TrimSpace(provider)
	if provider == "" {
		return nil, errors.New("get downloader provider settings: missing provider")
	}
	var settings models.DownloaderProviderSettings
	err := common.DB.WithContext(ctx).First(&settings, "provider = ?", provider).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &models.DownloaderProviderSettings{Provider: provider}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get downloader provider settings: %w", err)
	}
	return &settings, nil
}

func SaveDownloaderProviderSettings(ctx context.Context, settings *models.DownloaderProviderSettings) error {
	if common.DB == nil {
		return errors.New("save downloader provider settings: nil db")
	}
	if settings == nil {
		return errors.New("save downloader provider settings: missing settings")
	}
	settings.Provider = strings.TrimSpace(settings.Provider)
	if settings.Provider == "" {
		return errors.New("save downloader provider settings: missing provider")
	}
	settings.Address = strings.TrimSpace(settings.Address)
	settings.RemoteFolder = strings.TrimSpace(settings.RemoteFolder)
	if err := common.DB.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "provider"}},
		DoUpdates: clause.AssignmentColumns([]string{"address", "api_token", "remote_folder", "updated_at"}),
	}).Create(settings).Error; err != nil {
		return fmt.Errorf("save downloader provider settings: %w", err)
	}
	return nil
}

func CreateDownloadJob(ctx context.Context, job *models.DownloadJob) error {
	if common.DB == nil {
		return errors.New("create download job: nil db")
	}
	if job == nil {
		return errors.New("create download job: missing job")
	}
	job.InfoHash = strings.TrimSpace(job.InfoHash)
	job.MagnetURL = strings.TrimSpace(job.MagnetURL)
	job.MagnetName = strings.TrimSpace(job.MagnetName)
	job.DownloadDirectory = strings.TrimSpace(job.DownloadDirectory)
	if job.DownloadDirectory == "" || job.InfoHash == "" || job.MagnetURL == "" {
		return errors.New("create download job: invalid job")
	}
	if job.Provider != models.DownloaderProviderCloudDrive2 {
		return errors.New("create download job: invalid provider")
	}
	job.Status = models.DownloadQueued
	job.LocalFilesJSON = "[]"
	if err := common.DB.WithContext(ctx).Create(job).Error; err != nil {
		return fmt.Errorf("create download job: %w", err)
	}
	return nil
}

func GetDownloadJob(ctx context.Context, id int64) (*models.DownloadJob, error) {
	if common.DB == nil {
		return nil, errors.New("get download job: nil db")
	}
	var job models.DownloadJob
	if err := common.DB.WithContext(ctx).First(&job, id).Error; err != nil {
		return nil, fmt.Errorf("get download job: %w", err)
	}
	return &job, nil
}

type DownloadJobCounts struct {
	Active    int64 `json:"active"`
	Completed int64 `json:"completed"`
	Failed    int64 `json:"failed"`
}

type DownloadJobPage struct {
	Items  []DownloadJobResult `json:"items"`
	Total  int64               `json:"total"`
	Counts DownloadJobCounts   `json:"counts"`
}

func ListDownloadJobs(ctx context.Context, limit, offset int) (*DownloadJobPage, error) {
	if common.DB == nil {
		return nil, errors.New("list download jobs: nil db")
	}
	if limit <= 0 || limit > 500 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	result := &DownloadJobPage{Items: []DownloadJobResult{}}
	// Keep counts and rows consistent if tasks are created or removed concurrently.
	err := common.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var statuses []struct {
			Status string
			Count  int64
		}
		if err := tx.Model(&models.DownloadJob{}).Select("status, COUNT(*) AS count").Group("status").Scan(&statuses).Error; err != nil {
			return err
		}
		for _, status := range statuses {
			result.Total += status.Count
			switch status.Status {
			case models.DownloadQueued, models.DownloadOfflineDownloading, models.DownloadResolvingFiles, models.DownloadWaitingLocal, models.DownloadLocalDownloading:
				result.Counts.Active += status.Count
			case models.DownloadCompleted:
				result.Counts.Completed += status.Count
			case models.DownloadFailed:
				result.Counts.Failed += status.Count
			}
		}
		var rows []models.DownloadJob
		if err := tx.Model(&models.DownloadJob{}).Order("created_at DESC, id DESC").Limit(limit).Offset(offset).Scan(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			files := []string{}
			_ = json.Unmarshal([]byte(row.LocalFilesJSON), &files)
			result.Items = append(result.Items, DownloadJobResult{DownloadJob: row, LocalFiles: files, MagnetURL: row.MagnetURL})
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("list download jobs: %w", err)
	}
	return result, nil
}

func ResetInterruptedDownloadJobs(ctx context.Context) error {
	if common.DB == nil {
		return errors.New("reset download jobs: nil db")
	}
	active := []string{
		models.DownloadOfflineDownloading,
		models.DownloadResolvingFiles,
		models.DownloadWaitingLocal,
		models.DownloadLocalDownloading,
	}
	if err := common.DB.WithContext(ctx).Model(&models.DownloadJob{}).
		Where("status IN ?", active).
		Updates(map[string]any{"status": models.DownloadQueued, "error_message": ""}).Error; err != nil {
		return fmt.Errorf("reset download jobs: %w", err)
	}
	return nil
}

func ClaimNextQueuedDownloadJob(ctx context.Context, provider string) (*models.DownloadJob, error) {
	if common.DB == nil {
		return nil, errors.New("claim download job: nil db")
	}
	if provider != models.DownloaderProviderCloudDrive2 {
		return nil, errors.New("claim download job: invalid provider")
	}
	for attempts := 0; attempts < 10; attempts++ {
		var job models.DownloadJob
		err := common.DB.WithContext(ctx).
			Where("status = ? AND provider = ?", models.DownloadQueued, provider).
			Order("created_at, id").
			First(&job).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, fmt.Errorf("claim download job: %w", err)
		}
		result := common.DB.WithContext(ctx).Model(&models.DownloadJob{}).
			Where("id = ? AND status = ? AND provider = ?", job.ID, models.DownloadQueued, provider).
			Updates(map[string]any{
				"status": models.DownloadOfflineDownloading, "error_message": "",
			})
		if result.Error != nil {
			return nil, fmt.Errorf("claim download job: %w", result.Error)
		}
		if result.RowsAffected == 1 {
			job.Status = models.DownloadOfflineDownloading
			job.ErrorMessage = ""
			return &job, nil
		}
	}
	return nil, errors.New("claim download job: too much contention")
}

func UpdateDownloadJob(ctx context.Context, id int64, updates map[string]any) error {
	if common.DB == nil {
		return errors.New("update download job: nil db")
	}
	if id <= 0 || len(updates) == 0 {
		return nil
	}
	if err := common.DB.WithContext(ctx).Model(&models.DownloadJob{}).
		Where("id = ?", id).Updates(updates).Error; err != nil {
		return fmt.Errorf("update download job: %w", err)
	}
	return nil
}

func RetryDownloadJob(ctx context.Context, id int64) error {
	result := common.DB.WithContext(ctx).Model(&models.DownloadJob{}).
		Where("id = ? AND status IN ?", id, []string{models.DownloadFailed, models.DownloadCanceled}).
		Updates(map[string]any{
			"status": models.DownloadQueued, "error_message": "", "completed_at": nil,
			"remote_task_id": "", "bytes_total": 0, "bytes_downloaded": 0,
		})
	if result.Error != nil {
		return fmt.Errorf("retry download job: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func CancelDownloadJob(ctx context.Context, id int64) error {
	result := common.DB.WithContext(ctx).Model(&models.DownloadJob{}).
		Where("id = ? AND status NOT IN ?", id, []string{models.DownloadCompleted, models.DownloadCanceled}).
		Updates(map[string]any{"status": models.DownloadCanceled, "error_message": ""})
	if result.Error != nil {
		return fmt.Errorf("cancel download job: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func DeleteDownloadJob(ctx context.Context, id int64) error {
	result := common.DB.WithContext(ctx).
		Where("id = ? AND status IN ?", id, []string{
			models.DownloadCompleted, models.DownloadFailed, models.DownloadCanceled,
		}).Delete(&models.DownloadJob{})
	if result.Error != nil {
		return fmt.Errorf("delete download job: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func CompleteDownloadJob(ctx context.Context, id int64, files []string, total int64, warning string) error {
	if common.DB == nil {
		return errors.New("complete download job: nil db")
	}
	if id <= 0 {
		return nil
	}
	raw, err := json.Marshal(files)
	if err != nil {
		return fmt.Errorf("encode download job local files: %w", err)
	}
	now := time.Now().UTC()
	return common.DB.WithContext(ctx).Model(&models.DownloadJob{}).
		Where("id = ? AND status <> ?", id, models.DownloadCanceled).Updates(map[string]any{
		"status":           models.DownloadCompleted,
		"bytes_total":      total,
		"bytes_downloaded": total,
		"local_files_json": string(raw),
		"error_message":    warning,
		"completed_at":     &now,
	}).Error
}
