package db

import (
	"context"
	"fmt"
	"strings"

	"javboss/internal/common"
	"javboss/internal/models"
)

// JavOwnership contains only the requested code and its library status.
type JavOwnership struct {
	Code  string `json:"code"`
	Owned bool   `json:"owned"`
}

// LookupJavOwnership counts undeleted file locations in undeleted directories,
// including disabled or temporarily offline directories. Metadata alone is not owned.
// Code matching ignores case, spaces, hyphens and underscores, but never prefixes.
func LookupJavOwnership(ctx context.Context, codes []string) ([]JavOwnership, error) {
	separators := strings.NewReplacer("-", "", "_", "", " ", "")
	normalize := func(code string) string {
		return separators.Replace(strings.ToUpper(code))
	}
	items := make([]JavOwnership, 0, len(codes))
	if len(codes) == 0 {
		return items, nil
	}
	keys := make([]string, 0, len(codes))
	for _, code := range codes {
		keys = append(keys, normalize(code))
	}
	locations := common.DB.WithContext(ctx).Table("video_location vl").Select("1").
		Joins("JOIN directory d ON d.id = vl.directory_id").
		Where("vl.jav_id = jav.id").
		Where("COALESCE(vl.is_delete, 0) = 0 AND COALESCE(d.is_delete, 0) = 0")
	var ownedCodes []string
	if err := common.DB.WithContext(ctx).Model(&models.Jav{}).
		Where("UPPER(REPLACE(REPLACE(REPLACE(code, '-', ''), '_', ''), ' ', '')) IN ?", keys).
		Where("EXISTS (?)", locations).Pluck("code", &ownedCodes).Error; err != nil {
		return nil, fmt.Errorf("lookup jav ownership: %w", err)
	}
	owned := make(map[string]bool, len(ownedCodes))
	for _, code := range ownedCodes {
		owned[normalize(code)] = true
	}
	for _, code := range codes {
		items = append(items, JavOwnership{Code: code, Owned: owned[normalize(code)]})
	}
	return items, nil
}
