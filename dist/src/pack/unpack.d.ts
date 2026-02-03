/**
 * @fileoverview Git Packfile Unpacking Implementation
 *
 * This module implements full packfile unpacking, extracting individual objects
 * from a packed format. This is the inverse operation of packfile generation.
 *
 * ## Unpacking Process
 *
 * 1. **Header Validation**: Verify PACK signature, version 2, and object count
 * 2. **Object Iteration**: For each object in the pack:
 *    - Read type and size from variable-length header
 *    - For delta objects, read base reference (offset or SHA)
 *    - Decompress zlib-compressed data
 *    - For delta objects, resolve base and apply delta
 * 3. **Checksum Verification**: Validate trailing SHA-1 checksum
 *
 * ## Delta Resolution
 *
 * Delta objects (OFS_DELTA, REF_DELTA) require resolving their base:
 * - OFS_DELTA: Base is at a relative byte offset within the same pack
 * - REF_DELTA: Base is referenced by SHA-1 (may be in pack or external)
 *
 * Delta chains are resolved recursively until a non-delta base is found.
 *
 * @module pack/unpack
 * @see {@link https://git-scm.com/docs/pack-format} Git Pack Format Documentation
 */
import { PackObjectType } from './format';
import type { ObjectType } from '../types/objects';
/**
 * Represents a single unpacked object from a packfile.
 */
export interface UnpackedObject {
    /** The 40-character hexadecimal SHA-1 hash of the object */
    sha: string;
    /** The Git object type (commit, tree, blob, tag) */
    type: ObjectType;
    /** The raw (uncompressed) object data */
    data: Uint8Array;
    /** Byte offset where this object started in the packfile */
    offset: number;
}
/**
 * Result of unpacking a complete packfile.
 */
export interface UnpackResult {
    /** Array of all unpacked objects */
    objects: UnpackedObject[];
    /** Total number of objects in the pack */
    objectCount: number;
    /** Pack version (should always be 2) */
    version: number;
    /** Whether checksum verification passed */
    checksumValid: boolean;
}
/**
 * Callback for resolving external REF_DELTA bases.
 *
 * When unpacking thin packs, delta objects may reference bases
 * that exist outside the pack. This callback is invoked to
 * resolve such external references.
 */
export type ExternalBaseResolver = (sha: string) => Promise<{
    type: ObjectType;
    data: Uint8Array;
} | null>;
/**
 * Default limits for unpacking operations to prevent DoS attacks.
 */
export declare const UNPACK_LIMITS: {
    /** Default maximum number of objects in a single packfile */
    readonly MAX_OBJECT_COUNT: 100000;
    /** Default maximum total uncompressed size (1GB) */
    readonly MAX_TOTAL_SIZE: number;
    /** Default maximum size of a single object (100MB) */
    readonly MAX_SINGLE_OBJECT_SIZE: number;
};
/**
 * Options for unpacking a packfile.
 */
export interface UnpackOptions {
    /**
     * Callback to resolve external delta bases (for thin packs).
     * If not provided, unpacking will fail for REF_DELTA objects
     * whose base is not in the pack.
     */
    resolveExternalBase?: ExternalBaseResolver;
    /** Whether to verify the pack checksum (default: true) */
    verifyChecksum?: boolean;
    /** Maximum delta chain depth to prevent stack overflow (default: 50) */
    maxDeltaDepth?: number;
    /**
     * Maximum number of objects allowed in a packfile.
     * Prevents DoS attacks from packfiles with excessive object counts.
     * @default 100000
     */
    maxObjectCount?: number;
    /**
     * Maximum total uncompressed size of all objects in bytes.
     * Prevents DoS attacks from packfiles that decompress to huge sizes.
     * @default 1073741824 (1GB)
     */
    maxTotalSize?: number;
    /**
     * Maximum size of a single object in bytes.
     * Prevents DoS attacks from extremely large individual objects.
     * @default 104857600 (100MB)
     */
    maxSingleObjectSize?: number;
}
/**
 * Unpacks a complete packfile into individual objects.
 *
 * @description Parses the binary packfile format and extracts all objects,
 * resolving delta chains to produce the original object content.
 *
 * Security: This function enforces configurable limits to prevent DoS attacks:
 * - maxObjectCount: Maximum number of objects (default: 100,000)
 * - maxTotalSize: Maximum total uncompressed size (default: 1GB)
 * - maxSingleObjectSize: Maximum size of a single object (default: 100MB)
 *
 * @param packData - Complete packfile data including checksum
 * @param options - Unpacking options including security limits
 * @returns Unpacking result with all objects
 * @throws {Error} If packfile is invalid, corrupted, or exceeds limits
 *
 * @example
 * const result = await unpackPackfile(packData, {
 *   maxObjectCount: 50000,  // Custom limit
 *   maxTotalSize: 500 * 1024 * 1024,  // 500MB
 * });
 * for (const obj of result.objects) {
 *   console.log(`${obj.sha}: ${obj.type} (${obj.data.length} bytes)`);
 * }
 */
export declare function unpackPackfile(packData: Uint8Array, options?: UnpackOptions): Promise<UnpackResult>;
/**
 * Iterates through a packfile yielding objects one at a time.
 *
 * @description Memory-efficient alternative to unpackPackfile for large packs.
 * Objects are yielded as they are parsed and resolved.
 *
 * Security: This function enforces the same configurable limits as unpackPackfile
 * to prevent DoS attacks during streaming unpacking.
 *
 * @param packData - Complete packfile data
 * @param options - Unpacking options including security limits
 * @yields Unpacked objects
 *
 * @example
 * for await (const obj of iteratePackfile(packData, { maxObjectCount: 50000 })) {
 *   await store.putObject(obj.type, obj.data);
 * }
 */
export declare function iteratePackfile(packData: Uint8Array, options?: UnpackOptions): AsyncGenerator<UnpackedObject>;
/**
 * Converts PackObjectType to ObjectType string.
 */
declare function packTypeToObjectType(type: PackObjectType): ObjectType;
/**
 * Computes the SHA-1 hash of a Git object.
 * Git hashes the header "type size\0" + data.
 */
declare function computeObjectSha(type: ObjectType, data: Uint8Array): string;
/**
 * Converts a byte array to lowercase hexadecimal string.
 */
declare function bytesToHex(bytes: Uint8Array): string;
export { packTypeToObjectType, computeObjectSha, bytesToHex, };
//# sourceMappingURL=unpack.d.ts.map