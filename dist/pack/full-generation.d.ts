/**
 * Full Packfile Generation
 *
 * This module provides comprehensive packfile generation capabilities including:
 * - Complete pack generation from object sets
 * - Delta chain optimization
 * - Pack ordering strategies
 * - Large repository handling
 * - Incremental pack updates
 */
import { PackObjectType } from './format';
/**
 * An object that can be packed
 */
export interface PackableObject {
    sha: string;
    type: PackObjectType;
    data: Uint8Array;
    path?: string;
    timestamp?: number;
}
/**
 * A set of objects to be packed
 */
export interface PackableObjectSet {
    objects: PackableObject[];
    roots?: string[];
}
/**
 * Options for full pack generation
 */
export interface FullPackOptions {
    enableDeltaCompression?: boolean;
    maxDeltaDepth?: number;
    windowSize?: number;
    compressionLevel?: number;
    orderingStrategy?: PackOrderingStrategy;
}
/**
 * Result of full pack generation
 */
export interface GeneratedFullPack {
    packData: Uint8Array;
    checksum: Uint8Array;
    stats: FullPackStats;
}
/**
 * Statistics from pack generation
 */
export interface FullPackStats {
    totalObjects: number;
    deltaObjects: number;
    totalSize: number;
    compressedSize: number;
    compressionRatio: number;
    maxDeltaDepth: number;
    generationTimeMs: number;
}
/**
 * Progress information during pack generation
 */
export interface PackGenerationProgress {
    phase: 'scanning' | 'sorting' | 'compressing' | 'writing' | 'complete';
    objectsProcessed: number;
    totalObjects: number;
    bytesWritten: number;
    currentObject?: string;
}
/**
 * Configuration for delta chain optimization
 */
export interface DeltaChainConfig {
    maxDepth?: number;
    minSavingsThreshold?: number;
    windowSize?: number;
    minMatchLength?: number;
}
/**
 * Result of delta chain optimization
 */
export interface OptimizedDeltaChain {
    chains: DeltaChainInfo[];
    totalSavings: number;
    baseSelections: Map<string, string>;
}
/**
 * Information about a single delta chain
 */
export interface DeltaChainInfo {
    baseSha: string;
    baseType: PackObjectType;
    objectSha: string;
    objectType: PackObjectType;
    depth: number;
    savings: number;
}
/**
 * Pack ordering strategies
 */
export declare enum PackOrderingStrategy {
    TYPE_FIRST = "type_first",
    SIZE_DESCENDING = "size_descending",
    RECENCY = "recency",
    PATH_BASED = "path_based",
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
    externalBases?: Set<string>;
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
 * Generate a complete packfile from an object set
 */
export declare function generateFullPackfile(objectSet: PackableObjectSet): Uint8Array;
/**
 * Optimize delta chains for a set of objects
 */
export declare function optimizeDeltaChains(objects: PackableObject[], config?: DeltaChainConfig): OptimizedDeltaChain;
/**
 * Apply an ordering strategy to objects
 */
export declare function applyOrderingStrategy(objects: PackableObject[], strategy: PackOrderingStrategy, config?: OrderingStrategyConfig): OrderedObjectSet;
/**
 * Compute object dependencies
 */
export declare function computeObjectDependencies(objects: PackableObject[]): ObjectDependencyGraph;
/**
 * Select optimal base objects for delta compression
 */
export declare function selectOptimalBases(objects: PackableObject[], options?: {
    preferSamePath?: boolean;
}): BaseSelectionResult;
/**
 * Validate pack integrity
 */
export declare function validatePackIntegrity(packData: Uint8Array, options?: {
    validateDeltas?: boolean;
    collectStats?: boolean;
}): PackValidationResult;
/**
 * Full pack generator with streaming and progress support
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
 * Delta chain optimizer
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
 * Handler for large repositories
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
 * Streaming pack writer
 */
export declare class StreamingPackWriter {
    private chunkCallback?;
    private outputStream?;
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
 * Incremental pack updater
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