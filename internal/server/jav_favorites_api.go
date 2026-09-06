package server

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"javboss/internal/common/logging"
	dbpkg "javboss/internal/db"
)

func listJavFavoriteGroupsFor(entityType string) gin.HandlerFunc {
	return func(c *gin.Context) {
		groups, err := dbpkg.ListJavFavoriteGroups(c.Request.Context(), entityType, nil)
		if err != nil {
			logging.Error("list jav favorite groups type=%s: %v", entityType, err)
			respondLocalizedError(c, http.StatusInternalServerError, "加载收藏夹失败", "Failed to load favorite groups")
			return
		}
		if groups == nil {
			groups = []dbpkg.JavFavoriteGroupSummary{}
		}
		c.JSON(http.StatusOK, gin.H{"items": groups})
	}
}

// addJavsToFavoriteGroups handles POST /jav/items/favorite-groups/add.
// The JSON body contains jav_ids and group_ids; existing memberships are retained.
func addJavsToFavoriteGroups(c *gin.Context) {
	var req struct {
		JavIDs   []int64 `json:"jav_ids" binding:"required,min=1,dive,gt=0"`
		GroupIDs []int64 `json:"group_ids" binding:"required,min=1,dive,gt=0"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		respondLocalizedError(c, http.StatusBadRequest, "批量加入收藏夹请求无效", "Invalid bulk favorite request")
		return
	}
	counts, err := dbpkg.AddJavsToFavoriteGroups(c.Request.Context(), req.JavIDs, req.GroupIDs)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			respondLocalizedError(c, http.StatusNotFound, "作品或作品收藏夹不存在，请刷新后重试", "JAV item or favorite group was not found; refresh and retry")
			return
		}
		logging.Error("add jav items to favorite groups: %v", err)
		respondLocalizedError(c, http.StatusInternalServerError, "批量加入收藏夹失败", "Failed to add JAV items to favorite groups")
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": counts})
}

func createJavFavoriteGroupFor(entityType string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Name string `json:"name"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			respondLocalizedError(c, http.StatusBadRequest, "创建收藏夹请求无效", "Invalid favorite group creation request")
			return
		}

		group, err := dbpkg.CreateJavFavoriteGroup(c.Request.Context(), entityType, req.Name)
		if err != nil {
			logging.Error("create jav favorite group type=%s: %v", entityType, err)
			respondLocalizedError(c, http.StatusBadRequest, "创建收藏夹失败，名称可能为空或已存在", "Failed to create favorite group; the name may be empty or already exist")
			return
		}
		c.JSON(http.StatusCreated, dbpkg.JavFavoriteGroupSummary{
			ID:         group.ID,
			EntityType: group.EntityType,
			Name:       group.Name,
			SortOrder:  group.SortOrder,
			Count:      0,
		})
	}
}

func renameJavFavoriteGroupFor(entityType string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id <= 0 {
			respondLocalizedError(c, http.StatusBadRequest, "收藏夹 ID 无效", "Invalid favorite group ID")
			return
		}
		var req struct {
			Name string `json:"name"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			respondLocalizedError(c, http.StatusBadRequest, "重命名收藏夹请求无效", "Invalid favorite group rename request")
			return
		}
		if err := dbpkg.RenameJavFavoriteGroup(c.Request.Context(), entityType, id, req.Name); err != nil {
			logging.Error("rename jav favorite group type=%s id=%d: %v", entityType, id, err)
			respondLocalizedError(c, http.StatusBadRequest, "重命名收藏夹失败，名称可能为空或已存在", "Failed to rename favorite group; the name may be empty or already exist")
			return
		}
		c.Status(http.StatusNoContent)
	}
}

func deleteJavFavoriteGroupFor(entityType string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id <= 0 {
			respondLocalizedError(c, http.StatusBadRequest, "收藏夹 ID 无效", "Invalid favorite group ID")
			return
		}
		if err := dbpkg.DeleteJavFavoriteGroup(c.Request.Context(), entityType, id); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				respondLocalizedError(c, http.StatusNotFound, "收藏夹不存在", "Favorite group was not found")
				return
			}
			logging.Error("delete jav favorite group type=%s id=%d: %v", entityType, id, err)
			respondLocalizedError(c, http.StatusBadRequest, "删除收藏夹失败", "Failed to delete favorite group")
			return
		}
		c.Status(http.StatusNoContent)
	}
}

func reorderJavFavoriteGroupsFor(entityType string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			GroupIDs []int64 `json:"group_ids"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			respondLocalizedError(c, http.StatusBadRequest, "收藏夹排序请求无效", "Invalid favorite group reorder request")
			return
		}
		if err := dbpkg.ReorderJavFavoriteGroups(c.Request.Context(), entityType, req.GroupIDs); err != nil {
			logging.Error("reorder jav favorite groups type=%s: %v", entityType, err)
			respondLocalizedError(c, http.StatusBadRequest, "保存收藏夹顺序失败", "Failed to save favorite group order")
			return
		}
		c.Status(http.StatusNoContent)
	}
}

func listJavFavoriteGroupItemsFor(entityType string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id <= 0 {
			respondLocalizedError(c, http.StatusBadRequest, "收藏夹 ID 无效", "Invalid favorite group ID")
			return
		}
		items, err := dbpkg.ListJavFavoriteGroupItems(
			c.Request.Context(),
			entityType,
			id,
			nil,
		)
		if err != nil {
			logging.Error("list jav favorite group items type=%s id=%d: %v", entityType, id, err)
			respondLocalizedError(c, http.StatusInternalServerError, "加载收藏夹内容失败", "Failed to load favorite group items")
			return
		}
		if items == nil {
			items = []dbpkg.JavFavoriteItemSummary{}
		}
		c.JSON(http.StatusOK, gin.H{"items": items})
	}
}

func reorderJavFavoriteGroupItemsFor(entityType string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id <= 0 {
			respondLocalizedError(c, http.StatusBadRequest, "收藏夹 ID 无效", "Invalid favorite group ID")
			return
		}
		var req struct {
			EntityIDs []int64 `json:"entity_ids"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			respondLocalizedError(c, http.StatusBadRequest, "收藏夹内容排序请求无效", "Invalid favorite item reorder request")
			return
		}
		if err := dbpkg.ReorderJavFavoriteGroupItems(c.Request.Context(), entityType, id, req.EntityIDs); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				respondLocalizedError(c, http.StatusNotFound, "收藏夹不存在", "Favorite group was not found")
				return
			}
			logging.Error("reorder jav favorite group items type=%s id=%d: %v", entityType, id, err)
			respondLocalizedError(c, http.StatusBadRequest, "保存收藏夹内容顺序失败", "Failed to save favorite item order")
			return
		}
		c.Status(http.StatusNoContent)
	}
}

func removeJavFavoriteGroupItemsFor(entityType string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id <= 0 {
			respondLocalizedError(c, http.StatusBadRequest, "收藏夹 ID 无效", "Invalid favorite group ID")
			return
		}
		var req struct {
			EntityIDs []int64 `json:"entity_ids"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			respondLocalizedError(c, http.StatusBadRequest, "移除收藏夹内容请求无效", "Invalid favorite item removal request")
			return
		}
		if err := dbpkg.RemoveJavFavoriteGroupItems(c.Request.Context(), entityType, id, req.EntityIDs); err != nil {
			logging.Error("remove jav favorite group items type=%s id=%d: %v", entityType, id, err)
			respondLocalizedError(c, http.StatusBadRequest, "移除收藏夹内容失败", "Failed to remove favorite group items")
			return
		}
		c.Status(http.StatusNoContent)
	}
}

func listJavFavoriteGroupIDsFor(entityType string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id <= 0 {
			respondLocalizedError(c, http.StatusBadRequest, "作品 ID 无效", "Invalid item ID")
			return
		}
		ids, err := dbpkg.ListJavFavoriteGroupIDs(c.Request.Context(), entityType, id)
		if err != nil {
			logging.Error("list jav favorite group ids type=%s id=%d: %v", entityType, id, err)
			respondLocalizedError(c, http.StatusInternalServerError, "加载作品收藏夹选择失败", "Failed to load favorite group selection")
			return
		}
		if ids == nil {
			ids = []int64{}
		}
		c.JSON(http.StatusOK, gin.H{"selected_group_ids": ids})
	}
}

func replaceJavFavoriteGroupsFor(entityType string) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id <= 0 {
			respondLocalizedError(c, http.StatusBadRequest, "作品 ID 无效", "Invalid item ID")
			return
		}
		var req struct {
			GroupIDs []int64 `json:"group_ids"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			respondLocalizedError(c, http.StatusBadRequest, "保存作品收藏夹请求无效", "Invalid favorite selection update request")
			return
		}

		if err := dbpkg.ReplaceJavFavoriteGroups(c.Request.Context(), entityType, id, req.GroupIDs); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				respondLocalizedError(c, http.StatusNotFound, "作品不存在", "Item was not found")
				return
			}
			logging.Error("replace jav favorite groups type=%s id=%d: %v", entityType, id, err)
			respondLocalizedError(c, http.StatusBadRequest, "保存作品收藏夹失败", "Failed to save favorite group selection")
			return
		}
		c.Status(http.StatusNoContent)
	}
}
