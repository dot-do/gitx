/**
 * Git Packfile Generation
 *
 * This module provides packfile generation capabilities including:
 * - Pack generation from object sets
 * - Delta compression (OFS_DELTA, REF_DELTA)
 * - Proper PACK header with signature, version, object count
 * - SHA-1 checksum at end of pack
 * - Variable-length integer encoding for sizes
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
}
/**
 * A delta object that references an external base
 */
export interface DeltaObject {
    sha: string;
    type: PackObjectType;
    baseSha: string;
    delta: Uint8Array;
}
/**
 * Options for pack generation
 */
export interface GeneratorOptions {
    enableDeltaCompression?: boolean;
    maxDeltaDepth?: number;
    windowSize?: number;
    compressionLevel?: number;
    useRefDelta?: boolean;
    minDeltaSize?: number;
}
/**
 * Statistics from pack generation
 */
export interface PackGenerationStats {
    totalObjects: number;
    deltaObjects: number;
    totalSize: number;
    compressedSize: number;
    maxDeltaDepth: number;
    generationTimeMs: number;
}
/**
 * Result of pack generation
 */
export interface GeneratedPackfile {
    packData: Uint8Array;
    checksum: Uint8Array;
    stats: PackGenerationStats;
}
/**
 * A candidate for delta base selection
 */
export interface DeltaCandidate {
    sha: string;
    type: PackObjectType;
    data: Uint8Array;
}
/**
 * Options for thin pack generation
 */
export interface ThinPackOptions {
    externalObjects: Set<string>;
    baseData?: Map<string, Uint8Array>;
}
/**
 * Result of thin pack generation
 */
export interface ThinPackResult {
    packData: Uint8Array;
    checksum: Uint8Array;
    isThin: boolean;
    missingBases: string[];
    stats: PackGenerationStats;
}
/**
 * Compute SHA-1 checksum of pack content
 */
export declare function computePackChecksum(data: Uint8Array): Uint8Array;
/**
 * Order objects for optimal compression
 * Groups by type, then sorts by size (larger first for better delta bases)
 */
export declare function orderObjectsForCompression(objects: PackableObject[]): PackableObject[];
/**
 * Select the best delta base from candidates
 */
export declare function selectDeltaBase(target: DeltaCandidate, candidates: DeltaCandidate[]): DeltaCandidate | null;
export declare class PackfileGenerator {
    private objects;
    private deltaObjects;
    private options;
    constructor(options?: GeneratorOptions);
    get objectCount(): number;
    addObject(object: PackableObject): void;
    addDeltaObject(deltaObj: DeltaObject): void;
    reset(): void;
    generate(): GeneratedPackfile;
}
/**
 * Generate a packfile from an array of objects
 * Returns a complete packfile with trailing SHA-1 checksum
 */
export declare function generatePackfile(objects: PackableObject[]): Uint8Array;
/**
 * Generate a thin pack that can reference external objects
 */
export declare function generateThinPack(objects: PackableObject[], options: ThinPackOptions): ThinPackResult;
//# sourceMappingURL=generation.d.ts.map