package models

import "time"

// VideoLocation records where a video content entity appears on disk.
type VideoLocation struct {
	ID           int64     `json:"id" gorm:"primaryKey"`
	VideoID      int64     `json:"video_id" gorm:"index;index:idx_video_location_video_id_jav_id,priority:1;not null"`
	DirectoryID  int64     `json:"directory_id" gorm:"index;not null;uniqueIndex:idx_video_location_directory_path"`
	RelativePath string    `json:"relative_path" gorm:"not null;uniqueIndex:idx_video_location_directory_path;index:idx_video_location_visible_path,priority:3"`
	Filename     string    `json:"filename" gorm:"index;index:idx_video_location_visible_filename,priority:3,collate:NOCASE"`
	ModifiedAt   time.Time `json:"modified_at"`
	JavID        *int64    `json:"jav_id" gorm:"index;index:idx_video_location_jav_id_is_delete,priority:1;index:idx_video_location_video_id_jav_id,priority:2;index:idx_video_location_visible_path,priority:1;index:idx_video_location_visible_filename,priority:1"`
	Jav          *Jav      `json:"jav,omitempty" gorm:"-"`
	IsDelete     bool      `json:"is_delete" gorm:"index;index:idx_video_location_jav_id_is_delete,priority:2;index:idx_video_location_visible_path,priority:2;index:idx_video_location_visible_filename,priority:2"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	StrmDigest   string    `json:"strm_digest,omitempty" gorm:"not null;default:''"`

	Video        Video     `json:"-" gorm:"foreignKey:VideoID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	DirectoryRef Directory `json:"directory,omitempty" gorm:"foreignKey:DirectoryID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:RESTRICT"`
}
