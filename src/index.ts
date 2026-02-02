/**
 * @fileoverview gitx.do - Complete Git Implementation for Cloudflare Workers
 *
 * This is the main entry point for the gitx.do library, providing a complete
 * Git implementation designed to run on Cloudflare Workers with Durable Objects
 * and R2 storage.
 *
 * **Architecture Overview**:
 * - **Types**: Core Git object types (blob, tree, commit, tag)
 * - **Pack Operations**: Packfile format handling and index management
 * - **Git Operations**: Core commands (merge, blame, commit, branch)
 * - **MCP Integration**: Model Context Protocol for AI assistant integration
 * - **Wire Protocol**: Git Smart HTTP protocol implementation
 * - **Storage**: R2 packfile storage and object indexing
 * - **Tiered Storage**: Hot/Warm/Cold storage with migration
 *
 * @module gitx.do
 *
 * Subpath imports are available for targeted usage without pulling in the
 * entire barrel:
 *
 *   - `gitx.do/types`    - Type definitions (objects, storage, capability, interfaces)
 *   - `gitx.do/core`     - Core git operations (merge, blame, commit, branch)
 *   - `gitx.do/storage`  - R2 pack storage, object index, tiered storage
 *   - `gitx.do/wire`     - Git Smart HTTP protocol, pkt-line, auth
 *   - `gitx.do/delta`    - Delta transaction log (ref-log, branching, merging)
 *   - `gitx.do/iceberg`  - Iceberg v2 metadata generation
 *
 * @example
 * ```typescript
 * // Full barrel import (backward compatible)
 * import {
 *   // Types
 *   type CommitObject,
 *   parseCommit,
 *   serializeCommit,
 *
 *   // Operations
 *   createCommit,
 *   merge,
 *   blame,
 *
 *   // Storage
 *   R2PackStorage,
 *   ObjectIndex,
 *
 *   // Wire Protocol
 *   handleInfoRefs,
 *   handleUploadPack,
 * } from 'gitx.do'
 *
 * // Or use targeted subpath imports
 * import { R2PackStorage, ObjectIndex } from 'gitx.do/storage'
 * import { handleInfoRefs, handleUploadPack } from 'gitx.do/wire'
 * import { merge, createCommit } from 'gitx.do/core'
 *
 * // Create a commit
 * const commit = await createCommit(storage, {
 *   tree: treeSha,
 *   parents: [parentSha],
 *   message: 'Add new feature',
 *   author: { name: 'Alice', email: 'alice@example.com.ai' }
 * })
 * ```
 */

// =============================================================================
// Shared Types from @dotdo/types - For cross-package interoperability
// =============================================================================

/**
 * Re-exported types from @dotdo/types/fn for interoperability with other
 * packages in the @dotdo ecosystem. These types provide a standardized
 * interface for git operations across different packages.
 *
 * Note: gitx.do has its own type definitions (exported below) that are
 * optimized for Durable Object integration. Use the shared types when
 * interoperating with other @dotdo packages, and the gitx-specific types
 * for internal gitx.do usage.
 *
 * @example
 * ```typescript
 * import type {
 *   // Shared types for interop
 *   SharedGitStatus,
 *   SharedMergeResult,
 *   SharedDiffResult,
 *   // gitx-specific types
 *   GitStatus,
 *   MergeResult,
 *   DiffResult,
 * } from 'gitx.do'
 * ```
 */
export type {
  GitStatus as SharedGitStatus,
  StatusFile as SharedStatusFile,
  GitRef as SharedGitRef,
  GitAuthor as SharedGitAuthor,
  CommitObject as SharedCommitObject,
  MergeResult as SharedMergeResult,
  DiffResult as SharedDiffResult,
  DiffFile as SharedDiffFile,
  DiffHunk as SharedDiffHunk,
  DiffLine as SharedDiffLine,
  Branch as SharedBranch,
  Tag as SharedTag,
  PushResult as SharedPushResult,
  FetchResult as SharedFetchResult,
  // Option types
  GitInitOptions as SharedGitInitOptions,
  GitCloneOptions as SharedGitCloneOptions,
  GitCommitOptions as SharedGitCommitOptions,
  GitLogOptions as SharedGitLogOptions,
  GitCheckoutOptions as SharedGitCheckoutOptions,
  GitMergeOptions as SharedGitMergeOptions,
  GitPushOptions as SharedGitPushOptions,
  GitPullOptions as SharedGitPullOptions,
  GitDiffOptions as SharedGitDiffOptions,
  GitStashOptions as SharedGitStashOptions,
  GitFetchOptions as SharedGitFetchOptions,
  GitRebaseOptions as SharedGitRebaseOptions,
  GitTagOptions as SharedGitTagOptions,
  GitRemoteOptions as SharedGitRemoteOptions,
} from '@dotdo/types/fn'

// =============================================================================
// Types - Core Git object types and interfaces
// =============================================================================

/**
 * Git object types and serialization.
 *
 * @description
 * Core types for Git objects (blob, tree, commit, tag) including:
 * - Type definitions for each object type
 * - Type guard functions for runtime type checking
 * - Serialization functions for converting to Git format
 * - Deserialization functions for parsing Git format
 *
 * @example
 * ```typescript
 * import { isCommit, parseCommit, serializeCommit } from 'gitx.do'
 *
 * // Parse raw commit data
 * const commit = parseCommit(rawData)
 *
 * // Check type at runtime
 * if (isCommit(obj)) {
 *   console.log(obj.message)
 * }
 * ```
 */
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
  // Validation constants
  SHA_PATTERN,
  VALID_MODES,
  // Validation functions
  isValidSha,
  isValidObjectType,
  isValidMode,
  validateTreeEntry,
  validateAuthor,
  validateCommit,
  validateTag,
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

/**
 * Storage interface types and validation.
 *
 * @description
 * Core storage interfaces for Git object stores and commit providers:
 * - {@link ObjectStore}: Full-featured object storage with refs
 * - {@link BasicObjectStore}: Minimal object CRUD
 * - {@link RefObjectStore}: Object store with ref management
 * - {@link TreeDiffObjectStore}: Specialized for tree operations
 * - {@link CommitProvider}: Commit retrieval interface
 * - {@link BasicCommitProvider}: Minimal commit access
 *
 * Plus validation helpers for storage operations.
 *
 * @example
 * ```typescript
 * import {
 *   type ObjectStore,
 *   validateRefName,
 *   assertValidSha
 * } from 'gitx.do'
 *
 * // Validate before storing
 * assertValidSha(treeSha, 'tree')
 * const refResult = validateRefName('refs/heads/main')
 * ```
 */
export {
  // Validation result type
  type ValidationResult,
  // Validation functions
  validateRefName,
  validateRefUpdate,
  validateStoreParams,
  assertValidRefName,
  // Storage interfaces
  type ObjectStore as StorageObjectStore,
  type BasicObjectStore,
  type RefObjectStore,
  type TreeDiffObjectStore,
  type CommitProvider,
  type BasicCommitProvider,
} from './types/storage'

// Re-export assertValidSha from sha-validation module
export { assertValidSha } from './utils/sha-validation'

/**
 * GitCapability types for DO integration.
 *
 * @description
 * TypeScript interfaces for the git capability, designed for integration
 * with Durable Objects as the $.git proxy. Provides type definitions for:
 * - Repository operations: clone, init, fetch, pull, push
 * - Working tree operations: add, commit, status, log, diff
 * - Branch operations: branch, checkout, merge
 * - Low-level operations: resolveRef, readObject
 *
 * @example
 * ```typescript
 * import type { GitCapability, GitStatus, Commit } from 'gitx.do'
 *
 * // Type your $.git proxy
 * class MyDO {
 *   git: GitCapability = this.$.git
 *
 *   async createFeature(name: string): Promise<Commit> {
 *     await this.git.checkout({ branch: `feature/${name}`, create: true })
 *     await this.git.add({ all: true })
 *     return await this.git.commit({ message: `feat: ${name}` })
 *   }
 * }
 * ```
 */
export {
  // Core types
  type SHA,
  type RefName,
  // Git objects
  type Commit as CapabilityCommit,
  type RawGitObject,
  type GitRef as CapabilityGitRef,
  type Branch,
  type Tag,
  // Status types
  type FileStatus,
  type GitStatus,
  // Diff types
  type DiffHunk,
  type FileDiff,
  type DiffResult,
  // Operation options
  type CloneOptions,
  type InitOptions,
  type FetchOptions,
  type PullOptions,
  type PushOptions,
  type AddOptions,
  type CommitOptions as CapabilityCommitOptions,
  type StatusOptions,
  type LogOptions,
  type DiffOptions,
  type BranchOptions as CapabilityBranchOptions,
  type CheckoutOptions as CapabilityCheckoutOptions,
  type MergeOptions as CapabilityMergeOptions,
  // Authentication
  type AuthOptions as CapabilityAuthOptions,
  // Callbacks and progress
  type ProgressCallback,
  type ProgressEvent,
  // Results
  type MergeResult as CapabilityMergeResult,
  type PushResult as CapabilityPushResult,
  type FetchResult,
  // Main capability interface
  type GitCapability,
  // Utility types
  type TreePathResult,
  type Remote,
} from './types/capability'

/**
 * Consolidated interface types for DO integration.
 *
 * @description
 * Common interface types used across the gitx.do codebase, including:
 * - SQL storage interfaces
 * - R2 bucket types
 * - KV namespace types
 * - Durable Object types
 * - Workflow context interfaces
 * - Module interfaces
 *
 * @example
 * ```typescript
 * import type { SqlStorage, R2BucketLike, WorkflowContext } from 'gitx.do'
 *
 * class MyDO {
 *   private storage: SqlStorage
 *   private r2: R2BucketLike
 *
 *   constructor(state: DurableObjectState) {
 *     this.storage = state.storage
 *   }
 * }
 * ```
 */
export {
  // SQL storage
  type SqlResult,
  type SqlExec,
  type SqlStorage,
  // R2 storage
  type R2ObjectLike,
  type R2ObjectsLike,
  type R2PutOptions,
  type R2BucketLike,
  // KV storage
  type KVNamespaceLike,
  // Durable Objects
  type DurableObjectId,
  type DurableObjectStub,
  type DurableObjectNamespace,
  type DurableObjectState,
  // Workflow context
  type EventHandlerProxy,
  type ScheduleProxy,
  type WorkflowContext,
  type ActionResult,
  // Modules
  type Module,
  type StorageBackedModule,
  type WithCapability,
  // Errors
  type GitxError,
  type StorageError as InterfaceStorageError,
  type R2Error,
  type GitError,
} from './types/interfaces'

// =============================================================================
// Pack Operations - Packfile format and index handling
// =============================================================================

/**
 * Packfile format handling.
 *
 * @description
 * Functions for reading and writing Git packfiles including:
 * - Pack header parsing and creation
 * - Variable-length integer encoding/decoding
 * - Object type and size encoding
 *
 * @example
 * ```typescript
 * import { createPackfile, parsePackHeader } from 'gitx.do'
 *
 * // Create a packfile from objects
 * const packData = await createPackfile(objects)
 *
 * // Parse pack header
 * const header = parsePackHeader(packData)
 * console.log(`Pack contains ${header.objectCount} objects`)
 * ```
 */
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

/**
 * Pack index operations.
 *
 * @description
 * Functions for reading and writing pack index files (.idx) including:
 * - Index parsing and creation
 * - Object lookup by SHA
 * - CRC32 calculation for verification
 *
 * @example
 * ```typescript
 * import { createPackIndex, lookupObject } from 'gitx.do'
 *
 * // Create index for a packfile
 * const index = await createPackIndex(packData)
 *
 * // Look up an object
 * const result = lookupObject(index, sha)
 * if (result) {
 *   console.log(`Object at offset ${result.offset}`)
 * }
 * ```
 */
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

/**
 * Pack unpacking operations.
 *
 * @description
 * Functions for extracting objects from Git packfiles:
 * - Full packfile unpacking with delta resolution
 * - Memory-efficient streaming iteration
 * - Support for thin packs with external base resolution
 *
 * @example
 * ```typescript
 * import { unpackPackfile, iteratePackfile } from 'gitx.do'
 *
 * // Unpack entire packfile
 * const result = await unpackPackfile(packData)
 * for (const obj of result.objects) {
 *   console.log(`${obj.sha}: ${obj.type}`)
 * }
 *
 * // Stream objects for large packs
 * for await (const obj of iteratePackfile(packData)) {
 *   await store.putObject(obj.type, obj.data)
 * }
 * ```
 */
export {
  unpackPackfile,
  iteratePackfile,
  computeObjectSha,
  packTypeToObjectType,
  bytesToHex,
  type UnpackedObject,
  type UnpackResult,
  type UnpackOptions,
  type ExternalBaseResolver,
} from './pack/unpack'

/**
 * Pack multi-index operations.
 *
 * @description
 * Functions for managing multiple pack indices for improved scalability:
 * - Incremental index updates without full rebuilds
 * - Sharded indices for memory efficiency
 * - Batch lookups across multiple packs
 * - Fanout tables for O(1) range narrowing
 *
 * @example
 * ```typescript
 * import { MultiIndexManager, createMultiIndexManager } from 'gitx.do'
 *
 * // Create a multi-index manager
 * const manager = createMultiIndexManager({ shardCount: 16 })
 *
 * // Add pack indices
 * manager.addPackIndex(packId, entries)
 *
 * // Lookup objects
 * const location = manager.lookupObject(sha)
 * if (location) {
 *   console.log(`Found in ${location.packId} at offset ${location.offset}`)
 * }
 *
 * // Batch lookup
 * const result = manager.batchLookup(shas)
 * ```
 */
export {
  MultiIndexManager,
  createMultiIndexManager,
  addPackIndexFromData,
  batchLookupAcrossManagers,
  // Types
  type PackObjectLocation,
  type MultiIndexEntry,
  type IndexShard,
  type PackRegistry,
  type PackRegistryEntry,
  type MultiIndexConfig,
  type BatchLookupResult as MultiIndexBatchLookupResult,
  type MultiIndexStats,
} from './pack/multi-index'

// =============================================================================
// Git Operations - Core git commands (merge, blame, commit, branch)
// =============================================================================

/**
 * Merge operations.
 *
 * @description
 * Functions for performing Git merges including:
 * - Three-way merge algorithm
 * - Merge base finding
 * - Conflict detection and resolution
 * - Content merging for text files
 *
 * @example
 * ```typescript
 * import { merge, findMergeBase, resolveConflict } from 'gitx.do'
 *
 * // Find merge base
 * const base = await findMergeBase(storage, commit1, commit2)
 *
 * // Perform merge
 * const result = await merge(storage, {
 *   ours: 'main',
 *   theirs: 'feature',
 *   strategy: 'recursive'
 * })
 *
 * if (result.conflicts.length > 0) {
 *   // Handle conflicts
 * }
 * ```
 */
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

/**
 * Blame operations.
 *
 * @description
 * Functions for git blame functionality including:
 * - Line-by-line attribution
 * - Rename tracking across history
 * - Range-based blame
 * - Blame output formatting
 *
 * @example
 * ```typescript
 * import { blame, blameFile, formatBlame } from 'gitx.do'
 *
 * // Get blame for a file
 * const result = await blameFile(storage, 'src/index.ts', { commit: 'HEAD' })
 *
 * // Format for display
 * const output = formatBlame(result, { showEmail: true })
 * ```
 */
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

/**
 * Commit operations.
 *
 * @description
 * Functions for creating and working with commits including:
 * - Commit creation and amendment
 * - Commit message formatting and validation
 * - Signature handling (GPG)
 * - Author/timestamp utilities
 *
 * @example
 * ```typescript
 * import { createCommit, createAuthor, formatTimestamp } from 'gitx.do'
 *
 * const author = createAuthor('Alice', 'alice@example.com.ai')
 * const commit = await createCommit(storage, {
 *   tree: treeSha,
 *   parents: [parentSha],
 *   author,
 *   message: 'Add new feature'
 * })
 * ```
 */
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

/**
 * Branch operations.
 *
 * @description
 * Functions for branch management including:
 * - Branch creation, deletion, and renaming
 * - Branch listing and filtering
 * - Upstream tracking configuration
 * - Branch validation
 *
 * @example
 * ```typescript
 * import { createBranch, listBranches, getCurrentBranch } from 'gitx.do'
 *
 * // Create a new branch
 * await createBranch(storage, 'feature/new-thing', { startPoint: 'main' })
 *
 * // List all branches
 * const branches = await listBranches(storage, { includeRemotes: true })
 *
 * // Get current branch
 * const current = await getCurrentBranch(storage)
 * ```
 */
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

/**
 * MCP tool definitions.
 *
 * @description
 * Tools for integrating with AI assistants via MCP including:
 * - Tool registration and discovery
 * - Input validation
 * - Tool invocation
 *
 * @example
 * ```typescript
 * import { gitTools, invokeTool, validateToolInput } from 'gitx.do'
 *
 * // List available tools
 * const tools = gitTools
 *
 * // Validate and invoke a tool
 * if (validateToolInput('git_status', input)) {
 *   const result = await invokeTool('git_status', input, context)
 * }
 * ```
 */
export {
  // New search/fetch/do tools
  createGitBindingFromContext,
  createGitTools,
  type GitBinding,
  // Legacy tool definitions (backward compat)
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

/**
 * MCP adapter.
 *
 * @description
 * Adapter for MCP protocol communication including:
 * - Request/response handling
 * - Capability negotiation
 * - Error handling
 *
 * @example
 * ```typescript
 * import { createMCPAdapter, MCPError, MCPErrorCode } from 'gitx.do'
 *
 * const adapter = createMCPAdapter({
 *   name: 'gitx.do',
 *   version: '1.0.0'
 * })
 *
 * const response = await adapter.handleRequest(request)
 * ```
 */
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

/**
 * Smart HTTP protocol handlers.
 *
 * @description
 * Functions for handling Git Smart HTTP protocol including:
 * - Info/refs endpoint handling
 * - Upload-pack (fetch/clone)
 * - Receive-pack (push)
 * - Capability negotiation
 *
 * @example
 * ```typescript
 * import { handleInfoRefs, handleUploadPack, handleReceivePack } from 'gitx.do'
 *
 * // Handle info/refs request
 * const refs = await handleInfoRefs(request, { service: 'git-upload-pack' })
 *
 * // Handle fetch request
 * const pack = await handleUploadPack(request, storage)
 * ```
 */
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

/**
 * Pkt-line encoding/decoding.
 *
 * @description
 * Functions for Git pkt-line format handling including:
 * - Line encoding/decoding
 * - Flush and delimiter packets
 * - Stream processing
 *
 * @example
 * ```typescript
 * import { encodePktLine, decodePktLine, FLUSH_PKT } from 'gitx.do'
 *
 * // Encode a line
 * const encoded = encodePktLine('want abc123')
 *
 * // Decode a line
 * const { line, remaining } = decodePktLine(data)
 * ```
 */
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

/**
 * Git HTTP Authentication.
 *
 * @description
 * Authentication layer for Git HTTP protocol operations (push/pull) including:
 * - Basic authentication (username/password or token)
 * - Bearer token authentication
 * - Credential parsing and encoding
 * - Authentication middleware
 *
 * @example
 * ```typescript
 * import {
 *   createAuthMiddleware,
 *   MemoryAuthProvider,
 *   parseAuthorizationHeader,
 *   encodeBasicAuth
 * } from 'gitx.do'
 *
 * // Create an auth provider
 * const provider = new MemoryAuthProvider({
 *   users: {
 *     'alice': { password: 'secret', scopes: ['repo:read', 'repo:write'] }
 *   }
 * })
 *
 * // Create middleware
 * const auth = createAuthMiddleware(provider)
 *
 * // Authenticate a request
 * const result = await auth.authenticate(request)
 * if (!result.authenticated) {
 *   return new Response('Unauthorized', { status: 401 })
 * }
 * ```
 */
export {
  // Credential parsing/encoding
  parseAuthorizationHeader,
  encodeBasicAuth,
  encodeBearerAuth,
  // Response helpers
  createUnauthorizedResponse,
  // Type guards
  isAnonymous,
  isBasicAuth,
  isBearerAuth,
  // Utilities
  constantTimeCompare,
  // Constants
  DEFAULT_REALM,
  // Types
  type AuthType,
  type BasicCredentials,
  type BearerCredentials,
  type AnonymousCredentials,
  type Credentials,
  type AuthContext,
  type AuthResult,
  type AuthenticatedUser,
  type AuthProvider,
  type AuthOptions,
} from './wire/auth'

/**
 * Git HTTP Authentication Middleware.
 *
 * @description
 * Middleware for authenticating Git HTTP protocol requests including:
 * - Request-level authentication
 * - Integration with RepositoryProvider
 * - Built-in auth providers (memory, callback)
 *
 * @example
 * ```typescript
 * import {
 *   createAuthMiddleware,
 *   MemoryAuthProvider,
 *   CallbackAuthProvider,
 *   createAuthenticatedRepositoryProvider
 * } from 'gitx.do'
 *
 * // Memory-based provider for development
 * const memProvider = new MemoryAuthProvider({
 *   users: { 'user': { password: 'pass', scopes: ['repo:read'] } },
 *   tokens: { 'token123': { scopes: ['repo:read', 'repo:write'] } }
 * })
 *
 * // Callback-based provider for production
 * const callbackProvider = new CallbackAuthProvider({
 *   validateBasic: async (username, password, context) => {
 *     const valid = await checkCredentials(username, password)
 *     return { valid, user: valid ? { id: username } : undefined }
 *   }
 * })
 *
 * // Wrap repository with auth context
 * const authedRepo = createAuthenticatedRepositoryProvider(
 *   repository,
 *   authResult.user,
 *   authResult.scopes
 * )
 * ```
 */
export {
  // Middleware factory
  createAuthMiddleware,
  // Built-in providers
  MemoryAuthProvider,
  CallbackAuthProvider,
  // Repository wrapper
  createAuthenticatedRepositoryProvider,
  // Types
  type AuthMiddleware,
  type AuthenticationResult,
  type MemoryAuthProviderConfig,
} from './wire/auth-middleware'

// =============================================================================
// Storage - R2 packfile storage and object indexing
// =============================================================================

/**
 * R2 pack storage.
 *
 * @description
 * Functions for storing packfiles in Cloudflare R2 including:
 * - Packfile upload/download
 * - Multi-pack index management
 * - Pack locking for concurrent access
 *
 * @example
 * ```typescript
 * import { R2PackStorage, uploadPackfile, listPackfiles } from 'gitx.do'
 *
 * const storage = new R2PackStorage(r2Bucket, { prefix: 'git/packs' })
 *
 * // Upload a packfile
 * const result = await uploadPackfile(storage, packData, { withIndex: true })
 *
 * // List all packfiles
 * const packs = await listPackfiles(storage)
 * ```
 */
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

/**
 * Object index.
 *
 * @description
 * Functions for tracking object locations across storage tiers including:
 * - Location recording and lookup
 * - Batch operations
 * - Statistics
 *
 * @example
 * ```typescript
 * import { ObjectIndex, recordLocation, lookupLocation } from 'gitx.do'
 *
 * const index = new ObjectIndex(storage)
 *
 * // Record object location
 * await recordLocation(index, sha, { tier: 'hot', location: 'local' })
 *
 * // Look up location
 * const location = await lookupLocation(index, sha)
 * ```
 */
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

/**
 * Tier migration.
 *
 * @description
 * Functions for managing object migration between storage tiers including:
 * - Migration policies
 * - Access tracking
 * - Concurrent access handling
 *
 * @example
 * ```typescript
 * import { TierMigrator, AccessTracker } from 'gitx.do'
 *
 * const tracker = new AccessTracker(storage)
 * await tracker.recordAccess(sha)
 *
 * const migrator = new TierMigrator(storage, { policy: 'lru' })
 * await migrator.migrate(sha, 'hot', 'warm')
 * ```
 */
export {
  // Classes
  TierMigrator,
  AccessTracker,
  MigrationError as TierMigrationError,
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

/**
 * Tiered read path.
 *
 * @description
 * Functions for reading objects across storage tiers including:
 * - Automatic tier traversal
 * - Caching strategies
 * - Read optimization
 *
 * @example
 * ```typescript
 * import { TieredReader, type TieredStorageConfig } from 'gitx.do'
 *
 * const config: TieredStorageConfig = {
 *   hot: { backend: hotBackend, maxSize: 1_000_000 },
 *   warm: { backend: warmBackend },
 *   cold: { backend: coldBackend }
 * }
 *
 * const reader = new TieredReader(config)
 * const result = await reader.read(sha)
 * ```
 */
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

/**
 * Background tier migration with DO alarms.
 *
 * @description
 * Functions for background tier migration using Durable Object alarms:
 * - Schedule migration cycles via DO alarms
 * - Migrate objects from hot to warm to cold based on access patterns
 * - Exponential backoff on failures
 * - Persistent state tracking
 *
 * @example
 * ```typescript
 * import {
 *   TierMigrationScheduler,
 *   createMigrationScheduler,
 *   DEFAULT_MIGRATION_CONFIG
 * } from 'gitx.do'
 *
 * // Create scheduler
 * const scheduler = createMigrationScheduler(storage, tieredStorage, {
 *   hotToWarmAgeMs: 24 * 60 * 60 * 1000,  // 24 hours
 *   batchSize: 50
 * })
 *
 * // Schedule background migration
 * await scheduler.scheduleBackgroundMigration()
 *
 * // In alarm handler
 * await scheduler.runMigrationCycle()
 * ```
 */
export {
  // Class
  TierMigrationScheduler,
  // Factory
  createMigrationScheduler,
  // Constants
  DEFAULT_MIGRATION_CONFIG,
  // Types
  type BackgroundMigrationConfig,
  type MigrationDOStorage,
  type TieredStorageBackend,
  type MigrationCandidate,
  type MigrationResult as BackgroundMigrationResult,
  type MigrationCycleResult,
  type MigrationSchedulerState,
} from './tiered/background-migration'

// =============================================================================
// UI Components - App dashboard and Site marketing page
// =============================================================================

/**
 * App dashboard component.
 *
 * @description
 * Repository browser dashboard using @mdxui/cockpit:
 * - Repository listing and management
 * - Commit history viewer
 * - Branch and tag management
 * - File tree browser
 * - Diff viewer
 * - Clone/push/pull actions
 *
 * @example
 * ```typescript
 * import { App } from 'gitx.do'
 *
 * // Use in your application
 * export default App
 * ```
 */
export { default as App } from '../App.js'

/**
 * Site marketing page component.
 *
 * @description
 * Marketing landing page using @mdxui/beacon:
 * - Hero section with code examples
 * - Feature highlights (Git on edge, no VMs, etc.)
 * - Pricing section
 * - FAQ
 * - Footer with links
 *
 * @example
 * ```typescript
 * import { Site } from 'gitx.do'
 *
 * // Use in your application
 * export default Site
 * ```
 */
export { default as Site } from '../Site.js'

// =============================================================================
// Middleware - Rate limiting and other request processing
// =============================================================================

/**
 * Rate limiting middleware.
 *
 * @description
 * Configurable rate limiting to protect against abuse:
 * - Different limits for different endpoint types (push, fetch, API)
 * - In-memory and Durable Object-backed storage options
 * - Returns 429 Too Many Requests with Retry-After header
 * - Configurable key extraction (IP, user ID, API key)
 *
 * @example
 * ```typescript
 * import {
 *   createRateLimitMiddleware,
 *   MemoryRateLimitStore,
 *   DEFAULT_LIMITS
 * } from 'gitx.do'
 *
 * const store = new MemoryRateLimitStore()
 * const rateLimiter = createRateLimitMiddleware({
 *   store,
 *   limits: DEFAULT_LIMITS,
 * })
 *
 * // Apply to Hono router
 * app.use('*', rateLimiter)
 * ```
 */
export {
  // Types
  type RateLimitConfig,
  type RateLimitConfigs,
  type RateLimitResult,
  type RateLimitInfo,
  type RateLimitStore,
  type RateLimitOptions,
  type EndpointType,
  type KeyExtractor,
  type EndpointClassifier,
  // Constants
  DEFAULT_LIMITS,
  // Stores
  MemoryRateLimitStore,
  DORateLimitStore,
  // DO class
  RateLimitDO,
  // Middleware factory
  createRateLimitMiddleware,
  // Utility functions
  createDefaultRateLimiter,
  createStrictRateLimiter,
  createPermissiveRateLimiter,
  // Key extraction
  defaultKeyExtractor,
  createUserAwareKeyExtractor,
  // Endpoint classification
  defaultEndpointClassifier,
} from './middleware/rate-limit'

// =============================================================================
// Errors - Unified error hierarchy
// =============================================================================

/**
 * Unified error hierarchy.
 *
 * @description
 * All GitX errors extend from GitXError, providing:
 * - Standardized error codes for programmatic handling
 * - Error cause chaining for debugging
 * - Consistent serialization via toJSON()
 * - Type guards for error checking
 *
 * Error classes by domain:
 * - {@link GitXError}: Base error class
 * - {@link StorageError}: R2, SQLite, Parquet operations
 * - {@link WireError}: Git protocol, pkt-line, auth
 * - {@link IcebergError}: Iceberg catalog and metadata
 * - {@link RefError}: Branches, tags, refs
 * - {@link ObjectError}: Git objects, parsing, deltas
 * - {@link RPCError}: RPC/MCP operations
 * - {@link MigrationError}: Schema and data migrations
 *
 * @example
 * ```typescript
 * import {
 *   GitXError,
 *   StorageError,
 *   WireError,
 *   isGitXError,
 *   hasErrorCode
 * } from 'gitx.do'
 *
 * try {
 *   await storage.getObject(sha)
 * } catch (error) {
 *   if (hasErrorCode(error, 'NOT_FOUND')) {
 *     // Handle not found
 *   } else if (error instanceof StorageError) {
 *     console.log(`Storage error: ${error.code}`)
 *   }
 * }
 * ```
 */
export {
  // Base error class
  GitXError,
  type GitXErrorCode,
  // Domain-specific errors
  StorageError,
  type StorageErrorCode,
  WireError,
  type WireErrorCode,
  IcebergError,
  type IcebergErrorCode,
  RefError,
  type RefErrorCode,
  ObjectError,
  type ObjectErrorCode,
  RPCError,
  type RPCErrorCode,
  MigrationError,
  type MigrationErrorCode,
  // Type guards
  isGitXError,
  isStorageError,
  isWireError,
  isIcebergError,
  isRefError,
  isObjectError,
  isRPCError,
  isMigrationError,
  hasErrorCode,
} from './errors'
