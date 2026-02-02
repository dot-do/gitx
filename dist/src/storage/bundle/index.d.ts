/**
 * @fileoverview Bundle Storage - Re-exports
 *
 * Barrel file for the R2 bundle storage module. Bundles are the primary
 * mechanism for efficiently storing multiple git objects in a single R2 object.
 *
 * @module storage/bundle
 *
 * @example
 * ```typescript
 * import {
 *   BundleWriter,
 *   R2BundleReader,
 *   BundleCompactor,
 *   BundleObjectType,
 *   createBundle,
 *   parseBundle,
 * } from './storage/bundle'
 * ```
 */
export { BUNDLE_MAGIC, BUNDLE_VERSION, BUNDLE_HEADER_SIZE, BUNDLE_INDEX_ENTRY_SIZE, MAX_BUNDLE_ENTRIES, DEFAULT_MAX_BUNDLE_SIZE, MIN_BUNDLE_SIZE, BundleObjectType, type BundleHeader, type BundleIndexEntry, type Bundle, type BundleObject, BundleFormatError, BundleCorruptedError, BundleIndexError, oidToBytes, bytesToOid, computeBundleChecksum, verifyBundleChecksum, parseBundleHeader, createBundleHeader, parseBundleIndex, createBundleIndex, lookupEntryByOid, createBundle, parseBundle, objectTypeToBundleType, bundleTypeToObjectType, } from './format';
export { BundleWriter, BundleWriterError, type BundleWriterConfig, type BundleWriteStorage, type SealedBundleMetadata, type BundleRotationEvent, type BundleWriterStats, type BundleWriterFinalResult, type RotationCallback, } from './writer';
export { InMemoryBundleReader, R2BundleReader, BundleReaderError, BundleNotFoundError, type BundleReadStorage, type BundleReaderConfig, type RangeReadResult, type BundleReaderCacheStats, } from './reader';
export { BundleCompactor, CompactionError, type CompactorStorage, type BundleCompactorConfig, type CompactionCandidate, type CompactionResult, type LiveObjectPredicate, } from './compactor';
//# sourceMappingURL=index.d.ts.map