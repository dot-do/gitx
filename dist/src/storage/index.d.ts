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
export { R2PackStorage, R2PackError, uploadPackfile, downloadPackfile, getPackfileMetadata, listPackfiles, deletePackfile, createMultiPackIndex, parseMultiPackIndex, lookupObjectInMultiPack, acquirePackLock, releasePackLock, type R2PackStorageOptions, type PackfileUploadResult, type PackfileMetadata, type DownloadPackfileOptions, type DownloadPackfileResult, type UploadPackfileOptions, type MultiPackIndexEntry, type MultiPackIndex, type PackLock, type AcquireLockOptions, type ListPackfilesResult, } from './r2-pack';
export { ObjectIndex, recordLocation, lookupLocation, batchLookup, getStats, type StorageTier, type ObjectLocation, type ObjectIndexStats, type BatchLookupResult as StorageBatchLookupResult, type RecordLocationOptions, } from './object-index';
export { GarbageCollector, ParquetStoreGCAdapter, createGCForParquetStore, type GCObjectStore, type GCRefStore, type GCOptions, type GCResult, type GCLogger, } from './gc';
export { NoopMetrics, ConsoleMetrics, CollectingMetrics, NOOP_METRICS, type StorageMetrics, type StorageTier as MetricsStorageTier, type CacheResult, type StorageOperation, type ConsoleMetricsOptions, type CollectedRead, type CollectedWrite, type CollectedCacheEvent, type CollectedFlush, type CollectedCompaction, type CollectedError, type CollectedTiming, type CollectedCounter, type CollectedGauge, } from './metrics';
export { ChunkCompactor, createChunkCompactor, DEFAULT_COMPACTION_THRESHOLD, DEFAULT_MIN_BLOBS_FOR_COMPACTION, SUPER_CHUNK_PREFIX, COMPACTION_INDEX_PREFIX, getSuperChunkKey, getSuperChunkMetadataKey, getCompactionIndexKey, packSuperChunk, unpackBlob, encodeSuperChunkMetadata, decodeSuperChunkMetadata, encodeIndexEntry, decodeIndexEntry, type ChunkCompactorConfig, type CompactionIndexEntry, type SuperChunkMetadata, type CompactionCandidate as ChunkCompactionCandidate, type CompactionResult as ChunkCompactionResult, type CompactionStats, type CompactorStorage as ChunkCompactorStorage, } from './chunk-compactor';
export { CHUNK_SIZE, CHUNKED_BLOB_PREFIX, calculateChunkCount, shouldChunk, getChunkRange, getChunkKey, getMetadataKey, getAllChunkKeys, splitIntoChunks, reassembleChunks, extractRange, type ChunkedWriteResult, type ChunkMetadata, } from './chunk-utils';
export { createChunkedBlobStorage, type ChunkedBlobStorage, type ChunkedBlobStorageBackend, } from './chunked-blob';
//# sourceMappingURL=index.d.ts.map