package db

import (
	"context"
	"fmt"
	"reflect"
	"testing"

	"javboss/internal/models"
)

func TestAddJavsToFavoriteGroupsPreservesMembershipsAndOrder(t *testing.T) {
	gdb := openTestDB(t)
	ctx := context.Background()
	items := []models.Jav{{Code: "BULK-001"}, {Code: "BULK-002"}, {Code: "BULK-003"}}
	groups := []models.JavFavoriteGroup{
		{Name: "Existing", EntityType: JavFavoriteEntityJav},
		{Name: "Target", EntityType: JavFavoriteEntityJav},
		{Name: "Other target", EntityType: JavFavoriteEntityJav},
	}
	if err := gdb.Create(&items).Error; err != nil {
		t.Fatal(err)
	}
	if err := gdb.Create(&groups).Error; err != nil {
		t.Fatal(err)
	}
	initial := []models.JavFavoriteMap{
		{JavFavoriteGroupID: groups[0].ID, EntityType: JavFavoriteEntityJav, EntityID: items[0].ID, SortOrder: 7},
		{JavFavoriteGroupID: groups[1].ID, EntityType: JavFavoriteEntityJav, EntityID: items[0].ID, SortOrder: 4},
	}
	if err := gdb.Create(&initial).Error; err != nil {
		t.Fatal(err)
	}
	ids := []int64{items[2].ID, items[0].ID, items[1].ID, items[2].ID}
	groupIDs := []int64{groups[1].ID, groups[2].ID, groups[1].ID}
	for attempt := 0; attempt < 2; attempt++ {
		counts, err := AddJavsToFavoriteGroups(ctx, ids, groupIDs)
		if err != nil {
			t.Fatal(err)
		}
		got := map[int64]int64{}
		for _, count := range counts {
			got[count.ID] = count.FavoriteCount
		}
		want := map[int64]int64{items[0].ID: 3, items[1].ID: 2, items[2].ID: 2}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("counts = %v, want %v", got, want)
		}
	}
	var rows []models.JavFavoriteMap
	if err := gdb.Order("jav_favorite_group_id, sort_order").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 7 {
		t.Fatalf("got %d memberships, want 7", len(rows))
	}
	for i, original := range initial {
		row := rows[i]
		if row.JavFavoriteGroupID != original.JavFavoriteGroupID || row.EntityID != original.EntityID || row.EntityType != original.EntityType || row.SortOrder != original.SortOrder || !row.CreatedAt.Equal(original.CreatedAt) {
			t.Fatalf("existing membership changed: got %+v, want %+v", row, original)
		}
	}
	if rows[2].EntityID != items[2].ID || rows[2].SortOrder != 5 || rows[3].EntityID != items[1].ID || rows[3].SortOrder != 6 {
		t.Fatalf("new items were not appended in selection order: %+v", rows[2:4])
	}
}

func TestAddJavsToFavoriteGroupsRejectsInvalidSelectionAtomically(t *testing.T) {
	for _, name := range []string{"empty items", "empty groups", "invalid id", "missing item", "missing group", "wrong group type"} {
		t.Run(name, func(t *testing.T) {
			gdb := openTestDB(t)
			item := models.Jav{Code: "BULK-001"}
			groups := []models.JavFavoriteGroup{{Name: "JAV", EntityType: JavFavoriteEntityJav}, {Name: "Idols", EntityType: JavFavoriteEntityIdol}}
			if err := gdb.Create(&item).Error; err != nil {
				t.Fatal(err)
			}
			if err := gdb.Create(&groups).Error; err != nil {
				t.Fatal(err)
			}
			ids, groupIDs := []int64{item.ID}, []int64{groups[0].ID}
			switch name {
			case "empty items":
				ids = nil
			case "empty groups":
				groupIDs = nil
			case "invalid id":
				ids = append(ids, -1)
			case "missing item":
				ids = append(ids, 9999)
			case "missing group":
				groupIDs = append(groupIDs, 9999)
			case "wrong group type":
				groupIDs = append(groupIDs, groups[1].ID)
			}
			counts, err := AddJavsToFavoriteGroups(context.Background(), ids, groupIDs)
			if err == nil || counts != nil {
				t.Fatalf("got counts=%v err=%v, want failure", counts, err)
			}
			var count int64
			if err := gdb.Model(&models.JavFavoriteMap{}).Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			if count != 0 {
				t.Fatalf("failed operation left %d memberships", count)
			}
		})
	}
}

func TestAddJavsToFavoriteGroupsHandlesLargeSelection(t *testing.T) {
	gdb := openTestDB(t)
	items := make([]models.Jav, 1001)
	ids := make([]int64, len(items))
	for i := range items {
		items[i].Code = fmt.Sprintf("BULK-%04d", i)
	}
	if err := gdb.CreateInBatches(&items, 100).Error; err != nil {
		t.Fatal(err)
	}
	for i := range items {
		ids[i] = items[i].ID
	}
	group := models.JavFavoriteGroup{Name: "Large", EntityType: JavFavoriteEntityJav}
	if err := gdb.Create(&group).Error; err != nil {
		t.Fatal(err)
	}
	counts, err := AddJavsToFavoriteGroups(context.Background(), ids, []int64{group.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(counts) != len(items) {
		t.Fatalf("got %d counts, want %d", len(counts), len(items))
	}
	var rows []models.JavFavoriteMap
	if err := gdb.Order("sort_order").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != len(items) {
		t.Fatalf("got %d memberships", len(rows))
	}
	for i, row := range rows {
		if row.EntityID != ids[i] || row.SortOrder != i+1 {
			t.Fatalf("wrong order at %d: %+v", i, row)
		}
	}
}
