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

// Format: constants, types, binary encoding/decoding
export {
  // Constants
  BUNDLE_MAGIC,
  BUNDLE_VERSION,
  BUNDLE_HEADER_SIZE,
  BUNDLE_INDEX_ENTRY_SIZE,
  MAX_BUNDLE_ENTRIES,
  DEFAULT_MAX_BUNDLE_SIZE,
  MIN_BUNDLE_SIZE,

  // Enums
  BundleObjectType,

  // Types
  type BundleHeader,
  type BundleIndexEntry,
  type Bundle,
  type BundleObject,

  // Error classes
  BundleFormatError,
  BundleCorruptedError,
  BundleIndexError,

  // OID helpers
  oidToBytes,
  bytesToOid,

  // Checksum
  computeBundleChecksum,
  verifyBundleChecksum,

  // Header
  parseBundleHeader,
  createBundleHeader,

  // Index
  parseBundleIndex,
  createBundleIndex,
  lookupEntryByOid,

  // Bundle assembly
  createBundle,
  parseBundle,

  // Type converters
  objectTypeToBundleType,
  bundleTypeToObjectType,
} from './format'

// Writer: buffered writes, rotation, sealing
export {
  BundleWriter,
  BundleWriterError,
  type BundleWriterConfig,
  type BundleWriteStorage,
  type SealedBundleMetadata,
  type BundleRotationEvent,
  type BundleWriterStats,
  type BundleWriterFinalResult,
  type RotationCallback,
} from './writer'

// Reader: index lookup, LRU cache, R2 range reads
export {
  InMemoryBundleReader,
  R2BundleReader,
  BundleReaderError,
  BundleNotFoundError,
  type BundleReadStorage,
  type BundleReaderConfig,
  type RangeReadResult,
  type BundleReaderCacheStats,
} from './reader'

// Compactor: merge, defragment
export {
  BundleCompactor,
  CompactionError,
  type CompactorStorage,
  type BundleCompactorConfig,
  type CompactionCandidate,
  type CompactionResult,
  type LiveObjectPredicate,
} from './compactor'
