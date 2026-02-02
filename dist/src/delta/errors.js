/**
 * @fileoverview Custom error types for the delta layer.
 *
 * @module delta/errors
 */
export class DeltaError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DeltaError';
    }
}
export class DeltaVersionError extends DeltaError {
    version;
    maxVersion;
    constructor(version, maxVersion) {
        super(`Invalid version ${version}: max is ${maxVersion}`);
        this.version = version;
        this.maxVersion = maxVersion;
        this.name = 'DeltaVersionError';
    }
}
//# sourceMappingURL=errors.js.map