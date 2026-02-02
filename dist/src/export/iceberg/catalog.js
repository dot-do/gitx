/**
 * @fileoverview R2 Data Catalog Client
 *
 * Implements the Iceberg REST catalog protocol for R2 Data Catalog
 * integration, enabling queryable Iceberg tables via DuckDB/Spark.
 *
 * @module export/iceberg/catalog
 */
import { r2PathWithPrefix } from '../../utils/r2-path';
/**
 * Catalog error.
 */
export class CatalogError extends Error {
    code;
    details;
    constructor(message, code, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'CatalogError';
    }
}
/**
 * Error thrown when a ref name fails validation.
 */
export class InvalidRefNameError extends Error {
    refName;
    reason;
    constructor(refName, reason) {
        super(`Invalid ref name "${refName}": ${reason}`);
        this.refName = refName;
        this.reason = reason;
        this.name = 'InvalidRefNameError';
    }
}
/**
 * Validates a Git ref name according to Git ref naming rules.
 *
 * Valid Git ref names:
 * - Cannot be empty
 * - Cannot start with a dot or end with .lock
 * - Cannot contain ..
 * - Cannot contain control characters (ASCII < 32)
 * - Cannot contain ~ ^ : \ ? * [ or @{
 *
 * @param refName - The ref name to validate
 * @throws InvalidRefNameError if the ref name is invalid
 */
export function validateRefName(refName) {
    // Cannot be empty
    if (!refName || refName.length === 0) {
        throw new InvalidRefNameError(refName, 'ref name cannot be empty');
    }
    // Cannot start with a dot
    if (refName.startsWith('.')) {
        throw new InvalidRefNameError(refName, 'ref name cannot start with a dot');
    }
    // Cannot end with .lock
    if (refName.endsWith('.lock')) {
        throw new InvalidRefNameError(refName, 'ref name cannot end with .lock');
    }
    // Cannot contain ..
    if (refName.includes('..')) {
        throw new InvalidRefNameError(refName, 'ref name cannot contain ".."');
    }
    // Cannot contain control characters (ASCII < 32)
    for (let i = 0; i < refName.length; i++) {
        const code = refName.charCodeAt(i);
        if (code < 32) {
            throw new InvalidRefNameError(refName, 'ref name cannot contain control characters');
        }
    }
    // Cannot contain ~ ^ : \ ? * [ or @{
    const invalidChars = /[~^:\\?*\[]/;
    if (invalidChars.test(refName)) {
        throw new InvalidRefNameError(refName, 'ref name cannot contain ~ ^ : \\ ? * or [');
    }
    // Cannot contain @{
    if (refName.includes('@{')) {
        throw new InvalidRefNameError(refName, 'ref name cannot contain "@{"');
    }
}
// ============================================================================
// R2 Data Catalog
// ============================================================================
/**
 * R2 Data Catalog client for Iceberg table management.
 *
 * @description
 * Implements a minimal Iceberg REST catalog protocol compatible with
 * R2 Data Catalog, storing metadata in R2 alongside Parquet data files.
 *
 * @example
 * ```typescript
 * const catalog = new R2DataCatalog({
 *   bucket: env.ANALYTICS_BUCKET,
 *   warehouseLocation: 'r2://gitx-analytics',
 * })
 *
 * // Register a new table
 * await catalog.registerTable('gitx', 'commits', 'r2://gitx-analytics/commits')
 *
 * // Update table with new snapshot
 * await catalog.updateTable('gitx', 'commits', [
 *   { action: 'add-snapshot', snapshot: newSnapshot },
 *   { action: 'set-snapshot-ref', ref_name: 'main', type: 'branch', snapshot_id: newSnapshot.snapshot_id },
 * ])
 * ```
 */
export class R2DataCatalog {
    bucket;
    prefix;
    maxRetries;
    constructor(config) {
        this.bucket = config.bucket;
        this.prefix = config.prefix ?? '';
        this.maxRetries = config.maxRetries ?? 3;
        // warehouseLocation stored for future use in catalog operations
    }
    // ===========================================================================
    // Namespace Operations
    // ===========================================================================
    /**
     * Lists all namespaces in the catalog.
     */
    async listNamespaces() {
        const catalogPath = this.catalogPath('namespaces.json');
        const obj = await this.bucket.get(catalogPath);
        if (!obj)
            return [];
        const data = await obj.json();
        return data.namespaces ?? [];
    }
    /**
     * Creates a namespace.
     */
    async createNamespace(namespace, properties) {
        const namespaces = await this.listNamespaces();
        const key = namespace.join('.');
        // Check if already exists
        if (namespaces.some(ns => ns.join('.') === key)) {
            throw new CatalogError(`Namespace ${key} already exists`, 'ALREADY_EXISTS');
        }
        namespaces.push(namespace);
        await this.bucket.put(this.catalogPath('namespaces.json'), JSON.stringify({ namespaces }, null, 2), { httpMetadata: { contentType: 'application/json' } });
        // Store namespace properties if provided
        if (properties && Object.keys(properties).length > 0) {
            await this.bucket.put(this.catalogPath(`namespaces/${key}/properties.json`), JSON.stringify(properties, null, 2), { httpMetadata: { contentType: 'application/json' } });
        }
    }
    // ===========================================================================
    // Table Operations
    // ===========================================================================
    /**
     * Lists tables in a namespace.
     */
    async listTables(namespace) {
        const tablesPath = this.catalogPath(`namespaces/${namespace}/tables.json`);
        const obj = await this.bucket.get(tablesPath);
        if (!obj)
            return [];
        const data = await obj.json();
        return (data.tables ?? []).map(name => ({
            namespace: [namespace],
            name,
        }));
    }
    /**
     * Registers a new table in the catalog.
     *
     * @param namespace - Catalog namespace
     * @param table - Table name
     * @param location - R2 location for table data
     * @param metadata - Optional initial table metadata
     */
    async registerTable(namespace, table, location, metadata) {
        // Ensure namespace exists
        const namespaces = await this.listNamespaces();
        if (!namespaces.some(ns => ns.join('.') === namespace)) {
            await this.createNamespace([namespace]);
        }
        // Check if table already exists
        const tables = await this.listTables(namespace);
        if (tables.some(t => t.name === table)) {
            throw new CatalogError(`Table ${namespace}.${table} already exists`, 'ALREADY_EXISTS');
        }
        // Create initial metadata
        const now = Date.now();
        const tableMetadata = {
            format_version: 2,
            table_uuid: crypto.randomUUID(),
            location,
            last_sequence_number: 0,
            last_updated_ms: now,
            last_column_id: metadata?.schemas?.[0]?.fields.length ?? 0,
            current_schema_id: 0,
            schemas: metadata?.schemas ?? [],
            default_spec_id: 0,
            partition_specs: metadata?.partition_specs ?? [{ spec_id: 0, fields: [] }],
            last_partition_id: 0,
            default_sort_order_id: 0,
            sort_orders: metadata?.sort_orders ?? [{ order_id: 0, fields: [] }],
            snapshots: [],
            snapshot_log: [],
            refs: {
                main: {
                    snapshot_id: -1,
                    type: 'branch',
                },
            },
        };
        const fullMetadata = metadata?.properties
            ? { ...tableMetadata, properties: metadata.properties }
            : tableMetadata;
        // Write metadata file
        const metadataPath = `${location}/metadata/v1.metadata.json`;
        await this.bucket.put(this.r2Path(metadataPath), JSON.stringify(fullMetadata, null, 2), { httpMetadata: { contentType: 'application/json' } });
        // Update tables list
        const tablesList = tables.map(t => t.name);
        tablesList.push(table);
        await this.bucket.put(this.catalogPath(`namespaces/${namespace}/tables.json`), JSON.stringify({ tables: tablesList }, null, 2), { httpMetadata: { contentType: 'application/json' } });
        // Store table location pointer with initial version
        const locationData = {
            location,
            current_metadata: metadataPath,
            metadata_version: 1,
        };
        await this.bucket.put(this.catalogPath(`namespaces/${namespace}/${table}/location.json`), JSON.stringify(locationData, null, 2), { httpMetadata: { contentType: 'application/json' } });
        return fullMetadata;
    }
    /**
     * Gets table metadata.
     */
    async getTable(namespace, table) {
        const result = await this.getTableWithVersion(namespace, table);
        return result.metadata;
    }
    /**
     * Gets table metadata along with version information for optimistic concurrency control.
     * @internal
     */
    async getTableWithVersion(namespace, table) {
        const locationPath = this.catalogPath(`namespaces/${namespace}/${table}/location.json`);
        const locationObj = await this.bucket.get(locationPath);
        if (!locationObj) {
            throw new CatalogError(`Table ${namespace}.${table} not found`, 'NOT_FOUND');
        }
        const locationEtag = locationObj.etag;
        const locationData = await locationObj.json();
        const metadataObj = await this.bucket.get(this.r2Path(locationData.current_metadata));
        if (!metadataObj) {
            throw new CatalogError(`Metadata for ${namespace}.${table} not found`, 'NOT_FOUND');
        }
        return {
            metadata: await metadataObj.json(),
            locationData,
            locationEtag,
        };
    }
    /**
     * Updates table metadata with atomic operations using optimistic concurrency control.
     *
     * This method implements the Iceberg standard pattern:
     * 1. Reads current metadata and location pointer (with ETag)
     * 2. Validates requirements against current state
     * 3. Applies updates in memory
     * 4. Writes new versioned metadata file (v1.metadata.json, v2.metadata.json, etc.)
     * 5. Atomically updates location pointer using conditional put (ETag check)
     *
     * If a concurrent update occurs, the conditional put fails and the operation is retried.
     *
     * @param namespace - Catalog namespace
     * @param table - Table name
     * @param updates - List of update operations
     * @param requirements - Optional requirements for optimistic locking
     * @throws CatalogError with code 'CONFLICT' if max retries exceeded due to concurrent updates
     */
    async updateTable(namespace, table, updates, requirements) {
        let lastError = null;
        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            try {
                return await this.tryUpdateTable(namespace, table, updates, requirements);
            }
            catch (error) {
                if (error instanceof CatalogError && error.code === 'CONFLICT') {
                    // Concurrent modification detected, retry
                    lastError = error;
                    // Small exponential backoff: 10ms, 20ms, 40ms, ...
                    await new Promise(resolve => setTimeout(resolve, 10 * Math.pow(2, attempt)));
                    continue;
                }
                // Non-conflict errors should be rethrown immediately
                throw error;
            }
        }
        // Max retries exceeded
        throw new CatalogError(`Failed to update table ${namespace}.${table} after ${this.maxRetries} attempts due to concurrent modifications`, 'CONFLICT', { attempts: this.maxRetries, lastError: lastError?.message });
    }
    /**
     * Attempts a single table update with optimistic concurrency control.
     * @internal
     */
    async tryUpdateTable(namespace, table, updates, requirements) {
        // Get current metadata with version info
        const { metadata: current, locationData, locationEtag } = await this.getTableWithVersion(namespace, table);
        // Validate requirements
        if (requirements) {
            for (const req of requirements) {
                this.validateRequirement(current, req);
            }
        }
        // Apply updates
        let metadata = { ...current };
        for (const update of updates) {
            metadata = this.applyUpdate(metadata, update);
        }
        // Calculate new version number
        const currentVersion = locationData.metadata_version ?? this.extractVersionFromPath(locationData.current_metadata);
        const newVersion = currentVersion + 1;
        metadata.last_updated_ms = Date.now();
        // Write new metadata file (versioned, immutable once written)
        const newMetadataPath = `${locationData.location}/metadata/v${newVersion}.metadata.json`;
        await this.bucket.put(this.r2Path(newMetadataPath), JSON.stringify(metadata, null, 2), { httpMetadata: { contentType: 'application/json' } });
        // Atomically update location pointer with ETag check (optimistic concurrency)
        const locationPath = this.catalogPath(`namespaces/${namespace}/${table}/location.json`);
        const newLocationData = {
            ...locationData,
            current_metadata: newMetadataPath,
            metadata_version: newVersion,
        };
        try {
            await this.bucket.put(locationPath, JSON.stringify(newLocationData, null, 2), {
                httpMetadata: { contentType: 'application/json' },
                onlyIf: { etagMatches: locationEtag },
            });
        }
        catch (error) {
            // R2 returns a 412 Precondition Failed if ETag doesn't match
            // This indicates a concurrent modification
            if (this.isPreconditionFailed(error)) {
                // Clean up the orphaned metadata file we just wrote
                await this.bucket.delete(this.r2Path(newMetadataPath)).catch(() => {
                    // Best effort cleanup, ignore errors
                });
                throw new CatalogError(`Concurrent modification detected for table ${namespace}.${table}`, 'CONFLICT', { expectedVersion: currentVersion, attemptedVersion: newVersion });
            }
            throw error;
        }
        // Add to metadata log for history tracking
        if (!metadata.metadata_log) {
            metadata.metadata_log = [];
        }
        metadata.metadata_log.push({
            metadata_file: newMetadataPath,
            timestamp_ms: metadata.last_updated_ms,
        });
        return metadata;
    }
    /**
     * Extracts version number from metadata path (e.g., "v2.metadata.json" -> 2).
     * @internal
     */
    extractVersionFromPath(metadataPath) {
        const match = metadataPath.match(/\/v(\d+)\.metadata\.json$/);
        return match ? parseInt(match[1], 10) : 1;
    }
    /**
     * Checks if an error is a precondition failed error (412).
     * @internal
     */
    isPreconditionFailed(error) {
        // R2 throws an error when onlyIf condition fails
        // The specific error format may vary, so we check multiple indicators
        if (error && typeof error === 'object') {
            const e = error;
            if (e.status === 412)
                return true;
            if (e.code === 'PreconditionFailed')
                return true;
            if (e.message?.includes('412') || e.message?.includes('precondition'))
                return true;
        }
        return false;
    }
    /**
     * Drops a table from the catalog.
     *
     * @param namespace - Catalog namespace
     * @param table - Table name
     * @param purge - If true, delete all data files under the table location
     */
    async dropTable(namespace, table, purge = false) {
        const tables = await this.listTables(namespace);
        if (!tables.some(t => t.name === table)) {
            throw new CatalogError(`Table ${namespace}.${table} not found`, 'NOT_FOUND');
        }
        // IMPORTANT: Read all metadata BEFORE deleting anything
        // This prevents errors when purge=true needs metadata after location is deleted
        let tableLocation = null;
        if (purge) {
            const metadata = await this.getTable(namespace, table).catch(() => null);
            if (metadata) {
                tableLocation = metadata.location;
            }
        }
        // Remove from tables list
        const tablesList = tables.filter(t => t.name !== table).map(t => t.name);
        await this.bucket.put(this.catalogPath(`namespaces/${namespace}/tables.json`), JSON.stringify({ tables: tablesList }, null, 2), { httpMetadata: { contentType: 'application/json' } });
        // Delete location pointer
        await this.bucket.delete(this.catalogPath(`namespaces/${namespace}/${table}/location.json`));
        // Purge data files if requested and location was retrieved
        if (purge && tableLocation) {
            const prefix = this.r2Path(tableLocation);
            const listed = await this.bucket.list({ prefix });
            for (const obj of listed.objects) {
                await this.bucket.delete(obj.key);
            }
        }
    }
    // ===========================================================================
    // Private Methods
    // ===========================================================================
    catalogPath(path) {
        return this.prefix ? `${this.prefix}/catalog/${path}` : `catalog/${path}`;
    }
    r2Path(location) {
        return r2PathWithPrefix(location, this.prefix || undefined);
    }
    getMetadataVersion(metadata) {
        // Extract version from snapshot log or default to 1
        return (metadata.metadata_log?.length ?? 0) + 1;
    }
    validateRequirement(metadata, req) {
        switch (req.type) {
            case 'assert-create':
                throw new CatalogError('Table already exists', 'ALREADY_EXISTS');
            case 'assert-table-uuid':
                if (metadata.table_uuid !== req.uuid) {
                    throw new CatalogError('Table UUID mismatch', 'CONFLICT');
                }
                break;
            case 'assert-current-schema-id':
                if (metadata.current_schema_id !== req.current_schema_id) {
                    throw new CatalogError('Schema ID mismatch', 'CONFLICT');
                }
                break;
            case 'assert-ref-snapshot-id':
                validateRefName(req.ref);
                const refSnapshotId = metadata.refs?.[req.ref]?.snapshot_id ?? null;
                if (refSnapshotId !== req.snapshot_id) {
                    throw new CatalogError(`Ref ${req.ref} snapshot mismatch`, 'CONFLICT');
                }
                break;
            // Add other requirement types as needed
        }
    }
    /**
     * Validates a TableUpdate object has the required structure for its action type.
     * Throws CatalogError if validation fails.
     * @internal
     */
    validateUpdate(update) {
        if (!update || typeof update !== 'object') {
            throw new CatalogError('Invalid update: expected object', 'INTERNAL', { update });
        }
        const u = update;
        const action = u['action'];
        if (typeof action !== 'string') {
            throw new CatalogError('Invalid update: missing or invalid action', 'INTERNAL', { update });
        }
        switch (action) {
            case 'add-schema':
                if (!this.isValidSchema(u['schema'])) {
                    throw new CatalogError('Invalid add-schema update: schema must have type "struct" and fields array', 'INTERNAL', { update });
                }
                break;
            case 'set-current-schema':
                if (typeof u['schema_id'] !== 'number') {
                    throw new CatalogError('Invalid set-current-schema update: schema_id must be a number', 'INTERNAL', { update });
                }
                break;
            case 'add-partition-spec':
                if (!this.isValidPartitionSpec(u['spec'])) {
                    throw new CatalogError('Invalid add-partition-spec update: spec must have spec_id and fields array', 'INTERNAL', { update });
                }
                break;
            case 'set-default-spec':
                if (typeof u['spec_id'] !== 'number') {
                    throw new CatalogError('Invalid set-default-spec update: spec_id must be a number', 'INTERNAL', { update });
                }
                break;
            case 'add-sort-order':
                if (!this.isValidSortOrder(u['sort_order'])) {
                    throw new CatalogError('Invalid add-sort-order update: sort_order must have order_id and fields array', 'INTERNAL', { update });
                }
                break;
            case 'set-default-sort-order':
                if (typeof u['sort_order_id'] !== 'number') {
                    throw new CatalogError('Invalid set-default-sort-order update: sort_order_id must be a number', 'INTERNAL', { update });
                }
                break;
            case 'add-snapshot':
                if (!this.isValidSnapshot(u['snapshot'])) {
                    throw new CatalogError('Invalid add-snapshot update: snapshot must have snapshot_id, sequence_number, timestamp_ms, manifest_list, and summary', 'INTERNAL', { update });
                }
                break;
            case 'set-snapshot-ref': {
                const refName = u['ref_name'];
                const type = u['type'];
                const snapshotId = u['snapshot_id'];
                if (typeof refName !== 'string' || !refName) {
                    throw new CatalogError('Invalid set-snapshot-ref update: ref_name must be a non-empty string', 'INTERNAL', { update });
                }
                if (type !== 'branch' && type !== 'tag') {
                    throw new CatalogError('Invalid set-snapshot-ref update: type must be "branch" or "tag"', 'INTERNAL', { update });
                }
                if (typeof snapshotId !== 'number') {
                    throw new CatalogError('Invalid set-snapshot-ref update: snapshot_id must be a number', 'INTERNAL', { update });
                }
                break;
            }
            case 'remove-snapshots': {
                const snapshotIds = u['snapshot_ids'];
                if (!Array.isArray(snapshotIds) || !snapshotIds.every(id => typeof id === 'number')) {
                    throw new CatalogError('Invalid remove-snapshots update: snapshot_ids must be an array of numbers', 'INTERNAL', { update });
                }
                break;
            }
            case 'set-properties': {
                const updates = u['updates'];
                if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
                    throw new CatalogError('Invalid set-properties update: updates must be an object', 'INTERNAL', { update });
                }
                break;
            }
            case 'remove-properties': {
                const removals = u['removals'];
                if (!Array.isArray(removals) || !removals.every(k => typeof k === 'string')) {
                    throw new CatalogError('Invalid remove-properties update: removals must be an array of strings', 'INTERNAL', { update });
                }
                break;
            }
            case 'set-location': {
                const location = u['location'];
                if (typeof location !== 'string' || !location) {
                    throw new CatalogError('Invalid set-location update: location must be a non-empty string', 'INTERNAL', { update });
                }
                break;
            }
            default:
                throw new CatalogError(`Unknown update action: ${action}`, 'INTERNAL', { update });
        }
    }
    /**
     * Validates that a value is a valid IcebergSchema.
     * @internal
     */
    isValidSchema(schema) {
        if (!schema || typeof schema !== 'object')
            return false;
        const s = schema;
        const fields = s['fields'];
        return (s['type'] === 'struct' &&
            typeof s['schema_id'] === 'number' &&
            Array.isArray(fields) &&
            fields.every((f) => this.isValidField(f)));
    }
    /**
     * Validates that a value is a valid IcebergField.
     * @internal
     */
    isValidField(field) {
        if (!field || typeof field !== 'object')
            return false;
        const f = field;
        return (typeof f['id'] === 'number' &&
            typeof f['name'] === 'string' &&
            typeof f['required'] === 'boolean' &&
            f['type'] !== undefined);
    }
    /**
     * Validates that a value is a valid PartitionSpec.
     * @internal
     */
    isValidPartitionSpec(spec) {
        if (!spec || typeof spec !== 'object')
            return false;
        const s = spec;
        const fields = s['fields'];
        return (typeof s['spec_id'] === 'number' &&
            Array.isArray(fields) &&
            fields.every((f) => {
                if (!f || typeof f !== 'object')
                    return false;
                const pf = f;
                return (typeof pf['source_id'] === 'number' &&
                    typeof pf['field_id'] === 'number' &&
                    typeof pf['name'] === 'string' &&
                    pf['transform'] !== undefined);
            }));
    }
    /**
     * Validates that a value is a valid SortOrder.
     * @internal
     */
    isValidSortOrder(order) {
        if (!order || typeof order !== 'object')
            return false;
        const o = order;
        return typeof o['order_id'] === 'number' && Array.isArray(o['fields']);
    }
    /**
     * Validates that a value is a valid IcebergSnapshot.
     * @internal
     */
    isValidSnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== 'object')
            return false;
        const s = snapshot;
        return (typeof s['snapshot_id'] === 'number' &&
            typeof s['sequence_number'] === 'number' &&
            typeof s['timestamp_ms'] === 'number' &&
            typeof s['manifest_list'] === 'string' &&
            s['summary'] !== undefined &&
            typeof s['summary'] === 'object');
    }
    applyUpdate(metadata, update) {
        // Validate update structure before processing
        this.validateUpdate(update);
        switch (update.action) {
            case 'add-schema':
                return {
                    ...metadata,
                    schemas: [...(metadata.schemas ?? []), update.schema],
                    last_column_id: Math.max(metadata.last_column_id, ...update.schema.fields.map(f => f.id)),
                };
            case 'set-current-schema':
                return {
                    ...metadata,
                    current_schema_id: update.schema_id,
                };
            case 'add-partition-spec':
                return {
                    ...metadata,
                    partition_specs: [...(metadata.partition_specs ?? []), update.spec],
                    last_partition_id: Math.max(metadata.last_partition_id, ...update.spec.fields.map(f => f.field_id)),
                };
            case 'set-default-spec':
                return {
                    ...metadata,
                    default_spec_id: update.spec_id,
                };
            case 'add-sort-order':
                return {
                    ...metadata,
                    sort_orders: [...(metadata.sort_orders ?? []), update.sort_order],
                };
            case 'set-default-sort-order':
                return {
                    ...metadata,
                    default_sort_order_id: update.sort_order_id,
                };
            case 'add-snapshot':
                return {
                    ...metadata,
                    last_sequence_number: update.snapshot.sequence_number,
                    snapshots: [...(metadata.snapshots ?? []), update.snapshot],
                    snapshot_log: [
                        ...(metadata.snapshot_log ?? []),
                        {
                            snapshot_id: update.snapshot.snapshot_id,
                            timestamp_ms: update.snapshot.timestamp_ms,
                        },
                    ],
                };
            case 'set-snapshot-ref': {
                validateRefName(update.ref_name);
                const updatedMetadata = {
                    ...metadata,
                    refs: {
                        ...(metadata.refs ?? {}),
                        [update.ref_name]: {
                            snapshot_id: update.snapshot_id,
                            type: update.type,
                        },
                    },
                };
                if (update.ref_name === 'main') {
                    updatedMetadata.current_snapshot_id = update.snapshot_id;
                }
                return updatedMetadata;
            }
            case 'remove-snapshots':
                return {
                    ...metadata,
                    snapshots: (metadata.snapshots ?? []).filter(s => !update.snapshot_ids.includes(s.snapshot_id)),
                };
            case 'set-properties':
                return {
                    ...metadata,
                    properties: {
                        ...(metadata.properties ?? {}),
                        ...update.updates,
                    },
                };
            case 'remove-properties':
                const props = { ...(metadata.properties ?? {}) };
                for (const key of update.removals) {
                    delete props[key];
                }
                return {
                    ...metadata,
                    properties: props,
                };
            case 'set-location':
                return {
                    ...metadata,
                    location: update.location,
                };
            default:
                // This should never be reached due to validation, but TypeScript needs it
                return metadata;
        }
    }
}
//# sourceMappingURL=catalog.js.map