package db

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"javboss/internal/common"
	"javboss/internal/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	JavFavoriteEntityJav    = "jav"
	JavFavoriteEntityIdol   = "idol"
	JavFavoriteEntityStudio = "studio"
	JavFavoriteEntitySeries = "series"
)

// JavFavoriteGroupSummary represents a favorite group with a visible item count.
type JavFavoriteGroupSummary struct {
	ID         int64  `json:"id"`
	EntityType string `json:"entity_type"`
	Name       string `json:"name"`
	Count      int64  `json:"count"`
	SortOrder  int    `json:"sort_order"`
}

type JavFavoriteCount struct {
	ID            int64 `json:"id" gorm:"column:entity_id"`
	FavoriteCount int64 `json:"favorite_count"`
}

// AddJavsToFavoriteGroups appends JAV items to every selected group atomically.
// Existing memberships and their order are preserved; new items follow javIDs order.
func AddJavsToFavoriteGroups(ctx context.Context, javIDs, groupIDs []int64) ([]JavFavoriteCount, error) {
	for _, ids := range [][]int64{javIDs, groupIDs} {
		if len(ids) == 0 {
			return nil, errors.New("jav_ids and group_ids are required")
		}
		for _, id := range ids {
			if id <= 0 {
				return nil, errors.New("ids must be positive")
			}
		}
	}
	javIDs = uniqueInt64s(javIDs)
	groupIDs = uniqueInt64s(groupIDs)
	const batchSize = 400
	counts := make([]JavFavoriteCount, 0, len(javIDs))
	err := common.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for start := 0; start < len(javIDs); start += batchSize {
			batch := javIDs[start:min(start+batchSize, len(javIDs))]
			var count int64
			if err := tx.Model(&models.Jav{}).Where("id IN ?", batch).Count(&count).Error; err != nil {
				return fmt.Errorf("find jav items: %w", err)
			}
			if count != int64(len(batch)) {
				return gorm.ErrRecordNotFound
			}
		}
		for _, groupID := range groupIDs {
			var group models.JavFavoriteGroup
			if err := tx.Where("id = ? AND entity_type = ?", groupID, JavFavoriteEntityJav).First(&group).Error; err != nil {
				return fmt.Errorf("find jav favorite group: %w", err)
			}
			nextOrder, err := nextJavFavoriteMapSortOrderTx(tx, groupID)
			if err != nil {
				return err
			}
			for start := 0; start < len(javIDs); start += batchSize {
				batch := javIDs[start:min(start+batchSize, len(javIDs))]
				var existingIDs []int64
				if err := tx.Model(&models.JavFavoriteMap{}).
					Where("jav_favorite_group_id = ? AND entity_type = ? AND entity_id IN ?", groupID, JavFavoriteEntityJav, batch).
					Pluck("entity_id", &existingIDs).Error; err != nil {
					return fmt.Errorf("find existing jav favorites: %w", err)
				}
				existing := make(map[int64]bool, len(existingIDs))
				for _, id := range existingIDs {
					existing[id] = true
				}
				rows := make([]models.JavFavoriteMap, 0, len(batch))
				for _, id := range batch {
					if existing[id] {
						continue
					}
					rows = append(rows, models.JavFavoriteMap{
						JavFavoriteGroupID: groupID,
						EntityType:         JavFavoriteEntityJav,
						EntityID:           id,
						SortOrder:          nextOrder,
					})
					nextOrder++
				}
				if len(rows) > 0 {
					if err := tx.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(&rows, 100).Error; err != nil {
						return fmt.Errorf("add jav favorites: %w", err)
					}
				}
			}
		}
		for start := 0; start < len(javIDs); start += batchSize {
			batch := javIDs[start:min(start+batchSize, len(javIDs))]
			var batchCounts []JavFavoriteCount
			if err := tx.Model(&models.JavFavoriteMap{}).
				Select("entity_id, COUNT(*) AS favorite_count").
				Where("entity_type = ? AND entity_id IN ?", JavFavoriteEntityJav, batch).
				Group("entity_id").Scan(&batchCounts).Error; err != nil {
				return fmt.Errorf("load jav favorite counts: %w", err)
			}
			counts = append(counts, batchCounts...)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return counts, nil
}

type JavFavoriteItemSummary struct {
	ID           int64  `json:"id"`
	EntityType   string `json:"entity_type"`
	Name         string `json:"name"`
	RomanName    string `json:"roman_name"`
	JapaneseName string `json:"japanese_name"`
	ChineseName  string `json:"chinese_name"`
	Code         string `json:"code"`
	Title        string `json:"title"`
	WorkCount    int64  `json:"work_count"`
	SampleCode   string `json:"sample_code"`
}

func normalizeJavFavoriteEntityType(entityType string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(entityType)) {
	case JavFavoriteEntityJav, "work", "works", "movie", "item":
		return JavFavoriteEntityJav, nil
	case JavFavoriteEntityIdol, "actress", "idols":
		return JavFavoriteEntityIdol, nil
	case JavFavoriteEntityStudio, "studios":
		return JavFavoriteEntityStudio, nil
	case JavFavoriteEntitySeries:
		return JavFavoriteEntitySeries, nil
	default:
		return "", errors.New("invalid favorite entity type")
	}
}

func buildFavoriteCountQuery(ctx context.Context, entityType string) *gorm.DB {
	return common.DB.WithContext(ctx).
		Table("jav_favorite_map").
		Select("entity_id, COUNT(DISTINCT jav_favorite_group_id) AS favorite_count").
		Where("entity_type = ?", entityType).
		Group("entity_id")
}

func buildIdolFavoriteCountQuery(ctx context.Context) *gorm.DB {
	return common.DB.WithContext(ctx).
		Table("jav_favorite_map").
		Select("entity_id AS jav_idol_id, COUNT(DISTINCT jav_favorite_group_id) AS favorite_count").
		Where("entity_type = ?", JavFavoriteEntityIdol).
		Group("entity_id")
}

func attachJavFavoriteCounts(ctx context.Context, items []models.Jav) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]int64, 0, len(items))
	indexByID := make(map[int64]int, len(items))
	for i, item := range items {
		if item.ID > 0 {
			ids = append(ids, item.ID)
			indexByID[item.ID] = i
		}
	}
	if len(ids) == 0 {
		return nil
	}
	var rows []struct {
		EntityID      int64 `gorm:"column:entity_id"`
		FavoriteCount int64 `gorm:"column:favorite_count"`
	}
	if err := common.DB.WithContext(ctx).
		Table("jav_favorite_map").
		Select("entity_id, COUNT(DISTINCT jav_favorite_group_id) AS favorite_count").
		Where("entity_type = ? AND entity_id IN ?", JavFavoriteEntityJav, ids).
		Group("entity_id").
		Scan(&rows).Error; err != nil {
		return fmt.Errorf("load jav favorite counts: %w", err)
	}
	for _, row := range rows {
		if index, ok := indexByID[row.EntityID]; ok {
			items[index].FavoriteCount = row.FavoriteCount
		}
	}
	return nil
}

// ListJavFavoriteGroups returns user-created favorite groups for an entity type.
func ListJavFavoriteGroups(ctx context.Context, entityType string, directoryIDs []int64) ([]JavFavoriteGroupSummary, error) {
	entityType, err := normalizeJavFavoriteEntityType(entityType)
	if err != nil {
		return nil, err
	}

	var groups []JavFavoriteGroupSummary
	query := common.DB.WithContext(ctx).
		Table("jav_favorite_group jfg").
		Where("jfg.entity_type = ?", entityType).
		Group("jfg.id, jfg.entity_type, jfg.name, jfg.sort_order").
		Order("jfg.sort_order ASC, jfg.name ASC, jfg.id ASC")

	switch entityType {
	case JavFavoriteEntityIdol:
		query = query.
			Select("jfg.id, jfg.entity_type, jfg.name, jfg.sort_order, COUNT(DISTINCT CASE WHEN solo_idols.cover_code IS NOT NULL THEN jfm.entity_id END) AS count").
			Joins("LEFT JOIN jav_favorite_map jfm ON jfm.jav_favorite_group_id = jfg.id AND jfm.entity_type = ?", entityType).
			Joins("LEFT JOIN jav_idol ji ON ji.id = jfm.entity_id").
			Joins("LEFT JOIN (?) solo_idols ON solo_idols.jav_idol_id = jfm.entity_id", buildVisibleSoloIdolCoverQuery(ctx, directoryIDs))
	case JavFavoriteEntityJav:
		query = query.
			Select("jfg.id, jfg.entity_type, jfg.name, jfg.sort_order, COUNT(DISTINCT CASE WHEN j.id IS NOT NULL AND vl.id IS NOT NULL AND d.id IS NOT NULL AND "+activeLocationWhereSQL("vl", "d")+directoryFilterSQL("vl", directoryIDs)+" THEN j.id END) AS count").
			Joins("LEFT JOIN jav_favorite_map jfm ON jfm.jav_favorite_group_id = jfg.id AND jfm.entity_type = ?", entityType).
			Joins("LEFT JOIN jav j ON j.id = jfm.entity_id").
			Joins("LEFT JOIN video_location vl ON vl.jav_id = j.id").
			Joins("LEFT JOIN directory d ON d.id = vl.directory_id")
	case JavFavoriteEntityStudio:
		query = query.
			Select("jfg.id, jfg.entity_type, jfg.name, jfg.sort_order, COUNT(DISTINCT CASE WHEN js.id IS NOT NULL AND j.id IS NOT NULL AND vl.id IS NOT NULL AND d.id IS NOT NULL AND "+activeLocationWhereSQL("vl", "d")+directoryFilterSQL("vl", directoryIDs)+" THEN js.id END) AS count").
			Joins("LEFT JOIN jav_favorite_map jfm ON jfm.jav_favorite_group_id = jfg.id AND jfm.entity_type = ?", entityType).
			Joins("LEFT JOIN jav_studio js ON js.id = jfm.entity_id").
			Joins("LEFT JOIN jav j ON j.studio_id = js.id").
			Joins("LEFT JOIN video_location vl ON vl.jav_id = j.id").
			Joins("LEFT JOIN directory d ON d.id = vl.directory_id")
	case JavFavoriteEntitySeries:
		query = query.
			Select("jfg.id, jfg.entity_type, jfg.name, jfg.sort_order, COUNT(DISTINCT CASE WHEN js.id IS NOT NULL AND j.id IS NOT NULL AND vl.id IS NOT NULL AND d.id IS NOT NULL AND "+activeLocationWhereSQL("vl", "d")+directoryFilterSQL("vl", directoryIDs)+" THEN js.id END) AS count").
			Joins("LEFT JOIN jav_favorite_map jfm ON jfm.jav_favorite_group_id = jfg.id AND jfm.entity_type = ?", entityType).
			Joins("LEFT JOIN jav_series js ON js.id = jfm.entity_id").
			Joins("LEFT JOIN jav j ON j.series_id = js.id").
			Joins("LEFT JOIN video_location vl ON vl.jav_id = j.id").
			Joins("LEFT JOIN directory d ON d.id = vl.directory_id")
	}

	if err := query.Scan(&groups).Error; err != nil {
		return nil, fmt.Errorf("list jav favorite groups: %w", err)
	}
	return groups, nil
}

// CreateJavFavoriteGroup creates a favorite group or returns the existing group with the same name and entity type.
func CreateJavFavoriteGroup(ctx context.Context, entityType, name string) (*models.JavFavoriteGroup, error) {
	entityType, err := normalizeJavFavoriteEntityType(entityType)
	if err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("favorite group name cannot be empty")
	}

	var group models.JavFavoriteGroup
	err = common.DB.WithContext(ctx).Where("entity_type = ? AND name = ?", entityType, name).First(&group).Error
	if err == nil {
		return &group, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("find jav favorite group %q: %w", name, err)
	}
	nextOrder, err := nextJavFavoriteGroupSortOrder(ctx, entityType)
	if err != nil {
		return nil, err
	}
	group = models.JavFavoriteGroup{Name: name, EntityType: entityType, SortOrder: nextOrder}
	if err := common.DB.WithContext(ctx).Create(&group).Error; err != nil {
		return nil, fmt.Errorf("create jav favorite group %q: %w", name, err)
	}
	return &group, nil
}

func nextJavFavoriteGroupSortOrder(ctx context.Context, entityType string) (int, error) {
	var maxOrder int
	if err := common.DB.WithContext(ctx).
		Model(&models.JavFavoriteGroup{}).
		Where("entity_type = ?", entityType).
		Select("COALESCE(MAX(sort_order), 0)").
		Scan(&maxOrder).Error; err != nil {
		return 0, fmt.Errorf("get next jav favorite group order: %w", err)
	}
	return maxOrder + 1, nil
}

// RenameJavFavoriteGroup renames a favorite group.
func RenameJavFavoriteGroup(ctx context.Context, entityType string, id int64, name string) error {
	entityType, err := normalizeJavFavoriteEntityType(entityType)
	if err != nil {
		return err
	}
	name = strings.TrimSpace(name)
	if id <= 0 {
		return errors.New("favorite group id must be positive")
	}
	if name == "" {
		return errors.New("favorite group name cannot be empty")
	}
	if err := common.DB.WithContext(ctx).
		Model(&models.JavFavoriteGroup{}).
		Where("id = ? AND entity_type = ?", id, entityType).
		Update("name", name).Error; err != nil {
		return fmt.Errorf("rename jav favorite group: %w", err)
	}
	return nil
}

// DeleteJavFavoriteGroup deletes a favorite group and its memberships.
func DeleteJavFavoriteGroup(ctx context.Context, entityType string, id int64) error {
	entityType, err := normalizeJavFavoriteEntityType(entityType)
	if err != nil {
		return err
	}
	if id <= 0 {
		return errors.New("favorite group id must be positive")
	}
	res := common.DB.WithContext(ctx).Where("entity_type = ?", entityType).Delete(&models.JavFavoriteGroup{}, id)
	if res.Error != nil {
		return fmt.Errorf("delete jav favorite group: %w", res.Error)
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// ReorderJavFavoriteGroups persists the display order of favorite groups.
func ReorderJavFavoriteGroups(ctx context.Context, entityType string, groupIDs []int64) error {
	entityType, err := normalizeJavFavoriteEntityType(entityType)
	if err != nil {
		return err
	}
	cleanIDs := uniqueInt64s(groupIDs)
	if len(cleanIDs) == 0 {
		return errors.New("group_ids required")
	}
	return common.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&models.JavFavoriteGroup{}).Where("entity_type = ? AND id IN ?", entityType, cleanIDs).Count(&count).Error; err != nil {
			return fmt.Errorf("find jav favorite groups: %w", err)
		}
		if count != int64(len(cleanIDs)) {
			return errors.New("invalid favorite_group_id")
		}
		for index, id := range cleanIDs {
			if err := tx.Model(&models.JavFavoriteGroup{}).
				Where("id = ? AND entity_type = ?", id, entityType).
				Update("sort_order", index+1).Error; err != nil {
				return fmt.Errorf("update jav favorite group order: %w", err)
			}
		}
		return nil
	})
}

func validateJavFavoriteGroupTx(tx *gorm.DB, entityType string, groupID int64) error {
	var count int64
	if err := tx.Model(&models.JavFavoriteGroup{}).Where("id = ? AND entity_type = ?", groupID, entityType).Count(&count).Error; err != nil {
		return fmt.Errorf("find jav favorite group: %w", err)
	}
	if count == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func validateJavFavoriteEntityTx(tx *gorm.DB, entityType string, entityID int64) error {
	var count int64
	var err error
	switch entityType {
	case JavFavoriteEntityJav:
		err = tx.Model(&models.Jav{}).Where("id = ?", entityID).Count(&count).Error
	case JavFavoriteEntityIdol:
		err = tx.Model(&models.JavIdol{}).Where("id = ?", entityID).Count(&count).Error
	case JavFavoriteEntityStudio:
		err = tx.Model(&models.JavStudio{}).Where("id = ?", entityID).Count(&count).Error
	case JavFavoriteEntitySeries:
		err = tx.Model(&models.JavSeries{}).
			Where("id = ? AND is_english = ?", entityID, false).
			Count(&count).Error
	default:
		return errors.New("invalid favorite entity type")
	}
	if err != nil {
		return fmt.Errorf("find jav favorite entity: %w", err)
	}
	if count == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func nextJavFavoriteMapSortOrderTx(tx *gorm.DB, groupID int64) (int, error) {
	var maxOrder int
	if err := tx.Model(&models.JavFavoriteMap{}).
		Where("jav_favorite_group_id = ?", groupID).
		Select("COALESCE(MAX(sort_order), 0)").
		Scan(&maxOrder).Error; err != nil {
		return 0, fmt.Errorf("get next jav favorite map order: %w", err)
	}
	return maxOrder + 1, nil
}

// ListJavFavoriteGroupIDs returns favorite group IDs containing the entity.
func ListJavFavoriteGroupIDs(ctx context.Context, entityType string, entityID int64) ([]int64, error) {
	entityType, err := normalizeJavFavoriteEntityType(entityType)
	if err != nil {
		return nil, err
	}
	if entityID <= 0 {
		return nil, errors.New("entity id must be positive")
	}
	var ids []int64
	if err := common.DB.WithContext(ctx).
		Table("jav_favorite_map").
		Where("entity_type = ? AND entity_id = ?", entityType, entityID).
		Order("jav_favorite_group_id").
		Pluck("jav_favorite_group_id", &ids).Error; err != nil {
		return nil, fmt.Errorf("list jav favorite group ids: %w", err)
	}
	return ids, nil
}

// ReplaceJavFavoriteGroups replaces all favorite group memberships for one entity.
func ReplaceJavFavoriteGroups(ctx context.Context, entityType string, entityID int64, groupIDs []int64) error {
	entityType, err := normalizeJavFavoriteEntityType(entityType)
	if err != nil {
		return err
	}
	if entityID <= 0 {
		return errors.New("entity id must be positive")
	}
	cleanGroupIDs := uniqueInt64s(groupIDs)

	return common.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := validateJavFavoriteEntityTx(tx, entityType, entityID); err != nil {
			return err
		}

		if len(cleanGroupIDs) > 0 {
			var groupCount int64
			if err := tx.Model(&models.JavFavoriteGroup{}).Where("entity_type = ? AND id IN ?", entityType, cleanGroupIDs).Count(&groupCount).Error; err != nil {
				return fmt.Errorf("find jav favorite groups: %w", err)
			}
			if groupCount != int64(len(cleanGroupIDs)) {
				return errors.New("invalid favorite_group_id")
			}
		}

		var existing []models.JavFavoriteMap
		if err := tx.Where("entity_type = ? AND entity_id = ?", entityType, entityID).Find(&existing).Error; err != nil {
			return fmt.Errorf("find jav favorite maps: %w", err)
		}
		existingOrders := make(map[int64]int, len(existing))
		for _, row := range existing {
			if row.SortOrder > 0 {
				existingOrders[row.JavFavoriteGroupID] = row.SortOrder
			}
		}

		if err := tx.Where("entity_type = ? AND entity_id = ?", entityType, entityID).Delete(&models.JavFavoriteMap{}).Error; err != nil {
			return fmt.Errorf("delete jav favorite maps: %w", err)
		}
		if len(cleanGroupIDs) == 0 {
			return nil
		}

		now := time.Now()
		rows := make([]models.JavFavoriteMap, 0, len(cleanGroupIDs))
		for _, groupID := range cleanGroupIDs {
			sortOrder := existingOrders[groupID]
			if sortOrder <= 0 {
				nextOrder, err := nextJavFavoriteMapSortOrderTx(tx, groupID)
				if err != nil {
					return err
				}
				sortOrder = nextOrder
			}
			rows = append(rows, models.JavFavoriteMap{
				JavFavoriteGroupID: groupID,
				EntityType:         entityType,
				EntityID:           entityID,
				SortOrder:          sortOrder,
				CreatedAt:          now,
			})
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&rows).Error; err != nil {
			return fmt.Errorf("insert jav favorite maps: %w", err)
		}
		return nil
	})
}

// ListJavFavoriteGroupItems returns visible entities in a favorite group order.
func ListJavFavoriteGroupItems(ctx context.Context, entityType string, groupID int64, directoryIDs []int64) ([]JavFavoriteItemSummary, error) {
	entityType, err := normalizeJavFavoriteEntityType(entityType)
	if err != nil {
		return nil, err
	}
	if groupID <= 0 {
		return nil, errors.New("favorite group id must be positive")
	}
	var items []JavFavoriteItemSummary
	query := common.DB.WithContext(ctx).Table("jav_favorite_map jfm").
		Where("jfm.entity_type = ? AND jfm.jav_favorite_group_id = ?", entityType, groupID).
		Order("jfm.sort_order ASC")

	switch entityType {
	case JavFavoriteEntityJav:
		query = query.
			Select("'jav' AS entity_type, j.id, j.code, j.title, j.code || ' ' || COALESCE(j.title, '') AS name").
			Joins("JOIN jav j ON j.id = jfm.entity_id").
			Joins("JOIN video_location vl ON vl.jav_id = j.id").
			Joins("JOIN directory d ON d.id = vl.directory_id").
			Where(activeLocationWhereSQL("vl", "d")).
			Group("jfm.sort_order, j.id, j.code, j.title")
		query = applyDirectoryFilter(query, "vl", directoryIDs)
	case JavFavoriteEntityIdol:
		query = query.
			Select("'idol' AS entity_type, ji.id, ji.name, ji.roman_name, ji.japanese_name, ji.chinese_name, COUNT(DISTINCT j.id) AS work_count, COALESCE(NULLIF(cover_jav.code, ''), solo_idols.cover_code) AS sample_code").
			Joins("JOIN jav_idol ji ON ji.id = jfm.entity_id").
			Joins("JOIN (?) solo_idols ON solo_idols.jav_idol_id = ji.id", buildVisibleSoloIdolCoverQuery(ctx, directoryIDs)).
			Joins("LEFT JOIN jav cover_jav ON cover_jav.id = ji.cover_jav_id").
			Joins("JOIN jav_idol_map jim ON jim.jav_idol_id = ji.id").
			Joins("JOIN jav j ON j.id = jim.jav_id").
			Joins("JOIN video_location vl ON vl.jav_id = j.id").
			Joins("JOIN directory d ON d.id = vl.directory_id").
			Where(activeLocationWhereSQL("vl", "d")).
			Group("jfm.sort_order, ji.id, ji.name, ji.roman_name, ji.japanese_name, ji.chinese_name, cover_jav.code, solo_idols.cover_code")
		query = applyDirectoryFilter(query, "vl", directoryIDs)
	case JavFavoriteEntityStudio:
		query = query.
			Select("'studio' AS entity_type, js.id, js.name, COUNT(DISTINCT j.id) AS work_count, MIN(j.code) AS sample_code").
			Joins("JOIN jav_studio js ON js.id = jfm.entity_id").
			Joins("JOIN jav j ON j.studio_id = js.id").
			Joins("JOIN video_location vl ON vl.jav_id = j.id").
			Joins("JOIN directory d ON d.id = vl.directory_id").
			Where(activeLocationWhereSQL("vl", "d")).
			Group("jfm.sort_order, js.id, js.name")
		query = applyDirectoryFilter(query, "vl", directoryIDs)
	case JavFavoriteEntitySeries:
		query = query.
			Select("'series' AS entity_type, js.id, js.name, COUNT(DISTINCT j.id) AS work_count, MIN(j.code) AS sample_code").
			Joins("JOIN jav_series js ON js.id = jfm.entity_id").
			Joins("JOIN jav j ON j.series_id = js.id").
			Joins("JOIN video_location vl ON vl.jav_id = j.id").
			Joins("JOIN directory d ON d.id = vl.directory_id").
			Where(activeLocationWhereSQL("vl", "d")).
			Group("jfm.sort_order, js.id, js.name")
		query = applyDirectoryFilter(query, "vl", directoryIDs)
	}

	if err := query.Scan(&items).Error; err != nil {
		return nil, fmt.Errorf("list jav favorite group items: %w", err)
	}
	return items, nil
}

// ReorderJavFavoriteGroupItems persists item order inside a favorite group.
func ReorderJavFavoriteGroupItems(ctx context.Context, entityType string, groupID int64, entityIDs []int64) error {
	entityType, err := normalizeJavFavoriteEntityType(entityType)
	if err != nil {
		return err
	}
	if groupID <= 0 {
		return errors.New("favorite group id must be positive")
	}
	cleanIDs := uniqueInt64s(entityIDs)
	if len(cleanIDs) == 0 {
		return errors.New("entity_ids required")
	}
	return common.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := validateJavFavoriteGroupTx(tx, entityType, groupID); err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&models.JavFavoriteMap{}).
			Where("entity_type = ? AND jav_favorite_group_id = ? AND entity_id IN ?", entityType, groupID, cleanIDs).
			Count(&count).Error; err != nil {
			return fmt.Errorf("find jav favorite maps: %w", err)
		}
		if count != int64(len(cleanIDs)) {
			return errors.New("invalid entity_id")
		}
		for index, entityID := range cleanIDs {
			if err := tx.Model(&models.JavFavoriteMap{}).
				Where("entity_type = ? AND jav_favorite_group_id = ? AND entity_id = ?", entityType, groupID, entityID).
				Update("sort_order", index+1).Error; err != nil {
				return fmt.Errorf("update jav favorite map order: %w", err)
			}
		}
		return nil
	})
}

// RemoveJavFavoriteGroupItems removes entities from a favorite group.
func RemoveJavFavoriteGroupItems(ctx context.Context, entityType string, groupID int64, entityIDs []int64) error {
	entityType, err := normalizeJavFavoriteEntityType(entityType)
	if err != nil {
		return err
	}
	if groupID <= 0 {
		return errors.New("favorite group id must be positive")
	}
	cleanIDs := uniqueInt64s(entityIDs)
	if len(cleanIDs) == 0 {
		return errors.New("entity_ids required")
	}
	if err := common.DB.WithContext(ctx).
		Where("entity_type = ? AND jav_favorite_group_id = ? AND entity_id IN ?", entityType, groupID, cleanIDs).
		Delete(&models.JavFavoriteMap{}).Error; err != nil {
		return fmt.Errorf("remove jav favorite maps: %w", err)
	}
	return nil
}
