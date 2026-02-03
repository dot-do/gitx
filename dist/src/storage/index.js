/**
 * @fileoverview Storage Subpath Barrel
 *
 * Targeted exports for storage-related modules: R2 pack storage, object
 * indexing, garbage collection, metrics, and chunked blob utilities.
 *
 * NOTE: Tiered storage exports have been moved to src/tiered/index.ts.
 * Import from 'gitx.do/tiered' for tiered storage functionality:
 *   TierMigrator, AccessTracker, MigrationError, TieredReader, etc.
 *
 * @module storage
 *
 * @example
 * ```typescript
 * import { R2PackStorage, ObjectIndex, GarbageCollector } from 'gitx.do/storage'
 * ```
 */
// R2 Pack Storage
export { R2PackStorage, R2PackError, uploadPackfile, downloadPackfile, getPackfileMetadata, listPackfiles, deletePackfile, createMultiPackIndex, parseMultiPackIndex, lookupObjectInMultiPack, acquirePackLock, releasePackLock, } from './r2-pack';
// Object Index - BatchLookupResult aliased to avoid conflict with pack/multi-index
export { ObjectIndex, recordLocation, lookupLocation, batchLookup, getStats, } from './object-index';
// Garbage Collection
export { GarbageCollector, ParquetStoreGCAdapter, createGCForParquetStore, } from './gc';
// Storage Metrics / Observability
export { NoopMetrics, ConsoleMetrics, CollectingMetrics, NOOP_METRICS, } from './metrics';
// Chunk Compaction - types aliased to avoid conflict with bundle/compactor
export { ChunkCompactor, createChunkCompactor, DEFAULT_COMPACTION_THRESHOLD, DEFAULT_MIN_BLOBS_FOR_COMPACTION, SUPER_CHUNK_PREFIX, COMPACTION_INDEX_PREFIX, getSuperChunkKey, getSuperChunkMetadataKey, getCompactionIndexKey, packSuperChunk, unpackBlob, encodeSuperChunkMetadata, decodeSuperChunkMetadata, encodeIndexEntry, decodeIndexEntry, } from './chunk-compactor';
// Chunked Blob Utilities
export { CHUNK_SIZE, CHUNKED_BLOB_PREFIX, calculateChunkCount, shouldChunk, getChunkRange, getChunkKey, getMetadataKey, getAllChunkKeys, splitIntoChunks, reassembleChunks, extractRange, } from './chunk-utils';
// Chunked Blob Storage
export { createChunkedBlobStorage, } from './chunked-blob';
//# sourceMappingURL=index.js.map