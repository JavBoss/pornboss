package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext(
		"202608120001_add_video_location_strm_digest.go",
		addVideoLocationSTRMDigest,
		irreversibleMigration,
	)
}

func addVideoLocationSTRMDigest(ctx context.Context, tx *sql.Tx) error {
	return addColumnIfMissing(ctx, tx, "video_location", "strm_digest", `text NOT NULL DEFAULT ""`)
}
