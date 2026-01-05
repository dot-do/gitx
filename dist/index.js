/**
 * gitx.do - Git implementation for Cloudflare Workers
 *
 * This module provides a complete Git implementation designed to run on
 * Cloudflare Workers with Durable Objects and R2 storage.
 *
 * @module gitx.do
 */
// =============================================================================
// Types - Core Git object types and interfaces
// =============================================================================
export { 
// Type guards
isBlob, isTree, isCommit, isTag, 
// Serialization
serializeBlob, serializeTree, serializeCommit, serializeTag, 
// Deserialization
parseBlob, parseTree, parseCommit, parseTag, } from './types/objects';
// =============================================================================
// Pack Operations - Packfile format and index handling
// =============================================================================
export { 
// Constants
PACK_SIGNATURE, PACK_VERSION, 
// Enums
PackObjectType, 
// Type conversions
packObjectTypeToString, stringToPackObjectType, 
// Variable-length encoding
encodeVarint, decodeVarint, encodeTypeAndSize, decodeTypeAndSize, 
// Pack header
parsePackHeader, parsePackObject, createPackfile, } from './pack/format';
export { 
// Constants
PACK_INDEX_SIGNATURE, PACK_INDEX_MAGIC, PACK_INDEX_VERSION, LARGE_OFFSET_THRESHOLD, 
// Main functions
parsePackIndex, createPackIndex, lookupObject, verifyPackIndex, serializePackIndex, 
// Utility functions
getFanoutRange, calculateCRC32, binarySearchObjectId, binarySearchSha, parseFanoutTable, readPackOffset, } from './pack/index';
// =============================================================================
// Git Operations - Core git commands (merge, blame, commit, branch)
// =============================================================================
// Merge operations
export { merge, findMergeBase, resolveConflict, abortMerge, continueMerge, getMergeState, isMergeInProgress, mergeContent, isBinaryFile, } from './ops/merge';
// Blame operations
export { blame, blameFile, blameLine, blameRange, getBlameForCommit, trackContentAcrossRenames, detectRenames, buildBlameHistory, formatBlame, parseBlameOutput, } from './ops/blame';
// Commit operations
export { createCommit, amendCommit, buildCommitObject, formatCommitMessage, parseCommitMessage, validateCommitMessage, isCommitSigned, extractCommitSignature, addSignatureToCommit, isEmptyCommit, getCurrentTimezone, formatTimestamp, parseTimestamp, createAuthor, } from './ops/commit';
// Branch operations
export { createBranch, deleteBranch, listBranches, renameBranch, checkoutBranch, getCurrentBranch, getBranchInfo, branchExists, setBranchTracking, getBranchTracking, removeBranchTracking, getDefaultBranch, setDefaultBranch, isValidBranchName, normalizeBranchName, } from './ops/branch';
// =============================================================================
// MCP (Model Context Protocol) - AI assistant integration
// =============================================================================
export { 
// Tool definitions
gitTools, registerTool, validateToolInput, invokeTool, listTools, getTool, } from './mcp/tools';
export { 
// Adapter
MCPAdapter, createMCPAdapter, MCPError, MCPErrorCode, } from './mcp/adapter';
// =============================================================================
// Wire Protocol - Git Smart HTTP protocol implementation
// =============================================================================
export { 
// Request handlers
handleInfoRefs, handleUploadPack, handleReceivePack, 
// Formatting
formatRefAdvertisement, formatUploadPackResponse, formatReceivePackResponse, 
// Parsing
parseUploadPackRequest, parseReceivePackRequest, parseCapabilities, capabilitiesToStrings, 
// Utilities
validateContentType, createErrorResponse, 
// Constants
CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT, CONTENT_TYPE_RECEIVE_PACK_ADVERTISEMENT, CONTENT_TYPE_UPLOAD_PACK_REQUEST, CONTENT_TYPE_UPLOAD_PACK_RESULT, CONTENT_TYPE_RECEIVE_PACK_REQUEST, CONTENT_TYPE_RECEIVE_PACK_RESULT, ZERO_SHA, } from './wire/smart-http';
export { 
// Encoding/decoding
encodePktLine, decodePktLine, encodeFlushPkt, encodeDelimPkt, pktLineStream, 
// Constants
FLUSH_PKT, DELIM_PKT, MAX_PKT_LINE_DATA, } from './wire/pkt-line';
// =============================================================================
// Storage - R2 packfile storage and object indexing
// =============================================================================
export { 
// Class
R2PackStorage, R2PackError, 
// Standalone functions
uploadPackfile, downloadPackfile, getPackfileMetadata, listPackfiles, deletePackfile, createMultiPackIndex, parseMultiPackIndex, lookupObjectInMultiPack, acquirePackLock, releasePackLock, } from './storage/r2-pack';
export { 
// Class
ObjectIndex, 
// Standalone functions
recordLocation, lookupLocation, batchLookup, getStats, } from './storage/object-index';
// =============================================================================
// Tiered Storage - Hot/Warm/Cold storage with migration
// =============================================================================
export { 
// Classes
TierMigrator, AccessTracker, MigrationError, MigrationRollback, ConcurrentAccessHandler, } from './tiered/migration';
export { 
// Class
TieredReader, TieredObjectStoreStub, } from './tiered/read-path';
//# sourceMappingURL=index.js.map