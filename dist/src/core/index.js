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
// ============================================================================
// Git Object Types and Utilities
// ============================================================================
export { 
// Constants
SHA_PATTERN, VALID_MODES, 
// Validation
isValidSha, isValidObjectType, isValidMode, validateTreeEntry, validateAuthor, validateCommit, validateTag, 
// Type Guards
isBlob, isTree, isCommit, isTag, 
// Serialization
serializeBlob, serializeTree, serializeCommit, serializeTag, 
// Parsing
parseBlob, parseTree, parseCommit, parseTag, } from './objects';
// ============================================================================
// Reference Types and Utilities
// ============================================================================
export { 
// Constants
ZERO_SHA, REF_PREFIXES, 
// Validation
validateRefName, validateRefUpdate, assertValidRefName, 
// Utilities
isBranchRef, isTagRef, isRemoteRef, shortRefName, toBranchRef, toTagRef, parseRefLine, formatRefLine, } from './refs';
// ============================================================================
// Pack Format Types and Utilities
// ============================================================================
export { 
// Constants
PACK_SIGNATURE, PACK_IDX_SIGNATURE, PACK_TYPE_NUMBERS, PACK_NUMBER_TO_TYPE, 
// Utilities
isDeltaType, isBaseType, getPackTypeNumber, getPackEntryType, readPackSize, readDeltaOffset, readDeltaSize, parseDeltaInstructions, applyDelta, validatePackHeader, } from './pack';
// ============================================================================
// Git Wire Protocol Types and Utilities
// ============================================================================
export { 
// Constants
ZERO_SHA as PROTOCOL_ZERO_SHA, CAPABILITIES, SIDE_BAND, 
// Pkt-line utilities
encodePktLine, flushPkt, delimPkt, responseEndPkt, parsePktLines, parsePktLine, 
// Capability utilities
parseCapabilities, formatCapabilities, hasCapability, getCapabilityValue, 
// Reference advertisement utilities
parseRefAdvertisements, formatRefAdvertisements, } from './protocol';
//# sourceMappingURL=index.js.map