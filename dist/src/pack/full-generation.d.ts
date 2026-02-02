/**
 * @fileoverview Full Packfile Generation Module
 *
 * This module provides advanced packfile generation capabilities designed for
 * production use with large repositories. It extends the basic generation module
 * with additional features for optimization, streaming, and incremental updates.
 *
 * ## Key Features
 *
 * - **Delta Chain Optimization**: Intelligent selection of delta bases
 * - **Ordering Strategies**: Multiple object ordering algorithms for optimal compression
 * - **Progress Reporting**: Real-time progress callbacks during generation
 * - **Large Repository Support**: Memory-efficient handling via chunking and streaming
 * - **Incremental Updates**: Efficiently update existing packs with new objects
 * - **Pack Validation**: Verify integrity of generated packfiles
 *
 * ## Main Classes
 *
 * - {@link FullPackGenerator} - Full-featured pack generator with progress support
 * - {@link DeltaChainOptimizer} - Optimizes delta base selection
 * - {@link LargeRepositoryHandler} - Handles large repos with memory limits
 * - {@link StreamingPackWriter} - Writes packs incrementally
 * - {@link IncrementalPackUpdater} - Updates packs with new objects
 *
 * ## Ordering Strategies
 *
 * The module supports multiple object ordering strategies:
 * - TYPE_FIRST: Groups objects by type (commits, trees, blobs, tags)
 * - SIZE_DESCENDING: Largest objects first (good bases for deltas)
 * - RECENCY: Most recently modified objects first
 * - PATH_BASED: Groups objects by file path
 * - DELTA_OPTIMIZED: Orders based on delta chain dependencies
 *
 * @module pack/full-generation
 * @see {@link module:pack/generation} Basic pack generation
 *
 * @example
 * // Generate a pack with progress reporting
 * const generator = new FullPackGenerator({
 *   enableDeltaCompression: true,
 *   orderingStrategy: PackOrderingStrategy.TYPE_FIRST
 * });
 *
 * generator.onProgress((progress) => {
 *   console.log(`${progress.phase}: ${progress.objectsProcessed}/${progress.totalObjects}`);
 * });
 *
 * for (const obj of objects) {
 *   generator.addObject(obj);
 * }
 *
 * const result = generator.generate();
 * console.log(`Generated pack with ${result.stats.deltaObjects} deltas`);
 */
import { PackObjectType } from './format';
/**
 * Represents an object that can be packed into a packfile.
 *
 * @description Extended version with optional timestamp and path for
 * advanced ordering strategies.
 *
 * @interface PackableObject
 */
export interface PackableObject {
    /** 40-character hexadecimal SHA-1 hash */
    sha: string;
    /** Git object type */
    type: PackObjectType;
    /** Raw (uncompressed) object data */
    data: Uint8Array;
    /** Optional file path for path-based ordering */
    path?: string;
    /** Optional timestamp for recency-based ordering */
    timestamp?: number;
}
/**
 * A collection of objects to be packed together.
 *
 * @description Represents a set of objects with optional root references
 * for determining which objects are entry points.
 *
 * @interface PackableObjectSet
 */
export interface PackableObjectSet {
    /** Array of objects to pack */
    objects: PackableObject[];
    /** Optional root object SHAs (e.g., commit heads) */
    roots?: string[];
}
/**
 * Configuration options for full pack generation.
 *
 * @interface FullPackOptions
 */
export interface FullPackOptions {
    /** Enable delta compression (default: false) */
    enableDeltaCompression?: boolean;
    /** Maximum delta chain depth (default: 50) */
    maxDeltaDepth?: number;
    /** Number of objects to consider as delta bases (default: 10) */
    windowSize?: number;
    /** Zlib compression level 0-9 (default: 6) */
    compressionLevel?: number;
    /** Object ordering strategy to use */
    orderingStrategy?: PackOrderingStrategy | undefined;
}
/**
 * Result of full pack generation.
 *
 * @interface GeneratedFullPack
 */
export interface GeneratedFullPack {
    /** Complete packfile data including checksum trailer */
    packData: Uint8Array;
    /** 20-byte SHA-1 checksum */
    checksum: Uint8Array;
    /** Generation statistics */
    stats: FullPackStats;
}
/**
 * Statistics from pack generation.
 *
 * @interface FullPackStats
 */
export interface FullPackStats {
    /** Total number of objects in the pack */
    totalObjects: number;
    /** Number of objects stored as deltas */
    deltaObjects: number;
    /** Total uncompressed size in bytes */
    totalSize: number;
    /** Total compressed size in bytes */
    compressedSize: number;
    /** Ratio of compressed to uncompressed size */
    compressionRatio: number;
    /** Maximum depth of delta chains */
    maxDeltaDepth: number;
    /** Time taken to generate in milliseconds */
    generationTimeMs: number;
}
/**
 * Progress information during pack generation.
 *
 * @description Reported via callback during generation to track progress.
 *
 * @interface PackGenerationProgress
 */
export interface PackGenerationProgress {
    /** Current generation phase */
    phase: 'scanning' | 'sorting' | 'compressing' | 'writing' | 'complete';
    /** Number of objects processed so far */
    objectsProcessed: number;
    /** Total number of objects to process */
    totalObjects: number;
    /** Bytes written to output so far */
    bytesWritten: number;
    /** SHA of currently processing object (if applicable) */
    currentObject?: string | undefined;
}
/**
 * Configuration for delta chain optimization.
 *
 * @interface DeltaChainConfig
 */
export interface DeltaChainConfig {
    /** Maximum allowed delta chain depth (default: 50) */
    maxDepth?: number;
    /** Minimum savings ratio to accept a delta (default: 0.1) */
    minSavingsThreshold?: number;
    /** Number of objects to consider as bases (default: 10) */
    windowSize?: number;
    /** Minimum match length for delta matching (default: 4) */
    minMatchLength?: number;
}
/**
 * Result of delta chain optimization.
 *
 * @interface OptimizedDeltaChain
 */
export interface OptimizedDeltaChain {
    /** Information about each chain in the optimization */
    chains: DeltaChainInfo[];
    /** Total bytes saved by delta compression */
    totalSavings: number;
    /** Map of object SHA to base SHA for delta relationships */
    baseSelections: Map<string, string>;
}
/**
 * Information about a single delta chain.
 *
 * @interface DeltaChainInfo
 */
export interface DeltaChainInfo {
    /** SHA of the base object */
    baseSha: string;
    /** Type of the base object */
    baseType: PackObjectType;
    /** SHA of the delta object */
    objectSha: string;
    /** Type of the delta object */
    objectType: PackObjectType;
    /** Depth in the chain (0 = base, 1+ = delta) */
    depth: number;
    /** Bytes saved by using delta */
    savings: number;
}
/**
 * Available pack ordering strategies.
 *
 * @description Different ordering strategies affect delta compression efficiency
 * and pack structure. Choose based on your use case:
 * - TYPE_FIRST: Standard Git ordering, good for general use
 * - SIZE_DESCENDING: Optimizes for delta compression
 * - RECENCY: Useful for fetch operations
 * - PATH_BASED: Groups related files together
 * - DELTA_OPTIMIZED: Respects delta chain dependencies
 *
 * @enum {string}
 */
export declare enum PackOrderingStrategy {
    /** Groups objects by type (commits, trees, blobs, tags) */
    TYPE_FIRST = "type_first",
    /** Orders by size, largest first (better delta bases) */
    SIZE_DESCENDING = "size_descending",
    /** Orders by timestamp, newest first */
    RECENCY = "recency",
    /** Groups objects by file path */
    PATH_BASED = "path_based",
    /** Orders based on delta chain structure */
    DELTA_OPTIMIZED = "delta_optimized"
}
/**
 * Configuration for ordering strategy
 */
export interface OrderingStrategyConfig {
    primaryStrategy?: PackOrderingStrategy;
    secondaryStrategy?: PackOrderingStrategy;
    deltaChains?: Map<string, string>;
    preferSamePath?: boolean;
}
/**
 * Result of applying ordering strategy
 */
export interface OrderedObjectSet {
    objects: PackableObject[];
    orderingApplied: PackOrderingStrategy;
}
/**
 * Configuration for large repository handling
 */
export interface LargeRepoConfig {
    maxMemoryUsage?: number;
    chunkSize?: number;
    enableStreaming?: boolean;
    parallelDeltaComputation?: boolean;
    workerCount?: number;
}
/**
 * Options for incremental pack updates
 */
export interface IncrementalUpdateOptions {
    generateThinPack?: boolean;
    externalBases?: Set<string> | undefined;
    reuseDeltas?: boolean;
    reoptimizeDeltas?: boolean;
}
/**
 * Result of incremental pack update
 */
export interface IncrementalPackResult {
    packData: Uint8Array;
    addedObjects: number;
    skippedObjects: number;
    reusedDeltas: number;
    deltaReferences: string[];
    isThin: boolean;
    missingBases: string[];
}
/**
 * Result of pack diff computation
 */
export interface PackDiff {
    added: string[];
    removed: string[];
    unchanged: string[];
}
/**
 * Result of pack merge
 */
export interface MergedPack {
    objects: PackableObject[];
    stats: FullPackStats;
}
/**
 * Result of base selection
 */
export interface BaseSelectionResult {
    selections: Map<string, string>;
    savings: Map<string, number>;
}
/**
 * Object dependency graph
 */
export interface ObjectDependencyGraph {
    getDependencies(sha: string): string[];
    getDependents(sha: string): string[];
    hasCycles(): boolean;
    topologicalSort(): string[];
    nodes: string[];
    edges: Array<{
        from: string;
        to: string;
    }>;
}
/**
 * Result of pack validation
 */
export interface PackValidationResult {
    valid: boolean;
    errors: string[];
    stats?: PackValidationStats;
    deltaChainStats?: DeltaChainStats;
}
/**
 * Pack validation statistics
 */
export interface PackValidationStats {
    objectCount: number;
    headerValid: boolean;
    checksumValid: boolean;
}
/**
 * Delta chain statistics
 */
export interface DeltaChainStats {
    maxDepth: number;
    averageDepth: number;
    totalChains: number;
}
/**
 * Generates a complete packfile from an object set.
 *
 * @description Convenience function that creates a FullPackGenerator, adds
 * all objects from the set, and returns the complete packfile with checksum.
 *
 * @param {PackableObjectSet} objectSet - The set of objects to pack
 * @returns {Uint8Array} Complete packfile data including checksum
 *
 * @example
 * const objectSet = {
 *   objects: [blob1, blob2, tree, commit],
 *   roots: [commit.sha]
 * };
 * const packfile = generateFullPackfile(objectSet);
 */
export declare function generateFullPackfile(objectSet: PackableObjectSet): Uint8Array;
/**
 * Optimizes delta chains for a set of objects.
 *
 * @description Analyzes objects to find optimal delta base selections that
 * minimize total pack size while respecting chain depth limits.
 *
 * @param {PackableObject[]} objects - Objects to optimize
 * @param {DeltaChainConfig} [config] - Optimization configuration
 * @returns {OptimizedDeltaChain} Optimized chain information and selections
 *
 * @example
 * const result = optimizeDeltaChains(objects, { maxDepth: 50 });
 * console.log(`Saved ${result.totalSavings} bytes`);
 */
export declare function optimizeDeltaChains(objects: PackableObject[], config?: DeltaChainConfig): OptimizedDeltaChain;
/**
 * Applies an ordering strategy to objects for optimal packing.
 *
 * @description Reorders objects according to the specified strategy to
 * improve compression efficiency or access patterns.
 *
 * @param {PackableObject[]} objects - Objects to reorder
 * @param {PackOrderingStrategy} strategy - Ordering strategy to apply
 * @param {OrderingStrategyConfig} [config] - Additional configuration
 * @returns {OrderedObjectSet} Ordered objects with applied strategy info
 *
 * @example
 * const ordered = applyOrderingStrategy(
 *   objects,
 *   PackOrderingStrategy.TYPE_FIRST,
 *   { secondaryStrategy: PackOrderingStrategy.SIZE_DESCENDING }
 * );
 */
export declare function applyOrderingStrategy(objects: PackableObject[], strategy: PackOrderingStrategy, config?: OrderingStrategyConfig): OrderedObjectSet;
/**
 * Computes object dependencies from commit and tree references.
 *
 * @description Parses commit and tree objects to extract references,
 * building a dependency graph useful for ordering and validation.
 *
 * @param {PackableObject[]} objects - Objects to analyze
 * @returns {ObjectDependencyGraph} Dependency graph with traversal methods
 *
 * @example
 * const graph = computeObjectDependencies(objects);
 * const sorted = graph.topologicalSort();
 * if (graph.hasCycles()) {
 *   throw new Error('Circular dependencies detected');
 * }
 */
export declare function computeObjectDependencies(objects: PackableObject[]): ObjectDependencyGraph;
/**
 * Selects optimal base objects for delta compression.
 *
 * @description Analyzes all objects to find the best delta base for each,
 * computing actual delta savings to make informed selections.
 *
 * @param {PackableObject[]} objects - Objects to analyze
 * @param {{ preferSamePath?: boolean }} [options] - Selection options
 * @returns {BaseSelectionResult} Map of selections and savings
 *
 * @example
 * const result = selectOptimalBases(objects, { preferSamePath: true });
 * for (const [target, base] of result.selections) {
 *   console.log(`${target} -> ${base}: saves ${result.savings.get(target)} bytes`);
 * }
 */
export declare function selectOptimalBases(objects: PackableObject[], options?: {
    preferSamePath?: boolean;
}): BaseSelectionResult;
/**
 * Validates pack file integrity.
 *
 * @description Performs comprehensive validation of a packfile including:
 * - Header signature and version
 * - Object count verification
 * - Checksum validation
 * - Optional delta chain validation
 *
 * @param {Uint8Array} packData - Complete packfile data to validate
 * @param {{ validateDeltas?: boolean; collectStats?: boolean }} [options] - Validation options
 * @returns {PackValidationResult} Validation result with errors and optional stats
 * @throws {Error} Never throws; errors are returned in the result
 *
 * @example
 * const result = validatePackIntegrity(packData, { collectStats: true });
 * if (!result.valid) {
 *   console.error('Pack errors:', result.errors);
 * } else {
 *   console.log(`Valid pack with ${result.stats?.objectCount} objects`);
 * }
 */
export declare function validatePackIntegrity(packData: Uint8Array, options?: {
    validateDeltas?: boolean;
    collectStats?: boolean;
}): PackValidationResult;
/**
 * Full-featured pack generator with streaming and progress support.
 *
 * @description Advanced packfile generator that extends basic functionality with:
 * - Progress callbacks during generation
 * - Configurable ordering strategies
 * - Delta compression with chain optimization
 * - Validation of input objects
 *
 * @class FullPackGenerator
 *
 * @example
 * const generator = new FullPackGenerator({
 *   enableDeltaCompression: true,
 *   orderingStrategy: PackOrderingStrategy.TYPE_FIRST
 * });
 *
 * generator.onProgress((p) => {
 *   console.log(`Phase: ${p.phase}, Progress: ${p.objectsProcessed}/${p.totalObjects}`);
 * });
 *
 * for (const obj of objects) {
 *   generator.addObject(obj);
 * }
 *
 * const result = generator.generate();
 */
export declare class FullPackGenerator {
    private objects;
    private options;
    private progressCallback?;
    constructor(options?: FullPackOptions);
    get objectCount(): number;
    addObject(object: PackableObject): void;
    addObjectSet(objectSet: PackableObjectSet): void;
    onProgress(callback: (progress: PackGenerationProgress) => void): void;
    generate(): GeneratedFullPack;
    reset(): void;
    private reportProgress;
}
/**
 * Delta chain optimizer for finding optimal base selections.
 *
 * @description Analyzes a set of objects to determine the best delta base
 * for each, considering chain depth limits, similarity, and savings.
 *
 * @class DeltaChainOptimizer
 *
 * @example
 * const optimizer = new DeltaChainOptimizer({ maxDepth: 50 });
 * for (const obj of objects) {
 *   optimizer.addObject(obj);
 * }
 * const result = optimizer.optimize();
 */
export declare class DeltaChainOptimizer {
    private objects;
    private config;
    constructor(config?: DeltaChainConfig);
    addObject(object: PackableObject): void;
    buildGraph(): {
        nodes: PackableObject[];
        edges: Array<{
            from: string;
            to: string;
        }>;
    };
    computeSavings(): Map<string, number>;
    optimize(): OptimizedDeltaChain;
}
/**
 * Handler for large repositories with memory management.
 *
 * @description Provides memory-efficient pack generation for large repositories
 * by partitioning objects into chunks and optionally streaming output.
 *
 * @class LargeRepositoryHandler
 *
 * @example
 * const handler = new LargeRepositoryHandler({
 *   maxMemoryUsage: 500 * 1024 * 1024, // 500MB
 *   chunkSize: 1000,
 *   enableStreaming: true
 * });
 * handler.setObjects(largeObjectSet);
 * handler.onProgress((p) => console.log(p.phase));
 * const result = handler.generatePack();
 */
export declare class LargeRepositoryHandler {
    private objects;
    private config;
    private progressCallback?;
    private memoryCallback?;
    constructor(config?: LargeRepoConfig);
    setObjects(objects: PackableObject[]): void;
    onProgress(callback: (progress: PackGenerationProgress) => void): void;
    onMemoryUsage(callback: (usage: number) => void): void;
    partitionObjects(objects: PackableObject[]): PackableObject[][];
    generatePack(): GeneratedFullPack;
}
/**
 * Streaming pack writer for incremental output.
 *
 * @description Writes packfile data incrementally, suitable for streaming
 * to network or disk without holding entire pack in memory.
 *
 * @class StreamingPackWriter
 *
 * @example
 * const writer = new StreamingPackWriter();
 * writer.onChunk((chunk) => socket.write(chunk));
 * writer.writeHeader(objects.length);
 * for (const obj of objects) {
 *   writer.writeObject(obj);
 * }
 * await writer.finalize();
 */
export declare class StreamingPackWriter {
    private chunkCallback?;
    private outputStream;
    private chunks;
    private objectCount;
    private expectedCount;
    constructor(options?: {
        outputStream?: {
            write: (chunk: Uint8Array) => Promise<void>;
        };
        highWaterMark?: number;
    });
    onChunk(callback: (chunk: Uint8Array) => void): void;
    writeHeader(objectCount: number): void;
    writeObject(object: PackableObject): void;
    finalize(): Promise<void>;
    private emitChunk;
}
/**
 * Incremental pack updater for adding new objects to existing packs.
 *
 * @description Efficiently creates packs containing only new objects while
 * optionally reusing delta relationships with existing objects.
 *
 * @class IncrementalPackUpdater
 *
 * @example
 * const updater = new IncrementalPackUpdater({ reuseDeltas: true });
 * updater.setExistingObjects(existingPack);
 * const result = updater.addObjects(newObjects);
 * console.log(`Added ${result.addedObjects}, skipped ${result.skippedObjects}`);
 */
export declare class IncrementalPackUpdater {
    private existingObjects;
    private existingShas;
    private options;
    constructor(options?: IncrementalUpdateOptions);
    setExistingObjects(objects: PackableObject[]): void;
    addObjects(newObjects: PackableObject[]): IncrementalPackResult;
    computeDiff(oldObjects: PackableObject[], newObjects: PackableObject[]): PackDiff;
    mergePacks(packs: PackableObject[][]): MergedPack;
}
//# sourceMappingURL=full-generation.d.ts.map