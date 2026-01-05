export const SCHEMA_VERSION = 1;
export const SCHEMA_SQL = `
-- Git objects (blobs, trees, commits, tags)
CREATE TABLE IF NOT EXISTS objects (sha TEXT PRIMARY KEY, type TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL, created_at INTEGER);

-- Object location index for tiered storage
CREATE TABLE IF NOT EXISTS object_index (sha TEXT PRIMARY KEY, tier TEXT NOT NULL DEFAULT 'hot', location TEXT NOT NULL DEFAULT 'local', size INTEGER, type TEXT);

-- Hot objects cache
CREATE TABLE IF NOT EXISTS hot_objects (sha TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB NOT NULL, accessed_at INTEGER, created_at INTEGER);

-- Write-ahead log
CREATE TABLE IF NOT EXISTS wal (id INTEGER PRIMARY KEY AUTOINCREMENT, operation TEXT NOT NULL, payload BLOB NOT NULL, created_at INTEGER, flushed INTEGER DEFAULT 0);

-- Refs table
CREATE TABLE IF NOT EXISTS refs (name TEXT PRIMARY KEY, target TEXT NOT NULL, type TEXT DEFAULT 'sha', updated_at INTEGER);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_objects_type ON objects(type);
CREATE INDEX IF NOT EXISTS idx_wal_flushed ON wal(flushed);
CREATE INDEX IF NOT EXISTS idx_hot_objects_accessed ON hot_objects(accessed_at);
`;
const REQUIRED_TABLES = ['objects', 'object_index', 'hot_objects', 'wal', 'refs'];
export class SchemaManager {
    storage;
    constructor(storage) {
        this.storage = storage;
    }
    async initializeSchema() {
        this.storage.sql.exec(SCHEMA_SQL);
    }
    async getSchemaVersion() {
        const isValid = await this.validateSchema();
        return isValid ? SCHEMA_VERSION : 0;
    }
    async validateSchema() {
        const result = this.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table'");
        const tables = result.toArray();
        const tableNames = tables.map(t => t.name);
        return REQUIRED_TABLES.every(table => tableNames.includes(table));
    }
}
//# sourceMappingURL=schema.js.map