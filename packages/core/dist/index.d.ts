/**
 * @dotdo/gitx Core - Platform-Agnostic Git Implementation
 *
 * This module exports the core Git implementation that can run in any JavaScript
 * runtime (Node.js, Deno, Cloudflare Workers, browsers, etc.).
 *
 * The core package has ZERO Cloudflare dependencies and provides:
 * - Git object model (blob, tree, commit, tag)
 * - Pack file format (parsing, creation, delta encoding)
 * - Hash utilities (SHA-1 calculation)
 *
 * @module @dotdo/gitx
 *
 * @example
 * ```typescript
 * import {
 *   GitBlob,
 *   GitTree,
 *   GitCommit,
 *   GitTag,
 *   calculateObjectHash,
 *   parsePackHeader,
 * } from '@dotdo/gitx'
 *
 * // Create a blob
 * const blob = new GitBlob(new TextEncoder().encode('Hello, World!'))
 * const hash = await blob.hash()
 *
 * // Create a tree
 * const tree = new GitTree([
 *   { mode: '100644', name: 'hello.txt', sha: hash }
 * ])
 * ```
 */
export { GitBlob, GitTree, GitCommit, GitTag, sortTreeEntries, parseTreeEntries, serializeTreeEntries, parseIdentity, formatIdentity, hasGpgSignature, parseGpgSignature, type TreeEntry, type GitIdentity, type ObjectType, type GitObjectData, type BlobData, type TreeData, type CommitData, type TagData, OBJECT_TYPES, VALID_MODES, isValidSha, isValidMode, isValidObjectType, calculateSha1, calculateObjectHash, createObjectHeader, parseObjectHeader, bytesToHex, hexToBytes, compressObject, decompressObject, writeLooseObject, readLooseObject, detectObjectType, parseGitObject, createGitObject, } from './objects';
export { PACK_MAGIC, PACK_VERSION, PACK_INDEX_MAGIC, PACK_INDEX_VERSION_2, LARGE_OFFSET_THRESHOLD, PackObjectType, OBJ_COMMIT, OBJ_TREE, OBJ_BLOB, OBJ_TAG, OBJ_OFS_DELTA, OBJ_REF_DELTA, type PackHeader, type PackIndexEntry, type FanoutTable, type PackIndex, type ParsedPackObject, parsePackHeader, createPackHeader, validatePackHeader, encodeVariableLengthSize, decodeVariableLengthSize, encodeObjectHeader, decodeObjectHeader, computePackChecksum, verifyPackChecksum, parseFanoutTable, createFanoutTable, getFanoutRange, parsePackIndex, createPackIndex, serializePackIndex, lookupObjectInIndex, calculateCRC32, isLargeOffset, readLargeOffset, writeLargeOffset, parseDeltaOffset, encodeDeltaOffset, PackParser, PackObjectIterator, PackWriter, applyDelta, createDelta, parseDeltaHeader, encodeDeltaHeader, type DeltaInstruction, type DeltaHeader, } from './pack';
export * from './refs';
export * from './protocol';
export { type StoredObjectResult, type BasicObjectStore, type RefObjectStore, type ObjectStore, type CommitInfo, type CommitProvider, type StorageBackend, type HashFunction, type CompressionProvider, type ValidationResult, type OperationResult, } from './types';
export { gitx, createGitX, type GitXFn, type GitResult, type GitOptions, type GitContext, type AsyncFn, type GitRepository, type GitStatus, type GitRef, type GitAuthor, type CommitObject as GitCommitObject, type GitInitOptions, type GitCloneOptions, type GitCommitOptions, type GitLogOptions, type GitBranchOptions, type GitCheckoutOptions, type GitMergeOptions, type GitFetchOptions, type GitPullOptions, type GitPushOptions, type GitDiffOptions, type MergeResult, type StatusFile, } from './fn';
//# sourceMappingURL=index.d.ts.map