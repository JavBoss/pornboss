package models

import "time"

// ExtensionToken is an alternative credential for accessing the backend APIs.
type ExtensionToken struct {
	ID         uint       `json:"id" gorm:"primaryKey"`
	Name       string     `json:"name" gorm:"type:text;not null"`
	Token      string     `json:"token" gorm:"type:text;not null;uniqueIndex"`
	CreatedAt  time.Time  `json:"created_at" gorm:"not null"`
	ExpiresAt  time.Time  `json:"expires_at" gorm:"not null"` // Zero means the token never expires.
	LastUsedAt *time.Time `json:"last_used_at"`
}
