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
  // Object types
  type ObjectType,
  type GitObject,
  type BlobObject,
  type TreeObject,
  type TreeEntry,
  type CommitObject,
  type TagObject,
  type Author,
  // Type guards
  isBlob,
  isTree,
  isCommit,
  isTag,
  // Serialization
  serializeBlob,
  serializeTree,
  serializeCommit,
  serializeTag,
  // Deserialization
  parseBlob,
  parseTree,
  parseCommit,
  parseTag,
} from './types/objects'

// =============================================================================
// Pack Operations - Packfile format and index handling
// =============================================================================

export {
  // Constants
  PACK_SIGNATURE,
  PACK_VERSION,
  // Enums
  PackObjectType,
  // Type conversions
  packObjectTypeToString,
  stringToPackObjectType,
  // Variable-length encoding
  encodeVarint,
  decodeVarint,
  encodeTypeAndSize,
  decodeTypeAndSize,
  // Pack header
  parsePackHeader,
  parsePackObject,
  createPackfile,
  // Types
  type PackHeader,
  type ParsedPackObject,
  type PackableObject,
} from './pack/format'

export {
  // Constants
  PACK_INDEX_SIGNATURE,
  PACK_INDEX_MAGIC,
  PACK_INDEX_VERSION,
  LARGE_OFFSET_THRESHOLD,
  // Main functions
  parsePackIndex,
  createPackIndex,
  lookupObject,
  verifyPackIndex,
  serializePackIndex,
  // Utility functions
  getFanoutRange,
  calculateCRC32,
  binarySearchObjectId,
  binarySearchSha,
  parseFanoutTable,
  readPackOffset,
  // Types
  type PackIndexEntry,
  type PackIndex,
  type PackIndexLookupResult,
  type CreatePackIndexOptions,
  type PackedObject,
} from './pack/index'

// =============================================================================
// Git Operations - Core git commands (merge, blame, commit, branch)
// =============================================================================

// Merge operations
export {
  merge,
  findMergeBase,
  resolveConflict,
  abortMerge,
  continueMerge,
  getMergeState,
  isMergeInProgress,
  mergeContent,
  isBinaryFile,
  // Types
  type ConflictType,
  type MergeStrategy,
  type MergeStatus,
  type ConflictMarker,
  type MergeConflict,
  type MergeOptions,
  type MergeStats,
  type MergeResult,
  type MergeState,
  type ResolveOptions,
  type ResolveResult,
  type MergeOperationResult,
  type MergeStorage,
} from './ops/merge'

// Blame operations
export {
  blame,
  blameFile,
  blameLine,
  blameRange,
  getBlameForCommit,
  trackContentAcrossRenames,
  detectRenames,
  buildBlameHistory,
  formatBlame,
  parseBlameOutput,
  // Types
  type BlameStorage,
  type BlameOptions,
  type BlameLineInfo,
  type BlameCommitInfo,
  type BlameEntry,
  type BlameResult,
  type BlameFormatOptions,
  type PathHistoryEntry,
  type BlameHistoryEntry,
} from './ops/blame'

// Commit operations
export {
  createCommit,
  amendCommit,
  buildCommitObject,
  formatCommitMessage,
  parseCommitMessage,
  validateCommitMessage,
  isCommitSigned,
  extractCommitSignature,
  addSignatureToCommit,
  isEmptyCommit,
  getCurrentTimezone,
  formatTimestamp,
  parseTimestamp,
  createAuthor,
  // Types
  type CommitAuthor,
  type SigningOptions,
  type CommitOptions,
  type AmendOptions,
  type FormatOptions,
  type CommitResult,
  type ObjectStore,
} from './ops/commit'

// Branch operations
export {
  createBranch,
  deleteBranch,
  listBranches,
  renameBranch,
  checkoutBranch,
  getCurrentBranch,
  getBranchInfo,
  branchExists,
  setBranchTracking,
  getBranchTracking,
  removeBranchTracking,
  getDefaultBranch,
  setDefaultBranch,
  isValidBranchName,
  normalizeBranchName,
  // Types
  type RefStore,
  type BranchOptions,
  type BranchCreateResult,
  type BranchDeleteOptions,
  type BranchDeleteResult,
  type BranchListOptions,
  type BranchInfo,
  type TrackingInfo,
  type BranchRenameOptions,
  type BranchRenameResult,
  type CheckoutOptions,
  type CheckoutResult,
  type SetTrackingResult,
  type RemoveTrackingResult,
} from './ops/branch'

// =============================================================================
// MCP (Model Context Protocol) - AI assistant integration
// =============================================================================

export {
  // Tool definitions
  gitTools,
  registerTool,
  validateToolInput,
  invokeTool,
  listTools,
  getTool,
  // Types
  type JSONSchema,
  type MCPToolResult,
  type MCPToolHandler,
  type MCPTool,
} from './mcp/tools'

export {
  // Adapter
  MCPAdapter,
  createMCPAdapter,
  MCPError,
  MCPErrorCode,
  // Types
  type MCPCapability,
  type MCPServerConfig,
  type MCPRequest,
  type MCPResponse,
  type MCPToolInfo,
  type MCPResourceInfo,
  type MCPPromptArgument,
  type MCPPromptInfo,
} from './mcp/adapter'

// =============================================================================
// Wire Protocol - Git Smart HTTP protocol implementation
// =============================================================================

export {
  // Request handlers
  handleInfoRefs,
  handleUploadPack,
  handleReceivePack,
  // Formatting
  formatRefAdvertisement,
  formatUploadPackResponse,
  formatReceivePackResponse,
  // Parsing
  parseUploadPackRequest,
  parseReceivePackRequest,
  parseCapabilities,
  capabilitiesToStrings,
  // Utilities
  validateContentType,
  createErrorResponse,
  // Constants
  CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT,
  CONTENT_TYPE_RECEIVE_PACK_ADVERTISEMENT,
  CONTENT_TYPE_UPLOAD_PACK_REQUEST,
  CONTENT_TYPE_UPLOAD_PACK_RESULT,
  CONTENT_TYPE_RECEIVE_PACK_REQUEST,
  CONTENT_TYPE_RECEIVE_PACK_RESULT,
  ZERO_SHA,
  // Types
  type GitService,
  type HTTPMethod,
  type GitRef,
  type ServerCapabilities,
  type SmartHTTPRequest,
  type SmartHTTPResponse,
  type SmartHTTPError,
  type RepositoryProvider,
  type RefUpdateCommand,
  type ReceivePackResult,
} from './wire/smart-http'

export {
  // Encoding/decoding
  encodePktLine,
  decodePktLine,
  encodeFlushPkt,
  encodeDelimPkt,
  pktLineStream,
  // Constants
  FLUSH_PKT,
  DELIM_PKT,
  MAX_PKT_LINE_DATA,
} from './wire/pkt-line'

// =============================================================================
// Storage - R2 packfile storage and object indexing
// =============================================================================

export {
  // Class
  R2PackStorage,
  R2PackError,
  // Standalone functions
  uploadPackfile,
  downloadPackfile,
  getPackfileMetadata,
  listPackfiles,
  deletePackfile,
  createMultiPackIndex,
  parseMultiPackIndex,
  lookupObjectInMultiPack,
  acquirePackLock,
  releasePackLock,
  // Types
  type R2PackStorageOptions,
  type PackfileUploadResult,
  type PackfileMetadata,
  type DownloadPackfileOptions,
  type DownloadPackfileResult,
  type UploadPackfileOptions,
  type MultiPackIndexEntry,
  type MultiPackIndex,
  type PackLock,
  type AcquireLockOptions,
  type ListPackfilesResult,
} from './storage/r2-pack'

export {
  // Class
  ObjectIndex,
  // Standalone functions
  recordLocation,
  lookupLocation,
  batchLookup,
  getStats,
  // Types
  type StorageTier,
  type ObjectLocation,
  type ObjectIndexStats,
  type BatchLookupResult,
  type RecordLocationOptions,
} from './storage/object-index'

// =============================================================================
// Tiered Storage - Hot/Warm/Cold storage with migration
// =============================================================================

export {
  // Classes
  TierMigrator,
  AccessTracker,
  MigrationError,
  MigrationRollback,
  ConcurrentAccessHandler,
  // Types
  type MigrationPolicy,
  type MigrationState,
  type MigrationProgress,
  type MigrationJob,
  type MigrationResult,
  type BatchMigrationResult,
  type BatchMigrationOptions,
  type MigrateOptions,
  type MigrationHistoryEntry,
  type AccessPattern,
  type AccessStats,
  type ObjectIdentificationCriteria,
  type DecayOptions,
  type AccessMetrics,
} from './tiered/migration'

export {
  // Class
  TieredReader,
  TieredObjectStoreStub,
  // Types
  type StoredObject,
  type TierConfig,
  type TieredStorageConfig,
  type ReadResult,
  type TieredObjectStore,
  type HotTierBackend,
  type WarmTierBackend,
  type ColdTierBackend,
} from './tiered/read-path'
