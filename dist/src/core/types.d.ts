/**
 * @fileoverview Core Type Definitions (Platform Agnostic)
 *
 * This module re-exports the canonical storage interfaces from types/storage
 * and defines additional platform-agnostic types for git operations.
 * These interfaces are designed to be implemented by platform-specific
 * backends (Node.js fs, Cloudflare R2, etc.)
 *
 * This module has ZERO Cloudflare dependencies and can run in any JavaScript runtime.
 *
 * @module core/types
 */
import type { ObjectType } from './objects';
export type { ObjectStore, BasicObjectStore, RefObjectStore, TreeDiffObjectStore, CommitProvider, BasicCommitProvider, ValidationResult, } from '../types/storage';
/**
 * Result of retrieving a Git object from storage.
 *
 * Note: This uses 'data' instead of 'content' for backward compatibility
 * with modules expecting the older interface.
 */
export interface StoredObjectResult {
    /** The type of Git object */
    type: ObjectType;
    /** Raw binary content of the object (excluding Git header) */
    data: Uint8Array;
}
export type { CASBackend, RefBackend, FileBackend, StorageBackend, } from '../storage/backend';
/**
 * Interface for SHA-1 hashing.
 *
 * This allows different runtime implementations (Web Crypto, Node.js crypto, etc.)
 */
export interface HashFunction {
    /**
     * Compute SHA-1 hash of data.
     * @returns 40-character lowercase hexadecimal string
     */
    sha1(data: Uint8Array): Promise<string>;
    /**
     * Compute SHA-1 hash synchronously (if available).
     */
    sha1Sync?(data: Uint8Array): string;
}
/**
 * Interface for zlib compression/decompression.
 *
 * This allows different runtime implementations (pako, Node.js zlib, etc.)
 */
export interface CompressionProvider {
    /**
     * Deflate (compress) data.
     */
    deflate(data: Uint8Array): Promise<Uint8Array>;
    /**
     * Inflate (decompress) data.
     */
    inflate(data: Uint8Array): Promise<Uint8Array>;
    /**
     * Synchronous deflate (if available).
     */
    deflateSync?(data: Uint8Array): Uint8Array;
    /**
     * Synchronous inflate (if available).
     */
    inflateSync?(data: Uint8Array): Uint8Array;
}
/**
 * Operation result with optional error.
 */
export interface OperationResult<T = void> {
    success: boolean;
    data?: T;
    error?: string;
}
/**
 * Options for walk operations.
 */
export interface WalkOptions {
    /** Maximum depth to traverse (-1 for unlimited) */
    maxDepth?: number;
    /** Filter function for entries */
    filter?: (entry: {
        path: string;
        type: string;
    }) => boolean;
}
/**
 * File entry for tree walking.
 */
export interface FileEntry {
    /** Path relative to repository root */
    path: string;
    /** File mode string */
    mode: string;
    /** SHA-1 of the blob */
    sha: string;
    /** Object type ('blob' or 'tree') */
    type: 'blob' | 'tree';
}
/**
 * Diff entry between two trees.
 */
export interface DiffEntry {
    /** Path relative to repository root */
    path: string;
    /** Old file SHA (null if added) */
    oldSha: string | null;
    /** New file SHA (null if deleted) */
    newSha: string | null;
    /** Old file mode (null if added) */
    oldMode: string | null;
    /** New file mode (null if deleted) */
    newMode: string | null;
    /** Type of change */
    status: 'added' | 'deleted' | 'modified' | 'renamed' | 'copied';
    /** For renames/copies: similarity percentage */
    similarity?: number;
    /** For renames/copies: old path */
    oldPath?: string;
}
//# sourceMappingURL=types.d.ts.map