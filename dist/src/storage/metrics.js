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
export class NoopMetrics {
    recordObjectRead() {
        // No-op
    }
    recordObjectWrite() {
        // No-op
    }
    recordCacheHit() {
        // No-op
    }
    recordCacheMiss() {
        // No-op
    }
    recordFlush() {
        // No-op
    }
    recordCompaction() {
        // No-op
    }
    recordError() {
        // No-op
    }
    recordTiming() {
        // No-op
    }
    recordCounter() {
        // No-op
    }
    recordGauge() {
        // No-op
    }
}
export class ConsoleMetrics {
    prefix;
    logLevel;
    filter;
    includeTimestamp;
    constructor(options) {
        this.prefix = options?.prefix ?? '[StorageMetrics]';
        this.logLevel = options?.logLevel ?? 'debug';
        this.filter = options?.filter;
        this.includeTimestamp = options?.includeTimestamp ?? true;
    }
    log(operation, data) {
        if (this.filter && !this.filter(operation, data)) {
            return;
        }
        const timestamp = this.includeTimestamp ? `[${new Date().toISOString()}]` : '';
        const message = `${timestamp} ${this.prefix} ${operation}`;
        const logFn = this.logLevel === 'warn' ? console.warn : this.logLevel === 'info' ? console.info : console.debug;
        logFn(message, data);
    }
    recordObjectRead(sha, tier, latencyMs, objectType, sizeBytes) {
        this.log('object_read', {
            sha: sha.slice(0, 8),
            tier,
            latencyMs: latencyMs.toFixed(2),
            objectType,
            sizeBytes,
        });
    }
    recordObjectWrite(sha, sizeBytes, tier, latencyMs, objectType) {
        this.log('object_write', {
            sha: sha.slice(0, 8),
            sizeBytes,
            tier,
            latencyMs: latencyMs.toFixed(2),
            objectType,
        });
    }
    recordCacheHit(sha, cacheType) {
        this.log('cache_hit', {
            sha: sha.slice(0, 8),
            cacheType,
        });
    }
    recordCacheMiss(sha, cacheType) {
        this.log('cache_miss', {
            sha: sha.slice(0, 8),
            cacheType,
        });
    }
    recordFlush(objectCount, sizeBytes, latencyMs) {
        this.log('flush', {
            objectCount,
            sizeBytes,
            latencyMs: latencyMs.toFixed(2),
        });
    }
    recordCompaction(sourceFileCount, resultObjectCount, resultSizeBytes, latencyMs) {
        this.log('compaction', {
            sourceFileCount,
            resultObjectCount,
            resultSizeBytes,
            latencyMs: latencyMs.toFixed(2),
        });
    }
    recordError(operation, error, context) {
        this.log('error', {
            operation,
            error: error.message,
            stack: error.stack?.split('\n').slice(0, 3).join('\n'),
            ...context,
        });
    }
    recordTiming(operation, latencyMs, labels) {
        this.log('timing', {
            operation,
            latencyMs: latencyMs.toFixed(2),
            ...labels,
        });
    }
    recordCounter(name, value = 1, labels) {
        this.log('counter', {
            name,
            value,
            ...labels,
        });
    }
    recordGauge(name, value, labels) {
        this.log('gauge', {
            name,
            value,
            ...labels,
        });
    }
}
export class CollectingMetrics {
    reads = [];
    writes = [];
    cacheEvents = [];
    flushes = [];
    compactions = [];
    errors = [];
    timings = [];
    counters = [];
    gauges = [];
    recordObjectRead(sha, tier, latencyMs, objectType, sizeBytes) {
        this.reads.push({
            sha,
            tier,
            latencyMs,
            objectType,
            sizeBytes,
            timestamp: Date.now(),
        });
    }
    recordObjectWrite(sha, sizeBytes, tier, latencyMs, objectType) {
        this.writes.push({
            sha,
            sizeBytes,
            tier,
            latencyMs,
            objectType,
            timestamp: Date.now(),
        });
    }
    recordCacheHit(sha, cacheType) {
        this.cacheEvents.push({
            sha,
            cacheType,
            hit: true,
            timestamp: Date.now(),
        });
    }
    recordCacheMiss(sha, cacheType) {
        this.cacheEvents.push({
            sha,
            cacheType,
            hit: false,
            timestamp: Date.now(),
        });
    }
    recordFlush(objectCount, sizeBytes, latencyMs) {
        this.flushes.push({
            objectCount,
            sizeBytes,
            latencyMs,
            timestamp: Date.now(),
        });
    }
    recordCompaction(sourceFileCount, resultObjectCount, resultSizeBytes, latencyMs) {
        this.compactions.push({
            sourceFileCount,
            resultObjectCount,
            resultSizeBytes,
            latencyMs,
            timestamp: Date.now(),
        });
    }
    recordError(operation, error, context) {
        this.errors.push({
            operation,
            error,
            context,
            timestamp: Date.now(),
        });
    }
    recordTiming(operation, latencyMs, labels) {
        this.timings.push({
            operation,
            latencyMs,
            labels,
            timestamp: Date.now(),
        });
    }
    recordCounter(name, value = 1, labels) {
        this.counters.push({
            name,
            value,
            labels,
            timestamp: Date.now(),
        });
    }
    recordGauge(name, value, labels) {
        this.gauges.push({
            name,
            value,
            labels,
            timestamp: Date.now(),
        });
    }
    /**
     * Clear all collected metrics.
     */
    clear() {
        this.reads.length = 0;
        this.writes.length = 0;
        this.cacheEvents.length = 0;
        this.flushes.length = 0;
        this.compactions.length = 0;
        this.errors.length = 0;
        this.timings.length = 0;
        this.counters.length = 0;
        this.gauges.length = 0;
    }
    /**
     * Get cache hits for a specific cache type.
     */
    getCacheHits(cacheType) {
        return this.cacheEvents.filter(e => e.hit && (cacheType === undefined || e.cacheType === cacheType));
    }
    /**
     * Get cache misses for a specific cache type.
     */
    getCacheMisses(cacheType) {
        return this.cacheEvents.filter(e => !e.hit && (cacheType === undefined || e.cacheType === cacheType));
    }
    /**
     * Calculate average latency for reads.
     */
    getAverageReadLatency() {
        if (this.reads.length === 0)
            return 0;
        return this.reads.reduce((sum, r) => sum + r.latencyMs, 0) / this.reads.length;
    }
    /**
     * Calculate average latency for writes.
     */
    getAverageWriteLatency() {
        if (this.writes.length === 0)
            return 0;
        return this.writes.reduce((sum, w) => sum + w.latencyMs, 0) / this.writes.length;
    }
    /**
     * Get total bytes written.
     */
    getTotalBytesWritten() {
        return this.writes.reduce((sum, w) => sum + w.sizeBytes, 0);
    }
    /**
     * Get summary statistics.
     */
    getSummary() {
        const hits = this.cacheEvents.filter(e => e.hit).length;
        const total = this.cacheEvents.length;
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
        };
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
export const NOOP_METRICS = new NoopMetrics();
/**
 * @deprecated Use NOOP_METRICS instead. This alias is provided for backward compatibility.
 */
export const noopMetrics = NOOP_METRICS;
//# sourceMappingURL=metrics.js.map