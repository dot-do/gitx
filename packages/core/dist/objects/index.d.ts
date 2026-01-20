/**
 * Git Object Model
 *
 * This module exports all Git object classes and utilities:
 * - GitBlob: File content storage
 * - GitTree: Directory structure
 * - GitCommit: Commit metadata and history
 * - GitTag: Annotated tags
 * - Hash utilities: SHA-1 calculation
 * - Loose object format: Zlib compression
 */
export { GitBlob } from './blob';
export { GitTree, sortTreeEntries, parseTreeEntries, serializeTreeEntries } from './tree';
export type { TreeEntry } from './tree';
export { GitCommit, parseIdentity, formatIdentity, hasGpgSignature, parseGpgSignature, validateCommitData, } from './commit';
export type { GitIdentity, CommitValidationResult, CommitExtraHeaders, ExtendedCommitData, } from './commit';
export { GitTag } from './tag';
export { OBJECT_TYPES, VALID_MODES, isValidSha, isValidMode, isValidObjectType } from './types';
export type { ObjectType, GitObjectData, BlobData, TreeData, CommitData, TagData } from './types';
export { calculateSha1, calculateObjectHash, createObjectHeader, parseObjectHeader, bytesToHex, hexToBytes, } from './hash';
import { GitBlob } from './blob';
import { GitTree } from './tree';
import { GitCommit } from './commit';
import { GitTag } from './tag';
import type { ObjectType } from './types';
/**
 * Compresses data using zlib deflate
 */
export declare function compressObject(data: Uint8Array): Promise<Uint8Array>;
/**
 * Decompresses zlib-compressed data
 * @throws Error if decompression fails (invalid or truncated data)
 */
export declare function decompressObject(data: Uint8Array): Promise<Uint8Array>;
/**
 * Prepares a Git object for writing as a loose object
 * @returns Object with path and compressed data
 */
export declare function writeLooseObject(obj: GitBlob | GitTree | GitCommit | GitTag): Promise<{
    path: string;
    data: Uint8Array;
}>;
/**
 * Reads and parses a compressed loose object
 */
export declare function readLooseObject(compressedData: Uint8Array): Promise<GitBlob | GitTree | GitCommit | GitTag>;
/**
 * Detects the object type from serialized data
 */
export declare function detectObjectType(data: Uint8Array): ObjectType;
/**
 * Parses any Git object from serialized format
 */
export declare function parseGitObject(data: Uint8Array): GitBlob | GitTree | GitCommit | GitTag;
import type { BlobData, TreeData, CommitData, TagData } from './types';
/**
 * Creates a Git object from type and data
 */
export declare function createGitObject(type: 'blob', data: BlobData): GitBlob;
export declare function createGitObject(type: 'tree', data: TreeData): GitTree;
export declare function createGitObject(type: 'commit', data: CommitData): GitCommit;
export declare function createGitObject(type: 'tag', data: TagData): GitTag;
//# sourceMappingURL=index.d.ts.map