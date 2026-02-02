/**
 * @fileoverview R2 Path Utilities
 *
 * This module provides utilities for converting between R2 URL schemes
 * and R2 bucket paths. Used by Iceberg catalog and table manager for
 * consistent path handling.
 *
 * R2 paths typically follow the pattern:
 * - r2://bucket-name/path/to/object -> path/to/object (with optional prefix)
 * - Direct paths are returned as-is
 *
 * @module utils/r2-path
 *
 * @example
 * ```typescript
 * import { r2PathFromLocation, r2PathWithPrefix } from './utils/r2-path'
 *
 * // Convert r2:// URL to bucket path
 * const path = r2PathFromLocation('r2://my-bucket/data/file.parquet')
 * // Returns: 'data/file.parquet'
 *
 * // With prefix
 * const prefixedPath = r2PathWithPrefix('r2://my-bucket/data/file.parquet', 'analytics')
 * // Returns: 'analytics/data/file.parquet'
 * ```
 */

/**
 * Converts an R2 location URL to a bucket path.
 *
 * @description
 * Handles conversion of r2:// scheme URLs to standard bucket paths.
 * If the location doesn't use the r2:// scheme, it's returned as-is.
 *
 * The function strips the `r2://bucket-name/` prefix from the URL,
 * leaving only the path within the bucket.
 *
 * @param location - The R2 location URL or direct path
 * @returns The bucket path (without r2://bucket-name prefix)
 *
 * @example
 * ```typescript
 * // Convert r2:// URL
 * r2PathFromLocation('r2://my-bucket/data/file.parquet')
 * // Returns: 'data/file.parquet'
 *
 * // Direct path returned as-is
 * r2PathFromLocation('data/file.parquet')
 * // Returns: 'data/file.parquet'
 *
 * // Handles nested paths
 * r2PathFromLocation('r2://analytics-bucket/owner/repo/objects/file.parquet')
 * // Returns: 'owner/repo/objects/file.parquet'
 * ```
 */
export function r2PathFromLocation(location: string): string {
  if (location.startsWith('r2://')) {
    // Remove r2://bucket-name/ prefix, keeping only the path
    return location.replace(/^r2:\/\/[^/]+\//, '')
  }
  return location
}

/**
 * Converts an R2 location URL to a bucket path with an optional prefix.
 *
 * @description
 * Similar to `r2PathFromLocation`, but also prepends a prefix to the
 * resulting path if provided. This is useful when multiple services
 * share a bucket and need to namespace their objects.
 *
 * @param location - The R2 location URL or direct path
 * @param prefix - Optional prefix to prepend to the path
 * @returns The bucket path with optional prefix prepended
 *
 * @example
 * ```typescript
 * // With prefix
 * r2PathWithPrefix('r2://bucket/data/file.parquet', 'analytics')
 * // Returns: 'analytics/data/file.parquet'
 *
 * // Without prefix (empty string or undefined)
 * r2PathWithPrefix('r2://bucket/data/file.parquet', '')
 * // Returns: 'data/file.parquet'
 *
 * // Direct path with prefix
 * r2PathWithPrefix('data/file.parquet', 'analytics')
 * // Returns: 'analytics/data/file.parquet'
 * ```
 */
export function r2PathWithPrefix(location: string, prefix?: string): string {
  const path = r2PathFromLocation(location)
  return prefix ? `${prefix}/${path}` : path
}

/**
 * Creates a prefixed path helper function.
 *
 * @description
 * Factory function that creates a path converter with a bound prefix.
 * Useful when multiple paths need to be converted with the same prefix.
 *
 * @param prefix - The prefix to use for all path conversions
 * @returns A function that converts locations to bucket paths with the prefix
 *
 * @example
 * ```typescript
 * // Create a prefixed converter
 * const toPath = createR2PathConverter('analytics')
 *
 * // Use it for multiple conversions
 * toPath('r2://bucket/data/file1.parquet') // 'analytics/data/file1.parquet'
 * toPath('r2://bucket/data/file2.parquet') // 'analytics/data/file2.parquet'
 * ```
 */
export function createR2PathConverter(prefix?: string): (location: string) => string {
  return (location: string) => r2PathWithPrefix(location, prefix)
}
