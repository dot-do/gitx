/**
 * @fileoverview Pack Operations Subpath Barrel
 *
 * Targeted exports for Git packfile operations: format handling, index operations,
 * unpacking, and multi-index management.
 *
 * @module pack
 */

// Pack Format Operations
export {
  PACK_SIGNATURE,
  PACK_VERSION,
  PackObjectType,
  packObjectTypeToString,
  stringToPackObjectType,
  encodeVarint,
  decodeVarint,
  encodeTypeAndSize,
  decodeTypeAndSize,
  parsePackHeader,
  parsePackObject,
  createPackfile,
  type PackHeader,
  type ParsedPackObject,
  type PackableObject,
} from './format'

// Pack Index Operations
export {
  PACK_INDEX_SIGNATURE,
  PACK_INDEX_MAGIC,
  PACK_INDEX_VERSION,
  LARGE_OFFSET_THRESHOLD,
  parsePackIndex,
  createPackIndex,
  lookupObject,
  verifyPackIndex,
  serializePackIndex,
  getFanoutRange,
  calculateCRC32,
  binarySearchObjectId,
  binarySearchSha,
  parseFanoutTable,
  readPackOffset,
  type PackIndexEntry,
  type PackIndex,
  type PackIndexLookupResult,
  type CreatePackIndexOptions,
  type PackedObject,
} from './index'

// Pack Unpack Operations
export {
  unpackPackfile,
  iteratePackfile,
  computeObjectSha,
  packTypeToObjectType,
  bytesToHex,
  UNPACK_LIMITS,
  type UnpackedObject,
  type UnpackResult,
  type UnpackOptions,
  type ExternalBaseResolver,
} from './unpack'

// Pack Multi-Index Operations
export {
  MultiIndexManager,
  createMultiIndexManager,
  addPackIndexFromData,
  batchLookupAcrossManagers,
  type PackObjectLocation,
  type MultiIndexEntry,
  type IndexShard,
  type PackRegistry,
  type PackRegistryEntry,
  type MultiIndexConfig,
  type BatchLookupResult,
  type MultiIndexStats,
} from './multi-index'
