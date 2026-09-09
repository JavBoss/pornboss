package models

import "time"

const (
	MaxLocalDownloadConcurrency         = 3
	DefaultMinVideoSizeBytes      int64 = 50 * 1024 * 1024
	DownloaderProviderCloudDrive2       = "clouddrive2"

	DownloadQueued             = "queued"
	DownloadOfflineDownloading = "offline_downloading"
	DownloadResolvingFiles     = "resolving_files"
	DownloadWaitingLocal       = "waiting_local_download"
	DownloadLocalDownloading   = "local_downloading"
	DownloadCompleted          = "completed"
	DownloadFailed             = "failed"
	DownloadCanceled           = "canceled"
)

// DownloaderSettings contains the singleton download behavior settings.
type DownloaderSettings struct {
	ID                int64     `json:"-" gorm:"primaryKey"`
	ActiveProvider    string    `json:"active_provider" gorm:"not null;default:''"`
	DownloadDirectory string    `json:"download_directory" gorm:"not null;default:''"`
	LocalConcurrency  int       `json:"local_concurrency" gorm:"not null;default:2"`
	MinVideoSizeBytes int64     `json:"min_video_size_bytes" gorm:"not null;default:52428800"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// DownloaderProviderSettings stores connection fields for one download provider.
type DownloaderProviderSettings struct {
	Provider     string    `json:"provider" gorm:"primaryKey"`
	Address      string    `json:"address" gorm:"not null;default:''"`
	APIToken     string    `json:"-" gorm:"type:text;not null;default:''"`
	RemoteFolder string    `json:"remote_folder" gorm:"not null;default:''"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// DownloadJob is a persistent magnet download job with no JAV association.
// MagnetURL is stored with the standalone task and exposed by the download list for copying.
type DownloadJob struct {
	ID                int64      `json:"id" gorm:"primaryKey"`
	DownloadDirectory string     `json:"directory_path" gorm:"not null;index;index:idx_download_job_target_hash,priority:1"`
	Provider          string     `json:"provider" gorm:"not null"`
	InfoHash          string     `json:"info_hash" gorm:"not null;index:idx_download_job_target_hash,priority:2"`
	MagnetURL         string     `json:"-" gorm:"type:text;not null"`
	MagnetName        string     `json:"magnet_name" gorm:"not null;default:''"`
	RemoteFolder      string     `json:"remote_folder" gorm:"not null;default:''"`
	RemoteTaskID      string     `json:"remote_task_id" gorm:"not null;default:''"`
	Status            string     `json:"status" gorm:"not null;default:queued;index"`
	BytesTotal        int64      `json:"bytes_total" gorm:"not null;default:0"`
	BytesDownloaded   int64      `json:"bytes_downloaded" gorm:"not null;default:0"`
	LocalFilesJSON    string     `json:"-" gorm:"type:text;not null;default:'[]'"`
	ErrorMessage      string     `json:"error_message" gorm:"type:text;not null;default:''"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	CompletedAt       *time.Time `json:"completed_at"`
}
