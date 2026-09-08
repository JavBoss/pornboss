package migrations

import (
	"context"
	"database/sql"
	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("202609060001_add_extension_token.go", addExtensionToken, irreversibleMigration)
}

func addExtensionToken(ctx context.Context, tx *sql.Tx) error {
	return execStatements(ctx, tx,
		`CREATE TABLE extension_token (
   id integer PRIMARY KEY AUTOINCREMENT,
   name text NOT NULL,
   token text NOT NULL,
   created_at datetime NOT NULL,
   expires_at datetime NOT NULL,
   last_used_at datetime
  )`,
		`CREATE UNIQUE INDEX idx_extension_token_token ON extension_token (token)`,
	)
}
