package db

import (
	"context"
	"testing"
	"time"

	"javboss/internal/models"
)

func TestVideoLocationPathExistsIgnoresHiddenRows(t *testing.T) {
	gdb := openTestDB(t)
	ctx := context.Background()
	now := time.Unix(1710000000, 0).UTC()

	dir := models.Directory{Path: "/tmp/media"}
	if err := gdb.Create(&dir).Error; err != nil {
		t.Fatalf("create directory: %v", err)
	}
	video := models.Video{
		DirectoryID: dir.ID,
		Path:        "deleted.mp4",
		Filename:    "deleted.mp4",
		Fingerprint: "hidden-path-exists-fp",
		ModifiedAt:  now,
		DurationSec: 1,
	}
	if err := gdb.Create(&video).Error; err != nil {
		t.Fatalf("create video: %v", err)
	}
	loc, err := UpsertVideoLocation(ctx, video.ID, dir.ID, "deleted.mp4", now)
	if err != nil {
		t.Fatalf("upsert location: %v", err)
	}
	if err := HideVideoLocationsByIDs(ctx, []int64{loc.ID}); err != nil {
		t.Fatalf("hide location: %v", err)
	}

	exists, err := VideoLocationPathExists(ctx, dir.ID, "deleted.mp4")
	if err != nil {
		t.Fatalf("check path exists: %v", err)
	}
	if exists {
		t.Fatal("hidden location should not reserve its path for rename conflict checks")
	}
}

func TestUpsertVideoLocationPersistsAndClearsSTRMDigest(t *testing.T) {
	gdb := openTestDB(t)
	ctx := context.Background()
	now := time.Unix(1710000000, 0).UTC()
	dir := models.Directory{Path: "/tmp/media"}
	if err := gdb.Create(&dir).Error; err != nil {
		t.Fatalf("create directory: %v", err)
	}
	video := models.Video{Fingerprint: "strm-digest-video"}
	if err := gdb.Create(&video).Error; err != nil {
		t.Fatalf("create video: %v", err)
	}

	loc, err := UpsertVideoLocationWithSTRMDigest(ctx, video.ID, dir.ID, "movie.strm", now, "v1:abc")
	if err != nil {
		t.Fatalf("upsert strm location: %v", err)
	}
	if loc.StrmDigest != "v1:abc" {
		t.Fatalf("strm digest = %q", loc.StrmDigest)
	}

	loc, err = UpsertVideoLocation(ctx, video.ID, dir.ID, "movie.strm", now.Add(time.Minute))
	if err != nil {
		t.Fatalf("upsert ordinary location: %v", err)
	}
	if loc.StrmDigest != "" {
		t.Fatalf("ordinary upsert should clear strm digest: %q", loc.StrmDigest)
	}
}

func TestUpdateVideoLocationPathReusesHiddenPath(t *testing.T) {
	gdb := openTestDB(t)
	ctx := context.Background()
	now := time.Unix(1710000000, 0).UTC()

	dir := models.Directory{Path: "/tmp/media"}
	if err := gdb.Create(&dir).Error; err != nil {
		t.Fatalf("create directory: %v", err)
	}
	hiddenVideo := models.Video{
		DirectoryID: dir.ID,
		Path:        "target.mp4",
		Filename:    "target.mp4",
		Fingerprint: "hidden-target-fp",
		ModifiedAt:  now,
	}
	activeVideo := models.Video{
		DirectoryID: dir.ID,
		Path:        "source.mp4",
		Filename:    "source.mp4",
		Fingerprint: "active-source-fp",
		ModifiedAt:  now,
	}
	if err := gdb.Create(&hiddenVideo).Error; err != nil {
		t.Fatalf("create hidden video: %v", err)
	}
	if err := gdb.Create(&activeVideo).Error; err != nil {
		t.Fatalf("create active video: %v", err)
	}
	hiddenLoc, err := UpsertVideoLocation(ctx, hiddenVideo.ID, dir.ID, "target.mp4", now)
	if err != nil {
		t.Fatalf("upsert hidden location: %v", err)
	}
	activeLoc, err := UpsertVideoLocation(ctx, activeVideo.ID, dir.ID, "source.mp4", now)
	if err != nil {
		t.Fatalf("upsert active location: %v", err)
	}
	if err := HideVideoLocationsByIDs(ctx, []int64{hiddenLoc.ID}); err != nil {
		t.Fatalf("hide target location: %v", err)
	}

	updated, err := UpdateVideoLocationPath(ctx, activeLoc.ID, "target.mp4", now.Add(time.Minute))
	if err != nil {
		t.Fatalf("update active location path: %v", err)
	}
	if updated.ID != activeLoc.ID || updated.RelativePath != "target.mp4" || updated.Filename != "target.mp4" {
		t.Fatalf("unexpected updated location: %#v", updated)
	}

	var locations []models.VideoLocation
	if err := gdb.
		Where("directory_id = ? AND relative_path = ?", dir.ID, "target.mp4").
		Find(&locations).Error; err != nil {
		t.Fatalf("load target locations: %v", err)
	}
	if len(locations) != 1 {
		t.Fatalf("target path should have exactly one row after reuse: %#v", locations)
	}
	if locations[0].ID != activeLoc.ID || locations[0].IsDelete {
		t.Fatalf("target path should belong to the active location: %#v", locations[0])
	}
}
