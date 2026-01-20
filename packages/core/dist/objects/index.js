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
// =============================================================================
// Core Classes
// =============================================================================
export { GitBlob } from './blob';
export { GitTree, sortTreeEntries, parseTreeEntries, serializeTreeEntries } from './tree';
export { GitCommit, parseIdentity, formatIdentity, hasGpgSignature, parseGpgSignature, validateCommitData, } from './commit';
export { GitTag } from './tag';
// =============================================================================
// Types and Constants
// =============================================================================
export { OBJECT_TYPES, VALID_MODES, isValidSha, isValidMode, isValidObjectType } from './types';
// =============================================================================
// Hash Utilities
// =============================================================================
export { calculateSha1, calculateObjectHash, createObjectHeader, parseObjectHeader, bytesToHex, hexToBytes, } from './hash';
// =============================================================================
// Loose Object Format (Zlib Compression)
// =============================================================================
import pako from 'pako';
import { GitBlob } from './blob';
import { GitTree } from './tree';
import { GitCommit } from './commit';
import { GitTag } from './tag';
import { parseObjectHeader } from './hash';
/**
 * Compresses data using zlib deflate
 */
export async function compressObject(data) {
    return pako.deflate(data);
}
/**
 * Decompresses zlib-compressed data
 * @throws Error if decompression fails (invalid or truncated data)
 */
export async function decompressObject(data) {
    try {
        const result = pako.inflate(data);
        if (!result || result.length === 0) {
            throw new Error('Decompression produced empty result');
        }
        return result;
    }
    catch (e) {
        throw new Error(`Failed to decompress object: ${e instanceof Error ? e.message : String(e)}`);
    }
}
/**
 * Prepares a Git object for writing as a loose object
 * @returns Object with path and compressed data
 */
export async function writeLooseObject(obj) {
    const serialized = obj.serialize();
    const hash = await obj.hash();
    const compressed = await compressObject(serialized);
    // Path: objects/<first-2-chars>/<remaining-38-chars>
    const path = `objects/${hash.slice(0, 2)}/${hash.slice(2)}`;
    return { path, data: compressed };
}
/**
 * Reads and parses a compressed loose object
 */
export async function readLooseObject(compressedData) {
    const decompressed = await decompressObject(compressedData);
    return parseGitObject(decompressed);
}
// =============================================================================
// Object Type Detection and Parsing
// =============================================================================
/**
 * Detects the object type from serialized data
 */
export function detectObjectType(data) {
    const { type } = parseObjectHeader(data);
    return type;
}
/**
 * Parses any Git object from serialized format
 */
export function parseGitObject(data) {
    const type = detectObjectType(data);
    switch (type) {
        case 'blob':
            return GitBlob.parse(data);
        case 'tree':
            return GitTree.parse(data);
        case 'commit':
            return GitCommit.parse(data);
        case 'tag':
            return GitTag.parse(data);
    }
}
export function createGitObject(type, data) {
    switch (type) {
        case 'blob':
            return new GitBlob(data.content);
        case 'tree':
            return new GitTree(data.entries);
        case 'commit':
            return new GitCommit(data);
        case 'tag':
            return new GitTag(data);
    }
}
//# sourceMappingURL=index.js.map