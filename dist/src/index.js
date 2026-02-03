/**
 * @fileoverview gitx.do - Complete Git Implementation for Cloudflare Workers
 *
 * For targeted imports use subpath exports:
 * - `gitx.do/types` - Type definitions (objects, storage, capability, interfaces)
 * - `gitx.do/core` - Core git operations
 * - `gitx.do/storage` - R2 pack storage, object index, tiered storage
 * - `gitx.do/wire` - Git Smart HTTP protocol, pkt-line, auth
 * - `gitx.do/pack` - Packfile format, index, unpacking
 * - `gitx.do/mcp` - Model Context Protocol tools
 * - `gitx.do/tiered` - Hot/Warm/Cold storage with migration
 *
 * @module gitx.do
 */
// =============================================================================
// Types - Objects, storage, capability, interfaces
// =============================================================================
export { isBlob, isTree, isCommit, isTag, SHA_PATTERN, VALID_MODES, isValidSha, isValidObjectType, isValidMode, validateTreeEntry, validateAuthor, validateCommit, validateTag, serializeBlob, serializeTree, serializeCommit, serializeTag, parseBlob, parseTree, parseCommit, parseTag, } from './types/objects';
export { validateRefName, validateRefUpdate, validateStoreParams, assertValidRefName, } from './types/storage';
export { assertValidSha } from './utils/sha-validation';
// =============================================================================
// Pack Operations - from pack/barrel.ts
// =============================================================================
export { PACK_SIGNATURE, PACK_VERSION, PackObjectType, packObjectTypeToString, stringToPackObjectType, encodeVarint, decodeVarint, encodeTypeAndSize, decodeTypeAndSize, parsePackHeader, parsePackObject, createPackfile, PACK_INDEX_SIGNATURE, PACK_INDEX_MAGIC, PACK_INDEX_VERSION, LARGE_OFFSET_THRESHOLD, parsePackIndex, createPackIndex, lookupObject, verifyPackIndex, serializePackIndex, getFanoutRange, calculateCRC32, binarySearchObjectId, binarySearchSha, parseFanoutTable, readPackOffset, unpackPackfile, iteratePackfile, computeObjectSha, packTypeToObjectType, bytesToHex, UNPACK_LIMITS, MultiIndexManager, createMultiIndexManager, addPackIndexFromData, batchLookupAcrossManagers, } from './pack/barrel';
// =============================================================================
// Git Operations - merge, blame, commit, branch
// =============================================================================
export { merge, findMergeBase, resolveConflict, abortMerge, continueMerge, getMergeState, isMergeInProgress, mergeContent, isBinaryFile, } from './ops/merge';
export { blame, blameFile, blameLine, blameRange, getBlameForCommit, trackContentAcrossRenames, detectRenames, buildBlameHistory, formatBlame, parseBlameOutput, } from './ops/blame';
export { createCommit, amendCommit, buildCommitObject, formatCommitMessage, parseCommitMessage, validateCommitMessage, isCommitSigned, extractCommitSignature, addSignatureToCommit, isEmptyCommit, getCurrentTimezone, formatTimestamp, parseTimestamp, createAuthor, } from './ops/commit';
export { createBranch, deleteBranch, listBranches, renameBranch, checkoutBranch, getCurrentBranch, getBranchInfo, branchExists, setBranchTracking, getBranchTracking, removeBranchTracking, getDefaultBranch, setDefaultBranch, isValidBranchName, normalizeBranchName, } from './ops/branch';
// =============================================================================
// MCP - from mcp/index.ts
// =============================================================================
export { createGitBindingFromContext, createGitTools, gitTools, registerTool, validateToolInput, invokeTool, listTools, getTool, MCPAdapter, createMCPAdapter, MCPError, MCPErrorCode, } from './mcp/index';
// =============================================================================
// Wire Protocol - Smart HTTP, pkt-line, auth
// =============================================================================
export { handleInfoRefs, handleUploadPack, handleReceivePack, formatRefAdvertisement, formatUploadPackResponse, formatReceivePackResponse, parseUploadPackRequest, parseReceivePackRequest, parseCapabilities, capabilitiesToStrings, validateContentType, createErrorResponse, CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT, CONTENT_TYPE_RECEIVE_PACK_ADVERTISEMENT, CONTENT_TYPE_UPLOAD_PACK_REQUEST, CONTENT_TYPE_UPLOAD_PACK_RESULT, CONTENT_TYPE_RECEIVE_PACK_REQUEST, CONTENT_TYPE_RECEIVE_PACK_RESULT, ZERO_SHA, } from './wire/smart-http';
export { encodePktLine, decodePktLine, encodeFlushPkt, encodeDelimPkt, pktLineStream, FLUSH_PKT, DELIM_PKT, MAX_PKT_LINE_DATA, } from './wire/pkt-line';
export { parseAuthorizationHeader, encodeBasicAuth, encodeBearerAuth, createUnauthorizedResponse, isAnonymous, isBasicAuth, isBearerAuth, constantTimeCompare, DEFAULT_REALM, } from './wire/auth';
export { createAuthMiddleware, MemoryAuthProvider, CallbackAuthProvider, createAuthenticatedRepositoryProvider, } from './wire/auth-middleware';
// =============================================================================
// Storage - R2 pack, object index
// =============================================================================
export { R2PackStorage, R2PackError, uploadPackfile, downloadPackfile, getPackfileMetadata, listPackfiles, deletePackfile, createMultiPackIndex, parseMultiPackIndex, lookupObjectInMultiPack, acquirePackLock, releasePackLock, } from './storage/r2-pack';
export { ObjectIndex, recordLocation, lookupLocation, batchLookup, getStats, } from './storage/object-index';
// =============================================================================
// Tiered Storage - from tiered/index.ts
// =============================================================================
export { TierMigrator, AccessTracker, MigrationError as TierMigrationError, MigrationRollback, ConcurrentAccessHandler, TieredReader, TieredObjectStoreStub, TierMigrationScheduler, createMigrationScheduler, DEFAULT_MIGRATION_CONFIG, } from './tiered/index';
// =============================================================================
// UI Components
// =============================================================================
export { default as App } from '../App.js';
export { default as Site } from '../Site.js';
// =============================================================================
// Middleware - Rate limiting
// =============================================================================
export { DEFAULT_LIMITS, MemoryRateLimitStore, DORateLimitStore, RateLimitDO, createRateLimitMiddleware, createDefaultRateLimiter, createStrictRateLimiter, createPermissiveRateLimiter, defaultKeyExtractor, createUserAwareKeyExtractor, defaultEndpointClassifier, } from './middleware/rate-limit';
// =============================================================================
// Errors - Unified error hierarchy
// =============================================================================
export { GitXError, StorageError, WireError, IcebergError, RefError, ObjectError, RPCError, MigrationError, isGitXError, isStorageError, isWireError, isIcebergError, isRefError, isObjectError, isRPCError, isMigrationError, hasErrorCode, } from './errors';
//# sourceMappingURL=index.js.map