/**
 * @fileoverview Git Packfile Generation
 *
 * This module provides comprehensive packfile generation capabilities for creating
 * Git packfiles programmatically. It supports both full object storage and delta
 * compression for efficient packing.
 *
 * ## Features
 *
 * - **Full Object Packing**: Store objects without delta compression
 * - **Delta Compression**: Automatic OFS_DELTA generation for similar objects
 * - **REF_DELTA Support**: Reference-based deltas for thin packs
 * - **Configurable Options**: Control delta depth, window size, compression level
 * - **Thin Pack Generation**: Create packs that reference external objects
 *
 * ## Pack Structure
 *
 * Generated packfiles follow the Git packfile v2 format:
 * - 12-byte header (signature + version + object count)
 * - Sequence of packed objects (header + compressed data)
 * - 20-byte SHA-1 trailer
 *
 * ## Delta Compression
 *
 * When enabled, the generator uses a sliding window approach to find similar
 * objects and create delta chains. OFS_DELTA is preferred as it's more efficient
 * than REF_DELTA for local storage.
 *
 * @module pack/generation
 * @see {@link https://git-scm.com/docs/pack-format} Git Pack Format Documentation
 *
 * @example
 * // Simple packfile generation
 * import { generatePackfile, PackableObject, PackObjectType } from './generation';
 *
 * const objects: PackableObject[] = [
 *   { sha: 'abc123...', type: PackObjectType.OBJ_BLOB, data: blobData }
 * ];
 * const packfile = generatePackfile(objects);
 *
 * @example
 * // Using PackfileGenerator with options
 * import { PackfileGenerator, PackObjectType } from './generation';
 *
 * const generator = new PackfileGenerator({
 *   enableDeltaCompression: true,
 *   maxDeltaDepth: 50,
 *   windowSize: 10
 * });
 *
 * generator.addObject({ sha: '...', type: PackObjectType.OBJ_BLOB, data: ... });
 * const result = generator.generate();
 */
import { PackObjectType } from './format';
/**
 * Represents an object that can be packed into a packfile.
 *
 * @description Contains all the information needed to add an object to a pack:
 * the object's SHA-1 identifier, its type, raw data, and optional path for
 * delta base selection optimization.
 *
 * @interface PackableObject
 *
 * @example
 * const blob: PackableObject = {
 *   sha: 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3',
 *   type: PackObjectType.OBJ_BLOB,
 *   data: new TextEncoder().encode('Hello, World!'),
 *   path: 'README.md' // Optional: helps with delta base selection
 * };
 */
export interface PackableObject {
    /** The 40-character hexadecimal SHA-1 hash of the object */
    sha: string;
    /** The Git object type (commit, tree, blob, or tag) */
    type: PackObjectType;
    /** The raw (uncompressed) object data */
    data: Uint8Array;
    /** Optional file path, used to improve delta base selection */
    path?: string;
}
/**
 * Represents a delta object that references an external base.
 *
 * @description Used for REF_DELTA objects in thin packs where the base
 * object is not included in the packfile. The receiver must have the base
 * object available to reconstruct the target.
 *
 * @interface DeltaObject
 */
export interface DeltaObject {
    /** SHA-1 of the delta object itself */
    sha: string;
    /** The original object type (before delta encoding) */
    type: PackObjectType;
    /** SHA-1 of the base object this delta references */
    baseSha: string;
    /** The delta data (instructions to transform base to target) */
    delta: Uint8Array;
}
/**
 * Configuration options for the PackfileGenerator.
 *
 * @description Controls how objects are packed, including delta compression
 * settings, compression level, and minimum object sizes for delta consideration.
 *
 * @interface GeneratorOptions
 *
 * @example
 * const options: GeneratorOptions = {
 *   enableDeltaCompression: true,
 *   maxDeltaDepth: 50,
 *   windowSize: 10,
 *   compressionLevel: 6
 * };
 */
export interface GeneratorOptions {
    /** Enable delta compression (default: false) */
    enableDeltaCompression?: boolean;
    /** Maximum depth of delta chains (default: 50) */
    maxDeltaDepth?: number;
    /** Number of objects to consider as delta bases (default: 10) */
    windowSize?: number;
    /** Zlib compression level 0-9 (default: 6) */
    compressionLevel?: number;
    /** Use REF_DELTA instead of OFS_DELTA (default: false) */
    useRefDelta?: boolean;
    /** Minimum object size to consider for delta compression (default: 0) */
    minDeltaSize?: number;
}
/**
 * Statistics collected during pack generation.
 *
 * @description Provides metrics about the generated packfile including
 * object counts, sizes, compression ratios, and timing information.
 *
 * @interface PackGenerationStats
 */
export interface PackGenerationStats {
    /** Total number of objects in the packfile */
    totalObjects: number;
    /** Number of objects stored as deltas */
    deltaObjects: number;
    /** Total uncompressed size of all objects in bytes */
    totalSize: number;
    /** Total compressed size of all object data in bytes */
    compressedSize: number;
    /** Maximum delta chain depth achieved */
    maxDeltaDepth: number;
    /** Time taken to generate the packfile in milliseconds */
    generationTimeMs: number;
}
/**
 * Result returned by PackfileGenerator.generate().
 *
 * @description Contains the generated packfile data (without trailing checksum),
 * the computed checksum, and generation statistics. To create a complete packfile,
 * concatenate packData with checksum.
 *
 * @interface GeneratedPackfile
 *
 * @example
 * const result = generator.generate();
 * // Create complete packfile
 * const complete = new Uint8Array(result.packData.length + 20);
 * complete.set(result.packData, 0);
 * complete.set(result.checksum, result.packData.length);
 */
export interface GeneratedPackfile {
    /** Packfile data (header + objects, without trailing checksum) */
    packData: Uint8Array;
    /** SHA-1 checksum of packData */
    checksum: Uint8Array;
    /** Statistics from the generation process */
    stats: PackGenerationStats;
}
/**
 * Represents a candidate for delta base selection.
 *
 * @description Contains the essential information about an object that could
 * serve as a delta base. Used by the thin pack generator to evaluate
 * potential base objects for delta compression.
 *
 * @interface DeltaCandidate
 */
export interface DeltaCandidate {
    /** SHA-1 of the candidate base object */
    sha: string;
    /** Object type (must match target for delta consideration) */
    type: PackObjectType;
    /** Raw object data (used to compute delta) */
    data: Uint8Array;
}
/**
 * Options for thin pack generation.
 *
 * @description Thin packs contain REF_DELTA objects that reference base objects
 * not included in the pack. This is used for network transfers where the receiver
 * is expected to already have the base objects.
 *
 * @interface ThinPackOptions
 */
export interface ThinPackOptions {
    /** Set of SHA-1 hashes of objects the receiver already has */
    externalObjects: Set<string>;
    /** Optional map of SHA to data for external objects (for computing deltas) */
    baseData?: Map<string, Uint8Array>;
}
/**
 * Result of thin pack generation.
 *
 * @description Contains the generated thin pack along with metadata about
 * its structure and any missing base objects.
 *
 * @interface ThinPackResult
 */
export interface ThinPackResult {
    /** The generated packfile data (without trailing checksum) */
    packData: Uint8Array;
    /** SHA-1 checksum of the pack data */
    checksum: Uint8Array;
    /** Whether the pack contains REF_DELTA objects referencing external bases */
    isThin: boolean;
    /** List of base SHA-1s that are referenced but not included */
    missingBases: string[];
    /** Generation statistics */
    stats: PackGenerationStats;
}
/**
 * Computes the SHA-1 checksum of pack content.
 *
 * @description Calculates the 20-byte SHA-1 hash that serves as the pack's
 * checksum/trailer. This checksum is appended to the pack and also used
 * in the corresponding .idx file.
 *
 * @param {Uint8Array} data - The pack data to checksum
 * @returns {Uint8Array} 20-byte SHA-1 checksum
 *
 * @example
 * const packWithoutChecksum = generatePackContent(objects);
 * const checksum = computePackChecksum(packWithoutChecksum);
 * // Append checksum to create complete packfile
 */
export declare function computePackChecksum(data: Uint8Array): Uint8Array;
/**
 * Orders objects for optimal delta compression.
 *
 * @description Sorts objects to maximize delta compression efficiency by:
 * 1. Grouping by type (commits, trees, blobs, tags)
 * 2. Within each type, grouping by path (similar files together)
 * 3. Within path groups, sorting by size (larger first as better bases)
 *
 * This ordering ensures that similar objects are adjacent, improving the
 * chances of finding good delta bases within the sliding window.
 *
 * @param {PackableObject[]} objects - Objects to order
 * @returns {PackableObject[]} New array with objects in optimal order
 *
 * @example
 * const ordered = orderObjectsForCompression(objects);
 * // Use ordered array for pack generation
 */
export declare function orderObjectsForCompression(objects: PackableObject[]): PackableObject[];
/**
 * Selects the best delta base from a set of candidates.
 *
 * @description Evaluates each candidate by computing similarity with the target
 * and returns the most similar object if it exceeds the threshold.
 *
 * **Selection Criteria:**
 * - Must be same type as target
 * - Must not be the target itself
 * - Similarity must exceed 30% threshold
 *
 * @param {DeltaCandidate} target - The object to find a base for
 * @param {DeltaCandidate[]} candidates - Potential base objects
 * @returns {DeltaCandidate | null} Best candidate or null if none suitable
 *
 * @example
 * const base = selectDeltaBase(targetObj, windowObjects);
 * if (base) {
 *   const delta = createDelta(base.data, targetObj.data);
 * }
 */
export declare function selectDeltaBase(target: DeltaCandidate, candidates: DeltaCandidate[]): DeltaCandidate | null;
/**
 * Generator class for creating Git packfiles.
 *
 * @description Provides a fluent API for building packfiles with support for:
 * - Adding objects incrementally
 * - Optional delta compression with configurable parameters
 * - Both OFS_DELTA and REF_DELTA encoding
 * - Statistics collection during generation
 *
 * **Usage Pattern:**
 * 1. Create generator with desired options
 * 2. Add objects using addObject() or addDeltaObject()
 * 3. Call generate() to produce the packfile
 * 4. Optionally call reset() to reuse the generator
 *
 * @class PackfileGenerator
 *
 * @example
 * // Basic usage
 * const generator = new PackfileGenerator();
 * generator.addObject({ sha: '...', type: PackObjectType.OBJ_BLOB, data: ... });
 * generator.addObject({ sha: '...', type: PackObjectType.OBJ_TREE, data: ... });
 * const result = generator.generate();
 *
 * @example
 * // With delta compression
 * const generator = new PackfileGenerator({
 *   enableDeltaCompression: true,
 *   maxDeltaDepth: 50,
 *   windowSize: 10
 * });
 *
 * for (const obj of objects) {
 *   generator.addObject(obj);
 * }
 *
 * const { packData, checksum, stats } = generator.generate();
 * console.log(`Compressed ${stats.deltaObjects} objects as deltas`);
 */
export declare class PackfileGenerator {
    private objects;
    private deltaObjects;
    private options;
    /**
     * Creates a new PackfileGenerator with the specified options.
     *
     * @param {GeneratorOptions} [options={}] - Configuration options
     */
    constructor(options?: GeneratorOptions);
    /**
     * Gets the total number of objects added to the generator.
     * @returns {number} Count of regular objects plus delta objects
     */
    get objectCount(): number;
    /**
     * Adds an object to be included in the packfile.
     *
     * @description Objects are deduplicated by SHA. If an object with the same SHA
     * has already been added, this call is a no-op.
     *
     * @param {PackableObject} object - The object to add
     */
    addObject(object: PackableObject): void;
    /**
     * Adds a pre-computed delta object for thin pack generation.
     *
     * @description Use this for REF_DELTA objects that reference external bases.
     * The delta must already be computed.
     *
     * @param {DeltaObject} deltaObj - The delta object to add
     */
    addDeltaObject(deltaObj: DeltaObject): void;
    /**
     * Resets the generator to its initial state.
     *
     * @description Clears all added objects and delta objects, allowing the
     * generator to be reused for a new packfile.
     */
    reset(): void;
    /**
     * Generates the packfile from all added objects.
     *
     * @description Produces a complete packfile including:
     * - 12-byte header
     * - All objects (with optional delta compression)
     * - Generation statistics
     *
     * Note: The returned packData does NOT include the trailing checksum.
     * Concatenate packData with checksum to create the complete packfile.
     *
     * @returns {GeneratedPackfile} Pack data, checksum, and statistics
     *
     * @example
     * const result = generator.generate();
     * // Write complete packfile
     * const complete = new Uint8Array(result.packData.length + 20);
     * complete.set(result.packData);
     * complete.set(result.checksum, result.packData.length);
     */
    generate(): GeneratedPackfile;
}
/**
 * Generates a complete packfile from an array of objects.
 *
 * @description Convenience function that creates a PackfileGenerator, adds all
 * objects, generates the pack, and returns a complete packfile with the trailing
 * SHA-1 checksum appended.
 *
 * This function does not use delta compression. For delta compression, use
 * the PackfileGenerator class directly with enableDeltaCompression option.
 *
 * @param {PackableObject[]} objects - Array of objects to pack
 * @returns {Uint8Array} Complete packfile with header, objects, and checksum
 *
 * @example
 * const objects: PackableObject[] = [
 *   { sha: 'abc...', type: PackObjectType.OBJ_BLOB, data: blobData },
 *   { sha: 'def...', type: PackObjectType.OBJ_TREE, data: treeData },
 *   { sha: 'ghi...', type: PackObjectType.OBJ_COMMIT, data: commitData }
 * ];
 *
 * const packfile = generatePackfile(objects);
 * await fs.writeFile('pack-abc123.pack', packfile);
 */
export declare function generatePackfile(objects: PackableObject[]): Uint8Array;
/**
 * Generates a thin pack that can reference external base objects.
 *
 * @description Creates a packfile where objects can be stored as REF_DELTA
 * referencing base objects not included in the pack. This is typically used
 * for network transfers where the receiver already has some objects.
 *
 * **Thin Pack Behavior:**
 * - Attempts to delta-compress objects against external bases
 * - Uses REF_DELTA format (base referenced by SHA-1)
 * - Falls back to full objects when delta is not beneficial
 * - Tracks which external bases are referenced
 *
 * @param {PackableObject[]} objects - Array of objects to pack
 * @param {ThinPackOptions} options - Configuration including external object set
 * @returns {ThinPackResult} Pack data, checksum, and metadata about external refs
 *
 * @example
 * // Generate thin pack for git push
 * const externalObjects = new Set(['abc123...', 'def456...']); // Objects server has
 * const baseData = new Map([['abc123...', baseObjData]]);      // Data for delta computation
 *
 * const result = generateThinPack(objectsToSend, {
 *   externalObjects,
 *   baseData
 * });
 *
 * console.log(`Created thin pack with ${result.missingBases.length} external refs`);
 */
export declare function generateThinPack(objects: PackableObject[], options: ThinPackOptions): ThinPackResult;
//# sourceMappingURL=generation.d.ts.map