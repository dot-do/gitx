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
 *   ObjectStore, StorageBackend, CommitProvider,
 *   // Refs
 *   Ref, validateRefName, isBranchRef, isTagRef,
 *   // Pack format
 *   PackHeader, PackEntry, parseDeltaInstructions, applyDelta,
 *   // Protocol
 *   encodePktLine, parsePktLines, parseRefAdvertisements,
 * } from '@dotdo/gitx'
 * ```
 */
export { type ObjectType, type GitObject, type BlobObject, type TreeEntry, type TreeObject, type Author, type CommitObject, type TagObject, SHA_PATTERN, VALID_MODES, isValidSha, isValidObjectType, isValidMode, validateTreeEntry, validateAuthor, validateCommit, validateTag, isBlob, isTree, isCommit, isTag, serializeBlob, serializeTree, serializeCommit, serializeTag, parseBlob, parseTree, parseCommit, parseTag, } from './objects';
export { type Ref, type RefUpdateResult, type ListRefsOptions, type ValidationResult as RefValidationResult, ZERO_SHA, REF_PREFIXES, validateRefName, validateRefUpdate, assertValidRefName, isBranchRef, isTagRef, isRemoteRef, shortRefName, toBranchRef, toTagRef, parseRefLine, formatRefLine, } from './refs';
export { type PackHeader, type PackEntryType, type PackEntry, type PackIndexEntry, type PackIndex, type DeltaInstructionType, type DeltaInstruction, type ParsedDelta, PACK_SIGNATURE, PACK_IDX_SIGNATURE, PACK_TYPE_NUMBERS, PACK_NUMBER_TO_TYPE, isDeltaType, isBaseType, getPackTypeNumber, getPackEntryType, readPackSize, readDeltaOffset, readDeltaSize, parseDeltaInstructions, applyDelta, validatePackHeader, } from './pack';
export { type StoredObjectResult, type BasicObjectStore, type RefObjectStore, type TreeDiffObjectStore, type ObjectStore, type CommitProvider, type BasicCommitProvider, type CASBackend, type RefBackend, type FileBackend, type StorageBackend, type HashFunction, type CompressionProvider, type ValidationResult, type OperationResult, type WalkOptions, type FileEntry, type DiffEntry, } from './types';
export { type Capability, type RefAdvertisement, type ProtocolVersion, type UploadPackRequest, type UploadPackResponse, type ReceivePackRequest, type RefUpdate, type ReceivePackResponse, ZERO_SHA as PROTOCOL_ZERO_SHA, CAPABILITIES, SIDE_BAND, encodePktLine, flushPkt, delimPkt, responseEndPkt, parsePktLines, parsePktLine, parseCapabilities, formatCapabilities, hasCapability, getCapabilityValue, parseRefAdvertisements, formatRefAdvertisements, } from './protocol';
export { type Repository, GitBackendRepository, } from './repository';
//# sourceMappingURL=index.d.ts.map