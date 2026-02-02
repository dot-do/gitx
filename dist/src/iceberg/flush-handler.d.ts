/**
 * @fileoverview Iceberg Flush Handler for ParquetStore
 *
 * Creates an `OnFlushHandler` callback that generates Iceberg v2 metadata
 * (manifest, manifest list, table metadata) after each ParquetStore flush.
 *
 * This module is the sole bridge between the storage layer (ParquetStore)
 * and Iceberg metadata generation. ParquetStore itself has no knowledge of
 * Iceberg -- it simply invokes the injected `onFlush` callback.
 *
 * @module iceberg/flush-handler
 */
import type { OnFlushHandler } from '../storage/parquet-store';
/**
 * Creates an `OnFlushHandler` that writes Iceberg v2 metadata to R2
 * after each ParquetStore flush.
 *
 * The handler is stateful: it keeps an in-memory copy of the Iceberg
 * table metadata and appends a new snapshot on every invocation.
 *
 * @example
 * ```ts
 * import { createIcebergFlushHandler } from '../iceberg/flush-handler'
 *
 * const store = new ParquetStore({
 *   r2: bucket,
 *   sql: sqlStorage,
 *   prefix: 'repos/abc123',
 *   onFlush: createIcebergFlushHandler(),
 * })
 * ```
 */
export declare function createIcebergFlushHandler(): OnFlushHandler;
//# sourceMappingURL=flush-handler.d.ts.map