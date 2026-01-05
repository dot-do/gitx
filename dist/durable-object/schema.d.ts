export interface DurableObjectStorage {
    sql: {
        exec(query: string, ...params: unknown[]): {
            toArray(): unknown[];
        };
    };
}
export declare const SCHEMA_VERSION = 1;
export declare const SCHEMA_SQL = "\n-- Git objects (blobs, trees, commits, tags)\nCREATE TABLE IF NOT EXISTS objects (sha TEXT PRIMARY KEY, type TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL, created_at INTEGER);\n\n-- Object location index for tiered storage\nCREATE TABLE IF NOT EXISTS object_index (sha TEXT PRIMARY KEY, tier TEXT NOT NULL DEFAULT 'hot', location TEXT NOT NULL DEFAULT 'local', size INTEGER, type TEXT);\n\n-- Hot objects cache\nCREATE TABLE IF NOT EXISTS hot_objects (sha TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB NOT NULL, accessed_at INTEGER, created_at INTEGER);\n\n-- Write-ahead log\nCREATE TABLE IF NOT EXISTS wal (id INTEGER PRIMARY KEY AUTOINCREMENT, operation TEXT NOT NULL, payload BLOB NOT NULL, created_at INTEGER, flushed INTEGER DEFAULT 0);\n\n-- Refs table\nCREATE TABLE IF NOT EXISTS refs (name TEXT PRIMARY KEY, target TEXT NOT NULL, type TEXT DEFAULT 'sha', updated_at INTEGER);\n\n-- Indexes\nCREATE INDEX IF NOT EXISTS idx_objects_type ON objects(type);\nCREATE INDEX IF NOT EXISTS idx_wal_flushed ON wal(flushed);\nCREATE INDEX IF NOT EXISTS idx_hot_objects_accessed ON hot_objects(accessed_at);\n";
export declare class SchemaManager {
    private storage;
    constructor(storage: DurableObjectStorage);
    initializeSchema(): Promise<void>;
    getSchemaVersion(): Promise<number>;
    validateSchema(): Promise<boolean>;
}
//# sourceMappingURL=schema.d.ts.map