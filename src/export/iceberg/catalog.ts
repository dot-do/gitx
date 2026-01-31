/**
 * @fileoverview R2 Data Catalog Client
 *
 * Implements the Iceberg REST catalog protocol for R2 Data Catalog
 * integration, enabling queryable Iceberg tables via DuckDB/Spark.
 *
 * @module export/iceberg/catalog
 */

import type {
  TableIdentifier,
  TableMetadata,
  TableUpdate,
  TableRequirement,
} from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * R2 Data Catalog configuration.
 */
export interface R2CatalogConfig {
  /** R2 bucket for storing Iceberg data */
  bucket: R2Bucket
  /** Base path prefix within bucket */
  prefix?: string
  /** Warehouse location URL */
  warehouseLocation: string
}

/**
 * Catalog error.
 */
export class CatalogError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'ALREADY_EXISTS' | 'CONFLICT' | 'INTERNAL',
    public readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'CatalogError'
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
  private bucket: R2Bucket
  private prefix: string

  constructor(config: R2CatalogConfig) {
    this.bucket = config.bucket
    this.prefix = config.prefix ?? ''
    // warehouseLocation stored for future use in catalog operations
  }

  // ===========================================================================
  // Namespace Operations
  // ===========================================================================

  /**
   * Lists all namespaces in the catalog.
   */
  async listNamespaces(): Promise<string[][]> {
    const catalogPath = this.catalogPath('namespaces.json')
    const obj = await this.bucket.get(catalogPath)
    if (!obj) return []

    const data = await obj.json<{ namespaces: string[][] }>()
    return data.namespaces ?? []
  }

  /**
   * Creates a namespace.
   */
  async createNamespace(namespace: string[], properties?: Record<string, string>): Promise<void> {
    const namespaces = await this.listNamespaces()
    const key = namespace.join('.')

    // Check if already exists
    if (namespaces.some(ns => ns.join('.') === key)) {
      throw new CatalogError(`Namespace ${key} already exists`, 'ALREADY_EXISTS')
    }

    namespaces.push(namespace)

    await this.bucket.put(
      this.catalogPath('namespaces.json'),
      JSON.stringify({ namespaces }, null, 2),
      { httpMetadata: { contentType: 'application/json' } }
    )

    // Store namespace properties if provided
    if (properties && Object.keys(properties).length > 0) {
      await this.bucket.put(
        this.catalogPath(`namespaces/${key}/properties.json`),
        JSON.stringify(properties, null, 2),
        { httpMetadata: { contentType: 'application/json' } }
      )
    }
  }

  // ===========================================================================
  // Table Operations
  // ===========================================================================

  /**
   * Lists tables in a namespace.
   */
  async listTables(namespace: string): Promise<TableIdentifier[]> {
    const tablesPath = this.catalogPath(`namespaces/${namespace}/tables.json`)
    const obj = await this.bucket.get(tablesPath)
    if (!obj) return []

    const data = await obj.json<{ tables: string[] }>()
    return (data.tables ?? []).map(name => ({
      namespace: [namespace],
      name,
    }))
  }

  /**
   * Registers a new table in the catalog.
   *
   * @param namespace - Catalog namespace
   * @param table - Table name
   * @param location - R2 location for table data
   * @param metadata - Optional initial table metadata
   */
  async registerTable(
    namespace: string,
    table: string,
    location: string,
    metadata?: Partial<TableMetadata>
  ): Promise<TableMetadata> {
    // Ensure namespace exists
    const namespaces = await this.listNamespaces()
    if (!namespaces.some(ns => ns.join('.') === namespace)) {
      await this.createNamespace([namespace])
    }

    // Check if table already exists
    const tables = await this.listTables(namespace)
    if (tables.some(t => t.name === table)) {
      throw new CatalogError(`Table ${namespace}.${table} already exists`, 'ALREADY_EXISTS')
    }

    // Create initial metadata
    const now = Date.now()
    const tableMetadata = {
      format_version: 2 as const,
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
          type: 'branch' as const,
        },
      },
    } satisfies Omit<TableMetadata, 'properties'>
    const fullMetadata: TableMetadata = metadata?.properties
      ? { ...tableMetadata, properties: metadata.properties }
      : tableMetadata

    // Write metadata file
    const metadataPath = `${location}/metadata/v1.metadata.json`
    await this.bucket.put(
      this.r2Path(metadataPath),
      JSON.stringify(fullMetadata, null, 2),
      { httpMetadata: { contentType: 'application/json' } }
    )

    // Update tables list
    const tablesList = tables.map(t => t.name)
    tablesList.push(table)
    await this.bucket.put(
      this.catalogPath(`namespaces/${namespace}/tables.json`),
      JSON.stringify({ tables: tablesList }, null, 2),
      { httpMetadata: { contentType: 'application/json' } }
    )

    // Store table location pointer
    await this.bucket.put(
      this.catalogPath(`namespaces/${namespace}/${table}/location.json`),
      JSON.stringify({ location, current_metadata: metadataPath }, null, 2),
      { httpMetadata: { contentType: 'application/json' } }
    )

    return fullMetadata
  }

  /**
   * Gets table metadata.
   */
  async getTable(namespace: string, table: string): Promise<TableMetadata> {
    const locationPath = this.catalogPath(`namespaces/${namespace}/${table}/location.json`)
    const locationObj = await this.bucket.get(locationPath)
    if (!locationObj) {
      throw new CatalogError(`Table ${namespace}.${table} not found`, 'NOT_FOUND')
    }

    const locationData = await locationObj.json<{ current_metadata: string }>()
    const metadataObj = await this.bucket.get(this.r2Path(locationData.current_metadata))
    if (!metadataObj) {
      throw new CatalogError(`Metadata for ${namespace}.${table} not found`, 'NOT_FOUND')
    }

    return metadataObj.json<TableMetadata>()
  }

  /**
   * Updates table metadata with atomic operations.
   *
   * @param namespace - Catalog namespace
   * @param table - Table name
   * @param updates - List of update operations
   * @param requirements - Optional requirements for optimistic locking
   */
  async updateTable(
    namespace: string,
    table: string,
    updates: TableUpdate[],
    requirements?: TableRequirement[]
  ): Promise<TableMetadata> {
    // Get current metadata
    const current = await this.getTable(namespace, table)

    // Validate requirements
    if (requirements) {
      for (const req of requirements) {
        this.validateRequirement(current, req)
      }
    }

    // Apply updates
    let metadata = { ...current }
    for (const update of updates) {
      metadata = this.applyUpdate(metadata, update)
    }

    // Increment version and update timestamp
    const version = this.getMetadataVersion(current) + 1
    metadata.last_updated_ms = Date.now()

    // Write new metadata file
    const locationPath = this.catalogPath(`namespaces/${namespace}/${table}/location.json`)
    const locationObj = await this.bucket.get(locationPath)
    const locationData = await locationObj!.json<{ location: string }>()

    const newMetadataPath = `${locationData.location}/metadata/v${version}.metadata.json`
    await this.bucket.put(
      this.r2Path(newMetadataPath),
      JSON.stringify(metadata, null, 2),
      { httpMetadata: { contentType: 'application/json' } }
    )

    // Update location pointer
    await this.bucket.put(
      locationPath,
      JSON.stringify({ ...locationData, current_metadata: newMetadataPath }, null, 2),
      { httpMetadata: { contentType: 'application/json' } }
    )

    return metadata
  }

  /**
   * Drops a table from the catalog.
   */
  async dropTable(namespace: string, table: string, purge = false): Promise<void> {
    const tables = await this.listTables(namespace)
    if (!tables.some(t => t.name === table)) {
      throw new CatalogError(`Table ${namespace}.${table} not found`, 'NOT_FOUND')
    }

    // Remove from tables list
    const tablesList = tables.filter(t => t.name !== table).map(t => t.name)
    await this.bucket.put(
      this.catalogPath(`namespaces/${namespace}/tables.json`),
      JSON.stringify({ tables: tablesList }, null, 2),
      { httpMetadata: { contentType: 'application/json' } }
    )

    // Delete location pointer
    await this.bucket.delete(this.catalogPath(`namespaces/${namespace}/${table}/location.json`))

    // Optionally purge data
    if (purge) {
      const metadata = await this.getTable(namespace, table).catch(() => null)
      if (metadata) {
        // Delete all objects under the table location
        const prefix = this.r2Path(metadata.location)
        const listed = await this.bucket.list({ prefix })
        for (const obj of listed.objects) {
          await this.bucket.delete(obj.key)
        }
      }
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private catalogPath(path: string): string {
    return this.prefix ? `${this.prefix}/catalog/${path}` : `catalog/${path}`
  }

  private r2Path(location: string): string {
    // Convert r2:// URL to bucket path
    if (location.startsWith('r2://')) {
      const path = location.replace(/^r2:\/\/[^/]+\//, '')
      return this.prefix ? `${this.prefix}/${path}` : path
    }
    return location
  }

  private getMetadataVersion(metadata: TableMetadata): number {
    // Extract version from snapshot log or default to 1
    return (metadata.metadata_log?.length ?? 0) + 1
  }

  private validateRequirement(metadata: TableMetadata, req: TableRequirement): void {
    switch (req.type) {
      case 'assert-create':
        throw new CatalogError('Table already exists', 'ALREADY_EXISTS')
      case 'assert-table-uuid':
        if (metadata.table_uuid !== req.uuid) {
          throw new CatalogError('Table UUID mismatch', 'CONFLICT')
        }
        break
      case 'assert-current-schema-id':
        if (metadata.current_schema_id !== req.current_schema_id) {
          throw new CatalogError('Schema ID mismatch', 'CONFLICT')
        }
        break
      case 'assert-ref-snapshot-id':
        const refSnapshotId = metadata.refs?.[req.ref]?.snapshot_id ?? null
        if (refSnapshotId !== req.snapshot_id) {
          throw new CatalogError(`Ref ${req.ref} snapshot mismatch`, 'CONFLICT')
        }
        break
      // Add other requirement types as needed
    }
  }

  private applyUpdate(metadata: TableMetadata, update: TableUpdate): TableMetadata {
    switch (update.action) {
      case 'add-schema':
        return {
          ...metadata,
          schemas: [...(metadata.schemas ?? []), update.schema],
          last_column_id: Math.max(
            metadata.last_column_id,
            ...update.schema.fields.map(f => f.id)
          ),
        }

      case 'set-current-schema':
        return {
          ...metadata,
          current_schema_id: update.schema_id,
        }

      case 'add-partition-spec':
        return {
          ...metadata,
          partition_specs: [...(metadata.partition_specs ?? []), update.spec],
          last_partition_id: Math.max(
            metadata.last_partition_id,
            ...update.spec.fields.map(f => f.field_id)
          ),
        }

      case 'set-default-spec':
        return {
          ...metadata,
          default_spec_id: update.spec_id,
        }

      case 'add-sort-order':
        return {
          ...metadata,
          sort_orders: [...(metadata.sort_orders ?? []), update.sort_order],
        }

      case 'set-default-sort-order':
        return {
          ...metadata,
          default_sort_order_id: update.sort_order_id,
        }

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
        }

      case 'set-snapshot-ref': {
        const updatedMetadata = {
          ...metadata,
          refs: {
            ...(metadata.refs ?? {}),
            [update.ref_name]: {
              snapshot_id: update.snapshot_id,
              type: update.type,
            },
          },
        }
        if (update.ref_name === 'main') {
          updatedMetadata.current_snapshot_id = update.snapshot_id
        }
        return updatedMetadata as TableMetadata
      }

      case 'remove-snapshots':
        return {
          ...metadata,
          snapshots: (metadata.snapshots ?? []).filter(
            s => !update.snapshot_ids.includes(s.snapshot_id)
          ),
        }

      case 'set-properties':
        return {
          ...metadata,
          properties: {
            ...(metadata.properties ?? {}),
            ...update.updates,
          },
        }

      case 'remove-properties':
        const props = { ...(metadata.properties ?? {}) }
        for (const key of update.removals) {
          delete props[key]
        }
        return {
          ...metadata,
          properties: props,
        }

      case 'set-location':
        return {
          ...metadata,
          location: update.location,
        }

      default:
        return metadata
    }
  }
}
