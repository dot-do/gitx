/**
 * @fileoverview Custom error types for the delta layer.
 *
 * @module delta/errors
 */
export declare class DeltaError extends Error {
    constructor(message: string);
}
export declare class DeltaVersionError extends DeltaError {
    readonly version: number;
    readonly maxVersion: number;
    constructor(version: number, maxVersion: number);
}
//# sourceMappingURL=errors.d.ts.map