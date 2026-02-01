/**
 * @fileoverview Custom error types for the delta layer.
 *
 * @module delta/errors
 */

export class DeltaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeltaError'
  }
}

export class DeltaVersionError extends DeltaError {
  constructor(
    public readonly version: number,
    public readonly maxVersion: number,
  ) {
    super(`Invalid version ${version}: max is ${maxVersion}`)
    this.name = 'DeltaVersionError'
  }
}
