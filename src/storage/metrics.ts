/**
 * @fileoverview Storage Metrics Interface for Observability
 *
 * Provides a pluggable metrics interface for observing storage operations.
 * Implementations can emit metrics to various backends:
 * - NoopMetrics: Default no-op implementation (no overhead)
 * - ConsoleMetrics: Logs to console for development/testing
 * - CloudflareAnalytics: Emits to Cloudflare Analytics Engine
 *
 * @module storage/metrics
 *
 * @example
 * ```typescript
 * import { StorageMetrics, ConsoleMetrics } from 'gitx.do/storage'
 *
 * // Create a metrics instance
 * const metrics = new ConsoleMetrics()
 *
 * // Pass to ParquetStore
 * const store = new ParquetStore({ r2, sql, prefix, metrics })
 *
 * // Or use in custom code
 * const start = performance.now()
 * const obj = await store.getObject(sha)
 * metrics.recordObjectRead(sha, obj ? 'hit' : 'miss', performance.now() - start)
 * ```
 */

import type { ObjectType } from '../types/objects'

// ============================================================================
// Types
// ============================================================================

/**
 * Storage tier where an object was found or written.
 */
export type StorageTier = 'buffer' | 'cache' | 'parquet' | 'r2'

/**
 * Result of a cache lookup operation.
 */
export type CacheResult = 'hit' | 'miss'

/**
 * Operation type for generic timing metrics.
 */
export type StorageOperation =
  | 'read'
  | 'write'
  | 'delete'
  | 'flush'
  | 'compact'
  | 'initialize'
  | 'bloom_check'

// ============================================================================
// StorageMetrics Interface
// ============================================================================

/**
 * Interface for observing storage operations.
 *
 * @description
 * Implementations of this interface can be used to collect metrics, log
 * operations, or emit events for external observability systems. All methods
 * are synchronous and should not throw errors - metrics collection should
 * never impact storage operations.
 *
 * @example
 * ```typescript
 * class MyMetrics implements StorageMetrics {
 *   recordObjectRead(sha, tier, latencyMs) {
 *     myStatsBackend.histogram('storage.read.latency', latencyMs, { tier })
 *   }
 *   // ... other methods
 * }
 * ```
 */
export interface StorageMetrics {
  /**
   * Record a successful object read operation.
   *
   * @param sha - The SHA-1 hash of the object that was read
   * @param tier - The storage tier where the object was found
   * @param latencyMs - Time taken to complete the read in milliseconds
   * @param objectType - Optional type of the object (blob, tree, commit, tag)
   * @param sizeBytes - Optional size of the object in bytes
   */
  recordObjectRead(
    sha: string,
    tier: StorageTier,
    latencyMs: number,
    objectType?: ObjectType,
    sizeBytes?: number
  ): void

  /**
   * Record a successful object write operation.
   *
   * @param sha - The SHA-1 hash of the object that was written
   * @param sizeBytes - Size of the object in bytes
   * @param tier - The storage tier where the object was written
   * @param latencyMs - Time taken to complete the write in milliseconds
   * @param objectType - Optional type of the object
   */
  recordObjectWrite(
    sha: string,
    sizeBytes: number,
    tier: StorageTier,
    latencyMs: number,
    objectType?: ObjectType
  ): void

  /**
   * Record a cache hit (object found in cache/buffer).
   *
   * @param sha - The SHA-1 hash of the object
   * @param cacheType - Type of cache: 'bloom' for bloom filter, 'exact' for exact cache, 'buffer' for write buffer
   */
  recordCacheHit(sha: string, cacheType: 'bloom' | 'exact' | 'buffer'): void

  /**
   * Record a cache miss (object not found in cache/buffer).
   *
   * @param sha - The SHA-1 hash of the object
   * @param cacheType - Type of cache that was checked
   */
  recordCacheMiss(sha: string, cacheType: 'bloom' | 'exact' | 'buffer'): void

  /**
   * Record a flush operation (buffered objects written to Parquet).
   *
   * @param objectCount - Number of objects flushed
   * @param sizeBytes - Total size of the Parquet file in bytes
   * @param latencyMs - Time taken to complete the flush in milliseconds
   */
  recordFlush(objectCount: number, sizeBytes: number, latencyMs: number): void

  /**
   * Record a compaction operation.
   *
   * @param sourceFileCount - Number of source Parquet files compacted
   * @param resultObjectCount - Number of objects in the compacted file
   * @param resultSizeBytes - Size of the compacted Parquet file
   * @param latencyMs - Time taken to complete compaction in milliseconds
   */
  recordCompaction(
    sourceFileCount: number,
    resultObjectCount: number,
    resultSizeBytes: number,
    latencyMs: number
  ): void

  /**
   * Record an error during a storage operation.
   *
   * @param operation - The operation that failed
   * @param error - The error that occurred
   * @param context - Optional additional context (e.g., SHA, file key)
   */
  recordError(
    operation: StorageOperation,
    error: Error,
    context?: Record<string, unknown>
  ): void

  /**
   * Record a generic timing metric.
   *
   * @param operation - The operation being timed
   * @param latencyMs - Time taken in milliseconds
   * @param labels - Optional labels for the metric
   */
  recordTiming(
    operation: StorageOperation,
    latencyMs: number,
    labels?: Record<string, string | number>
  ): void

  /**
   * Record a counter metric.
   *
   * @param name - Name of the counter
   * @param value - Value to add (default 1)
   * @param labels - Optional labels for the metric
   */
  recordCounter(
    name: string,
    value?: number,
    labels?: Record<string, string | number>
  ): void

  /**
   * Record a gauge metric (current value).
   *
   * @param name - Name of the gauge
   * @param value - Current value
   * @param labels - Optional labels for the metric
   */
  recordGauge(
    name: string,
    value: number,
    labels?: Record<string, string | number>
  ): void
}

// ============================================================================
// NoopMetrics Implementation
// ============================================================================

/**
 * No-op metrics implementation.
 *
 * @description
 * Default implementation that does nothing. Use this when metrics collection
 * is not needed or in production for minimal overhead. All methods are empty
 * and inlined by V8.
 */
export class NoopMetrics implements StorageMetrics {
  recordObjectRead(): void {
    // No-op
  }

  recordObjectWrite(): void {
    // No-op
  }

  recordCacheHit(): void {
    // No-op
  }

  recordCacheMiss(): void {
    // No-op
  }

  recordFlush(): void {
    // No-op
  }

  recordCompaction(): void {
    // No-op
  }

  recordError(): void {
    // No-op
  }

  recordTiming(): void {
    // No-op
  }

  recordCounter(): void {
    // No-op
  }

  recordGauge(): void {
    // No-op
  }
}

// ============================================================================
// ConsoleMetrics Implementation
// ============================================================================

/**
 * Console logging metrics implementation.
 *
 * @description
 * Logs all metrics to the console for development and debugging purposes.
 * Includes optional filtering and formatting options.
 *
 * @example
 * ```typescript
 * const metrics = new ConsoleMetrics({
 *   prefix: '[GitX]',
 *   logLevel: 'debug',
 *   filter: (op) => op !== 'bloom_check' // Skip noisy bloom checks
 * })
 * ```
 */
export interface ConsoleMetricsOptions {
  /**
   * Prefix for all log messages.
   * @default '[StorageMetrics]'
   */
  prefix?: string

  /**
   * Log level to use.
   * @default 'debug'
   */
  logLevel?: 'debug' | 'info' | 'warn'

  /**
   * Optional filter function. Return false to skip logging.
   */
  filter?: (operation: string, data: Record<string, unknown>) => boolean

  /**
   * Include timestamps in log output.
   * @default true
   */
  includeTimestamp?: boolean
}

export class ConsoleMetrics implements StorageMetrics {
  private prefix: string
  private logLevel: 'debug' | 'info' | 'warn'
  private filter?: (operation: string, data: Record<string, unknown>) => boolean
  private includeTimestamp: boolean

  constructor(options?: ConsoleMetricsOptions) {
    this.prefix = options?.prefix ?? '[StorageMetrics]'
    this.logLevel = options?.logLevel ?? 'debug'
    this.filter = options?.filter
    this.includeTimestamp = options?.includeTimestamp ?? true
  }

  private log(operation: string, data: Record<string, unknown>): void {
    if (this.filter && !this.filter(operation, data)) {
      return
    }

    const timestamp = this.includeTimestamp ? `[${new Date().toISOString()}]` : ''
    const message = `${timestamp} ${this.prefix} ${operation}`
    const logFn = this.logLevel === 'warn' ? console.warn : this.logLevel === 'info' ? console.info : console.debug

    logFn(message, data)
  }

  recordObjectRead(
    sha: string,
    tier: StorageTier,
    latencyMs: number,
    objectType?: ObjectType,
    sizeBytes?: number
  ): void {
    this.log('object_read', {
      sha: sha.slice(0, 8),
      tier,
      latencyMs: latencyMs.toFixed(2),
      objectType,
      sizeBytes,
    })
  }

  recordObjectWrite(
    sha: string,
    sizeBytes: number,
    tier: StorageTier,
    latencyMs: number,
    objectType?: ObjectType
  ): void {
    this.log('object_write', {
      sha: sha.slice(0, 8),
      sizeBytes,
      tier,
      latencyMs: latencyMs.toFixed(2),
      objectType,
    })
  }

  recordCacheHit(sha: string, cacheType: 'bloom' | 'exact' | 'buffer'): void {
    this.log('cache_hit', {
      sha: sha.slice(0, 8),
      cacheType,
    })
  }

  recordCacheMiss(sha: string, cacheType: 'bloom' | 'exact' | 'buffer'): void {
    this.log('cache_miss', {
      sha: sha.slice(0, 8),
      cacheType,
    })
  }

  recordFlush(objectCount: number, sizeBytes: number, latencyMs: number): void {
    this.log('flush', {
      objectCount,
      sizeBytes,
      latencyMs: latencyMs.toFixed(2),
    })
  }

  recordCompaction(
    sourceFileCount: number,
    resultObjectCount: number,
    resultSizeBytes: number,
    latencyMs: number
  ): void {
    this.log('compaction', {
      sourceFileCount,
      resultObjectCount,
      resultSizeBytes,
      latencyMs: latencyMs.toFixed(2),
    })
  }

  recordError(
    operation: StorageOperation,
    error: Error,
    context?: Record<string, unknown>
  ): void {
    this.log('error', {
      operation,
      error: error.message,
      stack: error.stack?.split('\n').slice(0, 3).join('\n'),
      ...context,
    })
  }

  recordTiming(
    operation: StorageOperation,
    latencyMs: number,
    labels?: Record<string, string | number>
  ): void {
    this.log('timing', {
      operation,
      latencyMs: latencyMs.toFixed(2),
      ...labels,
    })
  }

  recordCounter(
    name: string,
    value = 1,
    labels?: Record<string, string | number>
  ): void {
    this.log('counter', {
      name,
      value,
      ...labels,
    })
  }

  recordGauge(
    name: string,
    value: number,
    labels?: Record<string, string | number>
  ): void {
    this.log('gauge', {
      name,
      value,
      ...labels,
    })
  }
}

// ============================================================================
// CollectingMetrics Implementation
// ============================================================================

/**
 * Metrics implementation that collects data in memory for testing.
 *
 * @description
 * Stores all metrics in memory for later inspection. Useful for testing
 * that storage operations emit the expected metrics.
 *
 * @example
 * ```typescript
 * const metrics = new CollectingMetrics()
 * await store.putObject('blob', data)
 * expect(metrics.writes).toHaveLength(1)
 * expect(metrics.writes[0].tier).toBe('buffer')
 * ```
 */
export interface CollectedRead {
  sha: string
  tier: StorageTier
  latencyMs: number
  objectType?: ObjectType
  sizeBytes?: number
  timestamp: number
}

export interface CollectedWrite {
  sha: string
  sizeBytes: number
  tier: StorageTier
  latencyMs: number
  objectType?: ObjectType
  timestamp: number
}

export interface CollectedCacheEvent {
  sha: string
  cacheType: 'bloom' | 'exact' | 'buffer'
  hit: boolean
  timestamp: number
}

export interface CollectedFlush {
  objectCount: number
  sizeBytes: number
  latencyMs: number
  timestamp: number
}

export interface CollectedCompaction {
  sourceFileCount: number
  resultObjectCount: number
  resultSizeBytes: number
  latencyMs: number
  timestamp: number
}

export interface CollectedError {
  operation: StorageOperation
  error: Error
  context?: Record<string, unknown>
  timestamp: number
}

export interface CollectedTiming {
  operation: StorageOperation
  latencyMs: number
  labels?: Record<string, string | number>
  timestamp: number
}

export interface CollectedCounter {
  name: string
  value: number
  labels?: Record<string, string | number>
  timestamp: number
}

export interface CollectedGauge {
  name: string
  value: number
  labels?: Record<string, string | number>
  timestamp: number
}

export class CollectingMetrics implements StorageMetrics {
  readonly reads: CollectedRead[] = []
  readonly writes: CollectedWrite[] = []
  readonly cacheEvents: CollectedCacheEvent[] = []
  readonly flushes: CollectedFlush[] = []
  readonly compactions: CollectedCompaction[] = []
  readonly errors: CollectedError[] = []
  readonly timings: CollectedTiming[] = []
  readonly counters: CollectedCounter[] = []
  readonly gauges: CollectedGauge[] = []

  recordObjectRead(
    sha: string,
    tier: StorageTier,
    latencyMs: number,
    objectType?: ObjectType,
    sizeBytes?: number
  ): void {
    this.reads.push({
      sha,
      tier,
      latencyMs,
      objectType,
      sizeBytes,
      timestamp: Date.now(),
    })
  }

  recordObjectWrite(
    sha: string,
    sizeBytes: number,
    tier: StorageTier,
    latencyMs: number,
    objectType?: ObjectType
  ): void {
    this.writes.push({
      sha,
      sizeBytes,
      tier,
      latencyMs,
      objectType,
      timestamp: Date.now(),
    })
  }

  recordCacheHit(sha: string, cacheType: 'bloom' | 'exact' | 'buffer'): void {
    this.cacheEvents.push({
      sha,
      cacheType,
      hit: true,
      timestamp: Date.now(),
    })
  }

  recordCacheMiss(sha: string, cacheType: 'bloom' | 'exact' | 'buffer'): void {
    this.cacheEvents.push({
      sha,
      cacheType,
      hit: false,
      timestamp: Date.now(),
    })
  }

  recordFlush(objectCount: number, sizeBytes: number, latencyMs: number): void {
    this.flushes.push({
      objectCount,
      sizeBytes,
      latencyMs,
      timestamp: Date.now(),
    })
  }

  recordCompaction(
    sourceFileCount: number,
    resultObjectCount: number,
    resultSizeBytes: number,
    latencyMs: number
  ): void {
    this.compactions.push({
      sourceFileCount,
      resultObjectCount,
      resultSizeBytes,
      latencyMs,
      timestamp: Date.now(),
    })
  }

  recordError(
    operation: StorageOperation,
    error: Error,
    context?: Record<string, unknown>
  ): void {
    this.errors.push({
      operation,
      error,
      context,
      timestamp: Date.now(),
    })
  }

  recordTiming(
    operation: StorageOperation,
    latencyMs: number,
    labels?: Record<string, string | number>
  ): void {
    this.timings.push({
      operation,
      latencyMs,
      labels,
      timestamp: Date.now(),
    })
  }

  recordCounter(
    name: string,
    value = 1,
    labels?: Record<string, string | number>
  ): void {
    this.counters.push({
      name,
      value,
      labels,
      timestamp: Date.now(),
    })
  }

  recordGauge(
    name: string,
    value: number,
    labels?: Record<string, string | number>
  ): void {
    this.gauges.push({
      name,
      value,
      labels,
      timestamp: Date.now(),
    })
  }

  /**
   * Clear all collected metrics.
   */
  clear(): void {
    this.reads.length = 0
    this.writes.length = 0
    this.cacheEvents.length = 0
    this.flushes.length = 0
    this.compactions.length = 0
    this.errors.length = 0
    this.timings.length = 0
    this.counters.length = 0
    this.gauges.length = 0
  }

  /**
   * Get cache hits for a specific cache type.
   */
  getCacheHits(cacheType?: 'bloom' | 'exact' | 'buffer'): CollectedCacheEvent[] {
    return this.cacheEvents.filter(
      e => e.hit && (cacheType === undefined || e.cacheType === cacheType)
    )
  }

  /**
   * Get cache misses for a specific cache type.
   */
  getCacheMisses(cacheType?: 'bloom' | 'exact' | 'buffer'): CollectedCacheEvent[] {
    return this.cacheEvents.filter(
      e => !e.hit && (cacheType === undefined || e.cacheType === cacheType)
    )
  }

  /**
   * Calculate average latency for reads.
   */
  getAverageReadLatency(): number {
    if (this.reads.length === 0) return 0
    return this.reads.reduce((sum, r) => sum + r.latencyMs, 0) / this.reads.length
  }

  /**
   * Calculate average latency for writes.
   */
  getAverageWriteLatency(): number {
    if (this.writes.length === 0) return 0
    return this.writes.reduce((sum, w) => sum + w.latencyMs, 0) / this.writes.length
  }

  /**
   * Get total bytes written.
   */
  getTotalBytesWritten(): number {
    return this.writes.reduce((sum, w) => sum + w.sizeBytes, 0)
  }

  /**
   * Get summary statistics.
   */
  getSummary(): {
    totalReads: number
    totalWrites: number
    totalFlushes: number
    totalCompactions: number
    totalErrors: number
    cacheHitRate: number
    avgReadLatencyMs: number
    avgWriteLatencyMs: number
    totalBytesWritten: number
  } {
    const hits = this.cacheEvents.filter(e => e.hit).length
    const total = this.cacheEvents.length

    return {
      totalReads: this.reads.length,
      totalWrites: this.writes.length,
      totalFlushes: this.flushes.length,
      totalCompactions: this.compactions.length,
      totalErrors: this.errors.length,
      cacheHitRate: total > 0 ? hits / total : 0,
      avgReadLatencyMs: this.getAverageReadLatency(),
      avgWriteLatencyMs: this.getAverageWriteLatency(),
      totalBytesWritten: this.getTotalBytesWritten(),
    }
  }
}

// ============================================================================
// Default Instance
// ============================================================================

/**
 * Default no-op metrics instance.
 *
 * Use this when you don't need metrics collection.
 */
export const NOOP_METRICS: StorageMetrics = new NoopMetrics()

/**
 * @deprecated Use NOOP_METRICS instead. This alias is provided for backward compatibility.
 */
export const noopMetrics = NOOP_METRICS
