package db

import (
	"reflect"
	"testing"

	"javboss/internal/models"
)

func TestLookupJavOwnership(t *testing.T) {
	database := openTestDB(t)
	directories := []models.Directory{
		{Path: "/active"}, {Path: "/deleted", IsDelete: true}, {Path: "/disabled"}, {Path: "/offline", Missing: true},
	}
	if err := database.Create(&directories).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Model(&directories[2]).Update("enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	fixtures := []struct {
		stored, requested string
		directory         int
		deleted, owned    bool
	}{
		{"Milfy.2026.09.09", "milfy.2026.09.09", 0, false, true},
		{"AbC-001", "abc_001", 0, false, true},
		{"ABC-0012", "ABC0012", 0, false, true},
		{"082226_01", "082226-01", 0, false, true},
		{"FC2-PPV-1234567", "fc2 ppv 1234567", 0, false, true},
		{"METADATA-001", "METADATA-001", -1, false, false},
		{"DELETED-001", "DELETED-001", 0, true, false},
		{"DIRECTORY-001", "DIRECTORY-001", 1, false, false},
		{"DISABLED-001", "DISABLED-001", 2, false, true},
		{"DISABLED-DELETED-001", "DISABLED-DELETED-001", 2, true, false},
		{"OFFLINE-001", "OFFLINE-001", 3, false, true},
	}
	var codes []string
	var want []JavOwnership
	for _, fixture := range fixtures {
		item := models.Jav{Code: fixture.stored}
		if err := database.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
		if fixture.directory >= 0 {
			video := models.Video{Fingerprint: fixture.stored}
			if err := database.Create(&video).Error; err != nil {
				t.Fatal(err)
			}
			location := models.VideoLocation{VideoID: video.ID, JavID: &item.ID, DirectoryID: directories[fixture.directory].ID, RelativePath: fixture.stored + ".mp4", IsDelete: fixture.deleted}
			if err := database.Create(&location).Error; err != nil {
				t.Fatal(err)
			}
			// A deleted duplicate must not hide another active file.
			if fixture.owned {
				location.ID = 0
				location.RelativePath += ".duplicate"
				location.IsDelete = true
				if err := database.Create(&location).Error; err != nil {
					t.Fatal(err)
				}
			}
		}
		codes = append(codes, fixture.requested)
		want = append(want, JavOwnership{Code: fixture.requested, Owned: fixture.owned})
	}
	for _, code := range []string{"UNKNOWN-001", "ABC-00", "ABC-00123"} {
		codes = append(codes, code)
		want = append(want, JavOwnership{Code: code})
	}
	got, err := LookupJavOwnership(t.Context(), codes)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("ownership = %#v, err = %v, want %#v", got, err, want)
	}
	if empty, err := LookupJavOwnership(t.Context(), nil); err != nil || empty == nil || len(empty) != 0 {
		t.Fatalf("empty lookup = %#v, %v", empty, err)
	}
}
