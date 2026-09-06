package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"javboss/internal/common"
	"javboss/internal/models"
)

var ErrExtensionTokenNotFound = errors.New("extension token not found")

func ListExtensionTokens(ctx context.Context) ([]models.ExtensionToken, error) {
	items := []models.ExtensionToken{}
	if err := common.DB.WithContext(ctx).Order("id DESC").Find(&items).Error; err != nil {
		return nil, fmt.Errorf("list extension tokens: %w", err)
	}
	return items, nil
}

func CreateExtensionToken(ctx context.Context, token *models.ExtensionToken) error {
	if err := common.DB.WithContext(ctx).Create(token).Error; err != nil {
		return fmt.Errorf("create extension token: %w", err)
	}
	return nil
}

// RotateExtensionToken invalidates the old credential atomically.
func RotateExtensionToken(ctx context.Context, id uint, credential string, expiresAt time.Time) (models.ExtensionToken, error) {
	var token models.ExtensionToken
	err := common.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&models.ExtensionToken{}).Where("id = ?", id).
			Updates(map[string]any{"token": credential, "expires_at": expiresAt, "last_used_at": nil})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrExtensionTokenNotFound
		}
		return tx.First(&token, id).Error
	})
	if err != nil {
		return token, fmt.Errorf("rotate extension token: %w", err)
	}
	return token, nil
}

func DeleteExtensionToken(ctx context.Context, id uint) error {
	result := common.DB.WithContext(ctx).Where("id = ?", id).Delete(&models.ExtensionToken{})
	if result.Error != nil {
		return fmt.Errorf("delete extension token: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		return ErrExtensionTokenNotFound
	}
	return nil
}

// UseExtensionToken atomically checks existence and expiry and records use.
func UseExtensionToken(ctx context.Context, credential string, now time.Time) (bool, error) {
	now = now.UTC()
	result := common.DB.WithContext(ctx).Model(&models.ExtensionToken{}).
		Where("token = ? AND (expires_at = ? OR expires_at > ?)", credential, time.Time{}, now).
		Update("last_used_at", now)
	if result.Error != nil {
		return false, fmt.Errorf("use extension token: %w", result.Error)
	}
	return result.RowsAffected == 1, nil
}
