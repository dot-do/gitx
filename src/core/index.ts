/**
 * @fileoverview @dotdo/gitx - Pure JavaScript Git Implementation
 *
 * This is the main entry point for the platform-agnostic Git core library.
 * All exports from this module are free of Cloudflare (or any platform-specific) dependencies.
 *
 * The core library can run in any JavaScript runtime:
 * - Node.js
 * - Deno
 * - Browsers
 * - Cloudflare Workers (via adapter layer)
 * - Any ES2022+ JavaScript runtime
 *
 * NOTE: Some types are aliased to avoid conflicts with other modules.
 *
 * @module @dotdo/gitx
 *
 * @example
 * ```typescript
 * import {
 *   // Object types
 *   ObjectType, GitObject, BlobObject, TreeObject, CommitObject, TagObject,
 *   // Object utilities
 *   serializeBlob, serializeTree, serializeCommit, serializeTag,
 *   parseBlob, parseTree, parseCommit, parseTag,
 *   isBlob, isTree, isCommit, isTag,
 *   // Validation
 *   isValidSha, isValidObjectType, isValidMode,
 *   // Storage interfaces
 *   CoreObjectStore, StorageBackend, CommitProvider,
 *   // Refs
 *   Ref, validateRefName, isBranchRef, isTagRef,
 *   // Pack format
 *   CorePackHeader, PackEntry, parseDeltaInstructions, applyDelta,
 *   // Protocol
 *   coreEncodePktLine, parsePktLines, parseRefAdvertisements,
 * } from '@dotdo/gitx'
 * ```
 */

// ============================================================================
// Git Object Types and Utilities
// ============================================================================

export {
  // Types
  type ObjectType,
  type GitObject,
  type BlobObject,
  type TreeEntry,
  type TreeObject,
  type Author,
  type CommitObject,
  type TagObject,

  // Constants
  SHA_PATTERN,
  VALID_MODES,

  // Validation
  isValidSha,
  isValidObjectType,
  isValidMode,
  validateTreeEntry,
  validateAuthor,
  validateCommit,
  validateTag,

  // Type Guards
  isBlob,
  isTree,
  isCommit,
  isTag,

  // Serialization
  serializeBlob,
  serializeTree,
  serializeCommit,
  serializeTag,

  // Parsing
  parseBlob,
  parseTree,
  parseCommit,
  parseTag,
} from './objects'

// ============================================================================
// Reference Types and Utilities
// ============================================================================

export {
  // Types
  type Ref,
  type RefUpdateResult,
  type ListRefsOptions,
  type ValidationResult as RefValidationResult,

  // Constants
  ZERO_SHA,
  REF_PREFIXES,

  // Validation
  validateRefName,
  validateRefUpdate,
  assertValidRefName,

  // Utilities
  isBranchRef,
  isTagRef,
  isRemoteRef,
  shortRefName,
  toBranchRef,
  toTagRef,
  parseRefLine,
  formatRefLine,
} from './refs'

// ============================================================================
// Pack Format Types and Utilities - aliased to avoid conflicts with pack/barrel.ts
// ============================================================================

export {
  // Types
  type PackHeader as CorePackHeader,
  type PackEntryType,
  type PackEntry,
  type PackIndexEntry as CorePackIndexEntry,
  type PackIndex as CorePackIndex,
  type DeltaInstructionType,
  type DeltaInstruction,
  type ParsedDelta,

  // Constants
  PACK_SIGNATURE as CORE_PACK_SIGNATURE,
  PACK_IDX_SIGNATURE,
  PACK_TYPE_NUMBERS,
  PACK_NUMBER_TO_TYPE,

  // Utilities
  isDeltaType,
  isBaseType,
  getPackTypeNumber,
  getPackEntryType,
  readPackSize,
  readDeltaOffset,
  readDeltaSize,
  parseDeltaInstructions,
  applyDelta,
  validatePackHeader,
} from './pack'

// ============================================================================
// Storage and Provider Interfaces - aliased to avoid conflicts with ops module
// ============================================================================

export {
  // Types
  type StoredObjectResult,
  type BasicObjectStore,
  type RefObjectStore,
  type TreeDiffObjectStore,
  type ObjectStore as CoreObjectStore,
  type CommitProvider,
  type BasicCommitProvider,
  type CASBackend,
  type RefBackend,
  type FileBackend,
  type StorageBackend,
  type HashFunction,
  type CompressionProvider,
  type ValidationResult as CoreValidationResult,
  type OperationResult,
  type WalkOptions,
  type FileEntry,
  type DiffEntry,
} from './types'

// ============================================================================
// Git Wire Protocol Types and Utilities - aliased to avoid conflicts with wire module
// ============================================================================

export {
  // Types
  type Capability,
  type RefAdvertisement,
  type ProtocolVersion,
  type UploadPackRequest,
  type UploadPackResponse,
  type ReceivePackRequest,
  type RefUpdate as CoreRefUpdate,
  type ReceivePackResponse,

  // Constants
  ZERO_SHA as PROTOCOL_ZERO_SHA,
  CAPABILITIES,
  SIDE_BAND,

  // Pkt-line utilities
  encodePktLine as coreEncodePktLine,
  flushPkt,
  delimPkt,
  responseEndPkt,
  parsePktLines,
  parsePktLine,

  // Capability utilities
  parseCapabilities as coreParseCapabilities,
  formatCapabilities,
  hasCapability,
  getCapabilityValue,

  // Reference advertisement utilities
  parseRefAdvertisements,
  formatRefAdvertisements,
} from './protocol'

// ============================================================================
// Repository Abstraction
// ============================================================================

export {
  type Repository,
  GitBackendRepository,
} from './repository'
