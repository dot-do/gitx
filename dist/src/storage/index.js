/**
 * @fileoverview Storage Subpath Barrel
 *
 * Targeted exports for storage-related modules: R2 pack storage, object
 * indexing, and tiered storage (migration + read-path).
 *
 * @module storage
 *
 * @example
 * ```typescript
 * import { R2PackStorage, ObjectIndex, TieredReader } from 'gitx.do/storage'
 * ```
 */
// R2 Pack Storage
export { R2PackStorage, R2PackError, uploadPackfile, downloadPackfile, getPackfileMetadata, listPackfiles, deletePackfile, createMultiPackIndex, parseMultiPackIndex, lookupObjectInMultiPack, acquirePackLock, releasePackLock, } from './r2-pack';
// Object Index
export { ObjectIndex, recordLocation, lookupLocation, batchLookup, getStats, } from './object-index';
// Tiered Storage - Migration
export { TierMigrator, AccessTracker, MigrationError, MigrationRollback, ConcurrentAccessHandler, } from '../tiered/migration';
// Tiered Storage - Read Path
export { TieredReader, TieredObjectStoreStub, } from '../tiered/read-path';
// Garbage Collection
export { GarbageCollector, ParquetStoreGCAdapter, createGCForParquetStore, } from './gc';
// Storage Metrics / Observability
export { NoopMetrics, ConsoleMetrics, CollectingMetrics, NOOP_METRICS, } from './metrics';
// Chunk Compaction
export { ChunkCompactor, createChunkCompactor, DEFAULT_COMPACTION_THRESHOLD, DEFAULT_MIN_BLOBS_FOR_COMPACTION, SUPER_CHUNK_PREFIX, COMPACTION_INDEX_PREFIX, getSuperChunkKey, getSuperChunkMetadataKey, getCompactionIndexKey, packSuperChunk, unpackBlob, encodeSuperChunkMetadata, decodeSuperChunkMetadata, encodeIndexEntry, decodeIndexEntry, } from './chunk-compactor';
// Chunked Blob Utilities
export { CHUNK_SIZE, CHUNKED_BLOB_PREFIX, calculateChunkCount, shouldChunk, getChunkRange, getChunkKey, getMetadataKey, getAllChunkKeys, splitIntoChunks, reassembleChunks, extractRange, } from './chunk-utils';
// Chunked Blob Storage
export { createChunkedBlobStorage, } from './chunked-blob';
//# sourceMappingURL=index.js.map