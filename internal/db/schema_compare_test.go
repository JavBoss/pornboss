package db

import (
	"fmt"
	"path/filepath"
	"reflect"
	"sort"
	"testing"

	"javboss/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestMigratedSchemaMatchesGormModels(t *testing.T) {
	dir := t.TempDir()

	migrated, err := Open(filepath.Join(dir, "migrated.db"))
	if err != nil {
		t.Fatalf("open migrated db: %v", err)
	}
	defer closeDBForSchemaCompare(t, migrated)

	reference, err := gorm.Open(sqlite.Open(filepath.Join(dir, "reference.db")), &gorm.Config{
		NamingStrategy: schema.NamingStrategy{SingularTable: true},
	})
	if err != nil {
		t.Fatalf("open reference db: %v", err)
	}
	defer closeDBForSchemaCompare(t, reference)
	if err := reference.AutoMigrate(
		&models.AuthAccount{},
		&models.AuthSession{},
		&models.ExtensionToken{},
		&models.Directory{},
		&models.JavStudio{},
		&models.JavStudioAlias{},
		&models.JavSeries{},
		&models.Jav{},
		&models.Video{},
		&models.VideoLocation{},
		&models.TagCategory{},
		&models.Tag{},
		&models.VideoTag{},
		&models.Config{},
		&models.JavTag{},
		&models.JavTagCategory{},
		&models.JavIdol{},
		&models.JavIdolAlias{},
		&models.JavFavoriteGroup{},
		&models.JavFavoriteMap{},
		&models.JavTagMap{},
		&models.JavIdolMap{},
		&models.DownloaderSettings{},
		&models.DownloaderProviderSettings{},
		&models.DownloadJob{},
	); err != nil {
		t.Fatalf("automigrate reference schema: %v", err)
	}

	assertSchemaSnapshotEqual(t, loadSchemaSnapshot(t, migrated), loadSchemaSnapshot(t, reference))
}

type schemaSnapshot struct {
	Tables map[string]tableSnapshot
}

type tableSnapshot struct {
	Columns     []columnSnapshot
	Indexes     []indexSnapshot
	ForeignKeys []foreignKeySnapshot
}

type columnSnapshot struct {
	Name       string
	Type       string
	NotNull    int
	Default    string
	PrimaryKey int
}

type indexSnapshot struct {
	Name    string
	Unique  int
	Origin  string
	Partial int
	Columns []string
}

type foreignKeySnapshot struct {
	Table    string
	From     string
	To       string
	OnUpdate string
	OnDelete string
}

func assertSchemaSnapshotEqual(t *testing.T, migrated, reference schemaSnapshot) {
	t.Helper()
	if !reflect.DeepEqual(tableNames(migrated), tableNames(reference)) {
		t.Fatalf("table names differ: migrated=%v reference=%v", tableNames(migrated), tableNames(reference))
	}
	for _, table := range tableNames(reference) {
		got := migrated.Tables[table]
		want := reference.Tables[table]
		if !reflect.DeepEqual(got.Columns, want.Columns) {
			t.Fatalf("%s columns differ:\nmigrated:  %#v\nreference: %#v", table, got.Columns, want.Columns)
		}
		if !reflect.DeepEqual(got.Indexes, want.Indexes) {
			t.Fatalf("%s indexes differ:\nmigrated:  %#v\nreference: %#v", table, got.Indexes, want.Indexes)
		}
		if !reflect.DeepEqual(got.ForeignKeys, want.ForeignKeys) {
			t.Fatalf("%s foreign keys differ:\nmigrated:  %#v\nreference: %#v", table, got.ForeignKeys, want.ForeignKeys)
		}
	}
}

func tableNames(snapshot schemaSnapshot) []string {
	names := make([]string, 0, len(snapshot.Tables))
	for name := range snapshot.Tables {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func loadSchemaSnapshot(t *testing.T, db *gorm.DB) schemaSnapshot {
	t.Helper()
	tables := loadTables(t, db)
	result := schemaSnapshot{Tables: map[string]tableSnapshot{}}
	for _, table := range tables {
		result.Tables[table] = tableSnapshot{
			Columns:     loadColumns(t, db, table),
			Indexes:     loadIndexes(t, db, table),
			ForeignKeys: loadForeignKeys(t, db, table),
		}
	}
	return result
}

func loadTables(t *testing.T, db *gorm.DB) []string {
	t.Helper()
	rows, err := db.Raw(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).Rows()
	if err != nil {
		t.Fatalf("load tables: %v", err)
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan table: %v", err)
		}
		if name == "goose_db_version" {
			continue
		}
		tables = append(tables, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate tables: %v", err)
	}
	return tables
}

func loadColumns(t *testing.T, db *gorm.DB, table string) []columnSnapshot {
	t.Helper()
	rows, err := db.Raw("PRAGMA table_info(" + table + ")").Rows()
	if err != nil {
		t.Fatalf("load %s columns: %v", table, err)
	}
	defer rows.Close()

	var columns []columnSnapshot
	for rows.Next() {
		var cid int
		var col columnSnapshot
		var defaultValue any
		if err := rows.Scan(&cid, &col.Name, &col.Type, &col.NotNull, &defaultValue, &col.PrimaryKey); err != nil {
			t.Fatalf("scan %s column: %v", table, err)
		}
		if defaultValue != nil {
			col.Default = normalizeSQLiteDefault(fmt.Sprint(defaultValue))
		}
		columns = append(columns, col)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate %s columns: %v", table, err)
	}
	return columns
}

func normalizeSQLiteDefault(value string) string {
	switch value {
	case "false":
		return "0"
	case "true":
		return "1"
	default:
		return value
	}
}

func loadIndexes(t *testing.T, db *gorm.DB, table string) []indexSnapshot {
	t.Helper()
	rows, err := db.Raw("PRAGMA index_list(" + table + ")").Rows()
	if err != nil {
		t.Fatalf("load %s indexes: %v", table, err)
	}
	defer rows.Close()

	var indexes []indexSnapshot
	for rows.Next() {
		var seq int
		var idx indexSnapshot
		if err := rows.Scan(&seq, &idx.Name, &idx.Unique, &idx.Origin, &idx.Partial); err != nil {
			t.Fatalf("scan %s index: %v", table, err)
		}
		if idx.Origin == "pk" {
			continue
		}
		idx.Columns = loadIndexColumns(t, db, idx.Name)
		indexes = append(indexes, idx)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate %s indexes: %v", table, err)
	}
	sort.Slice(indexes, func(i, j int) bool { return indexes[i].Name < indexes[j].Name })
	return indexes
}

func loadIndexColumns(t *testing.T, db *gorm.DB, index string) []string {
	t.Helper()
	rows, err := db.Raw("PRAGMA index_xinfo(" + index + ")").Rows()
	if err != nil {
		t.Fatalf("load %s index columns: %v", index, err)
	}
	defer rows.Close()

	type indexedColumn struct {
		seqno int
		name  string
	}
	var columns []indexedColumn
	for rows.Next() {
		var seqno, cid, desc, key int
		var name, coll any
		if err := rows.Scan(&seqno, &cid, &name, &desc, &coll, &key); err != nil {
			t.Fatalf("scan %s index column: %v", index, err)
		}
		if key == 0 || cid < 0 {
			continue
		}
		columns = append(columns, indexedColumn{seqno: seqno, name: fmt.Sprint(name)})
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate %s index columns: %v", index, err)
	}

	sort.Slice(columns, func(i, j int) bool { return columns[i].seqno < columns[j].seqno })
	values := make([]string, 0, len(columns))
	for _, col := range columns {
		values = append(values, col.name)
	}
	return values
}

func loadForeignKeys(t *testing.T, db *gorm.DB, table string) []foreignKeySnapshot {
	t.Helper()
	rows, err := db.Raw("PRAGMA foreign_key_list(" + table + ")").Rows()
	if err != nil {
		t.Fatalf("load %s foreign keys: %v", table, err)
	}
	defer rows.Close()

	var keys []foreignKeySnapshot
	for rows.Next() {
		var id, seq int
		var key foreignKeySnapshot
		var match string
		if err := rows.Scan(&id, &seq, &key.Table, &key.From, &key.To, &key.OnUpdate, &key.OnDelete, &match); err != nil {
			t.Fatalf("scan %s foreign key: %v", table, err)
		}
		keys = append(keys, key)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate %s foreign keys: %v", table, err)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].Table != keys[j].Table {
			return keys[i].Table < keys[j].Table
		}
		return keys[i].From < keys[j].From
	})
	return keys
}

func closeDBForSchemaCompare(t *testing.T, db *gorm.DB) {
	t.Helper()
	sqlDB, err := db.DB()
	if err == nil {
		_ = sqlDB.Close()
	}
}
