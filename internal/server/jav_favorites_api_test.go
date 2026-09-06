package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"javboss/internal/common"
	dbpkg "javboss/internal/db"
	"javboss/internal/models"
)

func TestAddJavsToFavoriteGroupsAPI(t *testing.T) {
	database, err := dbpkg.Open(filepath.Join(t.TempDir(), "test.db"))
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
	item := models.Jav{Code: "BULK-001"}
	groups := []models.JavFavoriteGroup{
		{Name: "JAV", EntityType: dbpkg.JavFavoriteEntityJav},
		{Name: "Idols", EntityType: dbpkg.JavFavoriteEntityIdol},
	}
	if err := database.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&groups).Error; err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	registerJavFavoriteRoutes(router, "jav", dbpkg.JavFavoriteEntityJav)
	for _, tc := range []struct {
		name, body string
		status     int
	}{
		{"malformed", `{`, http.StatusBadRequest},
		{"empty", `{}`, http.StatusBadRequest},
		{"no items", `{"jav_ids":[],"group_ids":[1]}`, http.StatusBadRequest},
		{"no groups", `{"jav_ids":[1],"group_ids":[]}`, http.StatusBadRequest},
		{"negative id", `{"jav_ids":[-1],"group_ids":[1]}`, http.StatusBadRequest},
		{"zero group", `{"jav_ids":[1],"group_ids":[0]}`, http.StatusBadRequest},
		{"wrong type", fmt.Sprintf(`{"jav_ids":[%d],"group_ids":[%d]}`, item.ID, groups[1].ID), http.StatusNotFound},
		{"missing item", fmt.Sprintf(`{"jav_ids":[9999],"group_ids":[%d]}`, groups[0].ID), http.StatusNotFound},
		{"valid", fmt.Sprintf(`{"jav_ids":[%d],"group_ids":[%d]}`, item.ID, groups[0].ID), http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/jav/items/favorite-groups/add", strings.NewReader(tc.body))
			request.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(recorder, request)
			if recorder.Code != tc.status {
				t.Fatalf("status=%d body=%s, want %d", recorder.Code, recorder.Body.String(), tc.status)
			}
			if tc.status == http.StatusOK {
				var response struct {
					Items []dbpkg.JavFavoriteCount `json:"items"`
				}
				if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
					t.Fatal(err)
				}
				if len(response.Items) != 1 || response.Items[0].ID != item.ID || response.Items[0].FavoriteCount != 1 {
					t.Fatalf("invalid response: %+v", response)
				}
			}
		})
	}
}
