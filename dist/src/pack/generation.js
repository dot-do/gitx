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
import pako from 'pako';
import { PackObjectType, encodeTypeAndSize } from './format';
import { createDelta } from './delta';
import { concatArrays, hexToBytes, createPackHeader, computePackChecksum, encodeOffset, calculateSimilarity, TYPE_ORDER, DEFAULT_WINDOW_SIZE, DEFAULT_MAX_DELTA_DEPTH, DEFAULT_COMPRESSION_LEVEL, DEFAULT_MIN_DELTA_SIZE } from './utils';
// Re-export computePackChecksum for backward compatibility
export { computePackChecksum } from './utils';
// ============================================================================
// Object Ordering
// ============================================================================
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
export function orderObjectsForCompression(objects) {
    return [...objects].sort((a, b) => {
        // First, sort by type using shared TYPE_ORDER
        const typeCompare = (TYPE_ORDER[a.type] ?? 0) - (TYPE_ORDER[b.type] ?? 0);
        if (typeCompare !== 0)
            return typeCompare;
        // Within same type, sort by path if available (groups similar files)
        if (a.path && b.path) {
            const pathCompare = a.path.localeCompare(b.path);
            if (pathCompare !== 0)
                return pathCompare;
        }
        // Then by size (larger first - better delta bases)
        return b.data.length - a.data.length;
    });
}
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
export function selectDeltaBase(target, candidates) {
    if (candidates.length === 0)
        return null;
    let bestCandidate = null;
    let bestSimilarity = 0;
    for (const candidate of candidates) {
        // Only consider same type for delta
        if (candidate.type !== target.type)
            continue;
        // Don't delta against self
        if (candidate.sha === target.sha)
            continue;
        const similarity = calculateSimilarity(candidate.data, target.data);
        if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestCandidate = candidate;
        }
    }
    // Only return if similarity is good enough
    return bestSimilarity > 0.3 ? bestCandidate : null;
}
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
export class PackfileGenerator {
    objects = new Map();
    deltaObjects = [];
    options;
    /**
     * Creates a new PackfileGenerator with the specified options.
     *
     * @param {GeneratorOptions} [options={}] - Configuration options
     */
    constructor(options = {}) {
        this.options = {
            enableDeltaCompression: options.enableDeltaCompression ?? false,
            maxDeltaDepth: options.maxDeltaDepth ?? DEFAULT_MAX_DELTA_DEPTH,
            windowSize: options.windowSize ?? DEFAULT_WINDOW_SIZE,
            compressionLevel: options.compressionLevel ?? DEFAULT_COMPRESSION_LEVEL,
            useRefDelta: options.useRefDelta ?? false,
            minDeltaSize: options.minDeltaSize ?? 0 // Default to 0, use caller-specified value if set
        };
    }
    /**
     * Gets the total number of objects added to the generator.
     * @returns {number} Count of regular objects plus delta objects
     */
    get objectCount() {
        return this.objects.size + this.deltaObjects.length;
    }
    /**
     * Adds an object to be included in the packfile.
     *
     * @description Objects are deduplicated by SHA. If an object with the same SHA
     * has already been added, this call is a no-op.
     *
     * @param {PackableObject} object - The object to add
     */
    addObject(object) {
        // Skip duplicates
        if (this.objects.has(object.sha))
            return;
        const internalObj = {
            sha: object.sha,
            type: object.type,
            data: object.data,
            path: object.path,
            isDelta: false,
            depth: 0
        };
        this.objects.set(object.sha, internalObj);
    }
    /**
     * Adds a pre-computed delta object for thin pack generation.
     *
     * @description Use this for REF_DELTA objects that reference external bases.
     * The delta must already be computed.
     *
     * @param {DeltaObject} deltaObj - The delta object to add
     */
    addDeltaObject(deltaObj) {
        this.deltaObjects.push(deltaObj);
    }
    /**
     * Resets the generator to its initial state.
     *
     * @description Clears all added objects and delta objects, allowing the
     * generator to be reused for a new packfile.
     */
    reset() {
        this.objects.clear();
        this.deltaObjects = [];
    }
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
    generate() {
        const startTime = Date.now();
        let totalSize = 0;
        let compressedSize = 0;
        let deltaCount = 0;
        let maxDeltaDepth = 0;
        // Get all objects and order them
        const objectList = Array.from(this.objects.values());
        const orderedObjects = orderObjectsForCompression(objectList.map(o => ({ sha: o.sha, type: o.type, data: o.data, path: o.path })));
        // Calculate total size
        for (const obj of orderedObjects) {
            totalSize += obj.data.length;
        }
        // Build offset map for OFS_DELTA
        const offsetMap = new Map();
        const parts = [];
        // Create header
        const header = createPackHeader(orderedObjects.length + this.deltaObjects.length);
        parts.push(header);
        let currentOffset = 12; // After header
        // Compute delta chains if enabled
        const deltaChains = new Map();
        if (this.options.enableDeltaCompression) {
            // Window of recent objects for delta comparison
            const window = [];
            const depthMap = new Map();
            for (const obj of orderedObjects) {
                const internalObj = this.objects.get(obj.sha);
                // Skip small objects
                const minSize = this.options.minDeltaSize ?? DEFAULT_MIN_DELTA_SIZE;
                const windowSize = this.options.windowSize ?? DEFAULT_WINDOW_SIZE;
                const maxDepth = this.options.maxDeltaDepth ?? DEFAULT_MAX_DELTA_DEPTH;
                if (obj.data.length < minSize) {
                    window.push(internalObj);
                    if (window.length > windowSize) {
                        window.shift();
                    }
                    continue;
                }
                // Look for a good base in the window
                let bestBase = null;
                let bestDelta = null;
                let bestSavings = 0;
                for (const candidate of window) {
                    if (candidate.type !== obj.type)
                        continue;
                    // Check depth limit
                    const candidateDepth = depthMap.get(candidate.sha) ?? 0;
                    if (candidateDepth >= maxDepth)
                        continue;
                    const delta = createDelta(candidate.data, obj.data);
                    const savings = obj.data.length - delta.length;
                    if (savings > bestSavings && delta.length < obj.data.length * 0.9) {
                        bestBase = candidate;
                        bestDelta = delta;
                        bestSavings = savings;
                    }
                }
                if (bestBase && bestDelta) {
                    const depth = (depthMap.get(bestBase.sha) ?? 0) + 1;
                    deltaChains.set(obj.sha, { base: bestBase, delta: bestDelta, depth });
                    depthMap.set(obj.sha, depth);
                    if (depth > maxDeltaDepth)
                        maxDeltaDepth = depth;
                }
                window.push(internalObj);
                if (window.length > windowSize) {
                    window.shift();
                }
            }
        }
        // Write objects
        for (const obj of orderedObjects) {
            const objStart = currentOffset;
            offsetMap.set(obj.sha, objStart);
            const deltaInfo = deltaChains.get(obj.sha);
            if (deltaInfo && offsetMap.has(deltaInfo.base.sha)) {
                // Write as OFS_DELTA
                const baseOffset = offsetMap.get(deltaInfo.base.sha);
                const relativeOffset = objStart - baseOffset;
                // OFS_DELTA header
                const typeAndSize = encodeTypeAndSize(PackObjectType.OBJ_OFS_DELTA, deltaInfo.delta.length);
                const offsetEncoded = encodeOffset(relativeOffset);
                const compressed = pako.deflate(deltaInfo.delta, { level: this.options.compressionLevel });
                parts.push(typeAndSize);
                parts.push(offsetEncoded);
                parts.push(compressed);
                currentOffset += typeAndSize.length + offsetEncoded.length + compressed.length;
                compressedSize += compressed.length;
                deltaCount++;
            }
            else {
                // Write as full object
                const typeAndSize = encodeTypeAndSize(obj.type, obj.data.length);
                const compressed = pako.deflate(obj.data, { level: this.options.compressionLevel });
                parts.push(typeAndSize);
                parts.push(compressed);
                currentOffset += typeAndSize.length + compressed.length;
                compressedSize += compressed.length;
            }
        }
        // Write REF_DELTA objects
        for (const deltaObj of this.deltaObjects) {
            // REF_DELTA header
            const typeAndSize = encodeTypeAndSize(PackObjectType.OBJ_REF_DELTA, deltaObj.delta.length);
            const baseShaBytes = hexToBytes(deltaObj.baseSha);
            const compressed = pako.deflate(deltaObj.delta, { level: this.options.compressionLevel });
            parts.push(typeAndSize);
            parts.push(baseShaBytes);
            parts.push(compressed);
            currentOffset += typeAndSize.length + baseShaBytes.length + compressed.length;
            compressedSize += compressed.length;
            totalSize += deltaObj.delta.length;
        }
        // Combine all parts (this is the pack data without trailing checksum)
        const packData = concatArrays(parts);
        // Calculate checksum of the pack data
        const checksum = computePackChecksum(packData);
        const generationTimeMs = Date.now() - startTime;
        // packData does NOT include the trailing checksum
        // To get a complete packfile, concatenate packData + checksum
        // This allows the caller to verify or manipulate the pack before finalizing
        return {
            packData,
            checksum,
            stats: {
                totalObjects: orderedObjects.length + this.deltaObjects.length,
                deltaObjects: deltaCount,
                totalSize,
                compressedSize,
                maxDeltaDepth,
                generationTimeMs
            }
        };
    }
}
// ============================================================================
// Main Functions
// ============================================================================
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
export function generatePackfile(objects) {
    const generator = new PackfileGenerator();
    for (const obj of objects) {
        generator.addObject(obj);
    }
    const result = generator.generate();
    // Combine packData with checksum to form complete packfile
    const completePackfile = new Uint8Array(result.packData.length + result.checksum.length);
    completePackfile.set(result.packData, 0);
    completePackfile.set(result.checksum, result.packData.length);
    return completePackfile;
}
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
export function generateThinPack(objects, options) {
    const startTime = Date.now();
    const missingBases = [];
    let deltaCount = 0;
    let totalSize = 0;
    let compressedSize = 0;
    // Check if any objects can use external bases
    const hasExternalBases = options.externalObjects.size > 0;
    const parts = [];
    // Create header
    const header = createPackHeader(objects.length);
    parts.push(header);
    // Process objects
    for (const obj of objects) {
        totalSize += obj.data.length;
        // Try to find an external base for delta
        let usedExternalBase = false;
        if (hasExternalBases && options.baseData) {
            for (const externalSha of options.externalObjects) {
                const baseData = options.baseData.get(externalSha);
                if (baseData) {
                    // Calculate similarity
                    const similarity = calculateSimilarity(baseData, obj.data);
                    if (similarity > 0.3) {
                        // Create delta
                        const delta = createDelta(baseData, obj.data);
                        if (delta.length < obj.data.length * 0.9) {
                            // Use REF_DELTA
                            const typeAndSize = encodeTypeAndSize(PackObjectType.OBJ_REF_DELTA, delta.length);
                            const baseShaBytes = hexToBytes(externalSha);
                            const compressed = pako.deflate(delta);
                            parts.push(typeAndSize);
                            parts.push(baseShaBytes);
                            parts.push(compressed);
                            compressedSize += compressed.length;
                            deltaCount++;
                            usedExternalBase = true;
                            if (!missingBases.includes(externalSha)) {
                                missingBases.push(externalSha);
                            }
                            break;
                        }
                    }
                }
            }
        }
        if (!usedExternalBase) {
            // Write as full object
            const typeAndSize = encodeTypeAndSize(obj.type, obj.data.length);
            const compressed = pako.deflate(obj.data);
            parts.push(typeAndSize);
            parts.push(compressed);
            compressedSize += compressed.length;
        }
    }
    // Combine all parts
    const packData = concatArrays(parts);
    // Calculate checksum
    const checksum = computePackChecksum(packData);
    // Create final packfile with checksum
    const finalPack = new Uint8Array(packData.length + 20);
    finalPack.set(packData, 0);
    finalPack.set(checksum, packData.length);
    const generationTimeMs = Date.now() - startTime;
    // A pack is considered "thin" if it's generated with the capability to reference
    // external objects, even if no actual external references were used
    const isThin = hasExternalBases;
    return {
        packData: finalPack,
        checksum,
        isThin,
        missingBases,
        stats: {
            totalObjects: objects.length,
            deltaObjects: deltaCount,
            totalSize,
            compressedSize,
            maxDeltaDepth: deltaCount > 0 ? 1 : 0,
            generationTimeMs
        }
    };
}
//# sourceMappingURL=generation.js.map