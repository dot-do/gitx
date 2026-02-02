import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  NoopMetrics,
  ConsoleMetrics,
  CollectingMetrics,
  noopMetrics,
  type StorageMetrics,
} from '../../src/storage/metrics'

describe('NoopMetrics', () => {
  let metrics: NoopMetrics

  beforeEach(() => {
    metrics = new NoopMetrics()
  })

  it('should implement StorageMetrics interface', () => {
    // All methods should exist and be callable
    expect(typeof metrics.recordObjectRead).toBe('function')
    expect(typeof metrics.recordObjectWrite).toBe('function')
    expect(typeof metrics.recordCacheHit).toBe('function')
    expect(typeof metrics.recordCacheMiss).toBe('function')
    expect(typeof metrics.recordFlush).toBe('function')
    expect(typeof metrics.recordCompaction).toBe('function')
    expect(typeof metrics.recordError).toBe('function')
    expect(typeof metrics.recordTiming).toBe('function')
    expect(typeof metrics.recordCounter).toBe('function')
    expect(typeof metrics.recordGauge).toBe('function')
  })

  it('should not throw when methods are called', () => {
    // Should not throw
    expect(() => {
      metrics.recordObjectRead('abc123', 'buffer', 10, 'blob', 100)
      metrics.recordObjectWrite('abc123', 100, 'parquet', 20, 'commit')
      metrics.recordCacheHit('abc123', 'bloom')
      metrics.recordCacheMiss('abc123', 'exact')
      metrics.recordFlush(10, 1000, 50)
      metrics.recordCompaction(5, 100, 5000, 200)
      metrics.recordError('read', new Error('test'))
      metrics.recordTiming('write', 15)
      metrics.recordCounter('test_counter', 5)
      metrics.recordGauge('test_gauge', 42)
    }).not.toThrow()
  })
})

describe('noopMetrics singleton', () => {
  it('should be a NoopMetrics instance', () => {
    expect(noopMetrics).toBeInstanceOf(NoopMetrics)
  })

  it('should be usable as StorageMetrics', () => {
    const m: StorageMetrics = noopMetrics
    expect(() => m.recordObjectRead('sha', 'buffer', 1)).not.toThrow()
  })
})

describe('ConsoleMetrics', () => {
  let metrics: ConsoleMetrics
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    metrics = new ConsoleMetrics({ includeTimestamp: false })
    consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  it('should log object reads', () => {
    metrics.recordObjectRead('abc12345678901234567890123456789012345678', 'parquet', 15.5, 'blob', 256)
    expect(consoleSpy).toHaveBeenCalledWith(
      ' [StorageMetrics] object_read',
      expect.objectContaining({
        sha: 'abc12345',
        tier: 'parquet',
        latencyMs: '15.50',
        objectType: 'blob',
        sizeBytes: 256,
      })
    )
  })

  it('should log object writes', () => {
    metrics.recordObjectWrite('def12345678901234567890123456789012345678', 512, 'buffer', 10.2, 'tree')
    expect(consoleSpy).toHaveBeenCalledWith(
      ' [StorageMetrics] object_write',
      expect.objectContaining({
        sha: 'def12345',
        sizeBytes: 512,
        tier: 'buffer',
        latencyMs: '10.20',
        objectType: 'tree',
      })
    )
  })

  it('should log cache hits', () => {
    metrics.recordCacheHit('abc12345678901234567890123456789012345678', 'bloom')
    expect(consoleSpy).toHaveBeenCalledWith(
      ' [StorageMetrics] cache_hit',
      expect.objectContaining({
        sha: 'abc12345',
        cacheType: 'bloom',
      })
    )
  })

  it('should log cache misses', () => {
    metrics.recordCacheMiss('abc12345678901234567890123456789012345678', 'buffer')
    expect(consoleSpy).toHaveBeenCalledWith(
      ' [StorageMetrics] cache_miss',
      expect.objectContaining({
        sha: 'abc12345',
        cacheType: 'buffer',
      })
    )
  })

  it('should log flushes', () => {
    metrics.recordFlush(100, 50000, 150.75)
    expect(consoleSpy).toHaveBeenCalledWith(
      ' [StorageMetrics] flush',
      expect.objectContaining({
        objectCount: 100,
        sizeBytes: 50000,
        latencyMs: '150.75',
      })
    )
  })

  it('should log compactions', () => {
    metrics.recordCompaction(5, 500, 100000, 2500.5)
    expect(consoleSpy).toHaveBeenCalledWith(
      ' [StorageMetrics] compaction',
      expect.objectContaining({
        sourceFileCount: 5,
        resultObjectCount: 500,
        resultSizeBytes: 100000,
        latencyMs: '2500.50',
      })
    )
  })

  it('should log errors', () => {
    const error = new Error('test error')
    metrics.recordError('read', error, { sha: 'abc123' })
    expect(consoleSpy).toHaveBeenCalledWith(
      ' [StorageMetrics] error',
      expect.objectContaining({
        operation: 'read',
        error: 'test error',
        sha: 'abc123',
      })
    )
  })

  it('should log timing', () => {
    metrics.recordTiming('compact', 1500, { files: 3 })
    expect(consoleSpy).toHaveBeenCalledWith(
      ' [StorageMetrics] timing',
      expect.objectContaining({
        operation: 'compact',
        latencyMs: '1500.00',
        files: 3,
      })
    )
  })

  it('should log counters', () => {
    metrics.recordCounter('objects_written', 10, { type: 'blob' })
    expect(consoleSpy).toHaveBeenCalledWith(
      ' [StorageMetrics] counter',
      expect.objectContaining({
        name: 'objects_written',
        value: 10,
        type: 'blob',
      })
    )
  })

  it('should log gauges', () => {
    metrics.recordGauge('buffer_size', 1024, { unit: 'bytes' })
    expect(consoleSpy).toHaveBeenCalledWith(
      ' [StorageMetrics] gauge',
      expect.objectContaining({
        name: 'buffer_size',
        value: 1024,
        unit: 'bytes',
      })
    )
  })

  it('should respect custom prefix', () => {
    const customMetrics = new ConsoleMetrics({ prefix: '[Custom]', includeTimestamp: false })
    customMetrics.recordFlush(1, 100, 10)
    expect(consoleSpy).toHaveBeenCalledWith(
      ' [Custom] flush',
      expect.any(Object)
    )
  })

  it('should respect filter option', () => {
    const filteredMetrics = new ConsoleMetrics({
      includeTimestamp: false,
      filter: (op) => op !== 'cache_hit',
    })
    filteredMetrics.recordCacheHit('abc', 'bloom')
    expect(consoleSpy).not.toHaveBeenCalled()
    filteredMetrics.recordFlush(1, 100, 10)
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('should use info log level', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const infoMetrics = new ConsoleMetrics({ logLevel: 'info', includeTimestamp: false })
    infoMetrics.recordFlush(1, 100, 10)
    expect(infoSpy).toHaveBeenCalled()
    expect(consoleSpy).not.toHaveBeenCalled()
  })
})

describe('CollectingMetrics', () => {
  let metrics: CollectingMetrics

  beforeEach(() => {
    metrics = new CollectingMetrics()
  })

  describe('recordObjectRead', () => {
    it('should collect read events', () => {
      metrics.recordObjectRead('sha1', 'buffer', 10, 'blob', 100)
      metrics.recordObjectRead('sha2', 'parquet', 20, 'commit', 500)

      expect(metrics.reads).toHaveLength(2)
      expect(metrics.reads[0]).toEqual(expect.objectContaining({
        sha: 'sha1',
        tier: 'buffer',
        latencyMs: 10,
        objectType: 'blob',
        sizeBytes: 100,
      }))
      expect(metrics.reads[1]).toEqual(expect.objectContaining({
        sha: 'sha2',
        tier: 'parquet',
        latencyMs: 20,
        objectType: 'commit',
        sizeBytes: 500,
      }))
    })

    it('should include timestamps', () => {
      const before = Date.now()
      metrics.recordObjectRead('sha1', 'buffer', 10)
      const after = Date.now()

      expect(metrics.reads[0]?.timestamp).toBeGreaterThanOrEqual(before)
      expect(metrics.reads[0]?.timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe('recordObjectWrite', () => {
    it('should collect write events', () => {
      metrics.recordObjectWrite('sha1', 256, 'buffer', 15, 'tree')

      expect(metrics.writes).toHaveLength(1)
      expect(metrics.writes[0]).toEqual(expect.objectContaining({
        sha: 'sha1',
        sizeBytes: 256,
        tier: 'buffer',
        latencyMs: 15,
        objectType: 'tree',
      }))
    })
  })

  describe('cache events', () => {
    it('should collect cache hits', () => {
      metrics.recordCacheHit('sha1', 'bloom')
      metrics.recordCacheHit('sha2', 'exact')
      metrics.recordCacheHit('sha3', 'buffer')

      expect(metrics.cacheEvents).toHaveLength(3)
      expect(metrics.cacheEvents.filter(e => e.hit)).toHaveLength(3)
      expect(metrics.getCacheHits()).toHaveLength(3)
      expect(metrics.getCacheHits('bloom')).toHaveLength(1)
      expect(metrics.getCacheHits('exact')).toHaveLength(1)
    })

    it('should collect cache misses', () => {
      metrics.recordCacheMiss('sha1', 'bloom')
      metrics.recordCacheMiss('sha2', 'buffer')

      expect(metrics.cacheEvents).toHaveLength(2)
      expect(metrics.cacheEvents.filter(e => !e.hit)).toHaveLength(2)
      expect(metrics.getCacheMisses()).toHaveLength(2)
      expect(metrics.getCacheMisses('bloom')).toHaveLength(1)
    })
  })

  describe('recordFlush', () => {
    it('should collect flush events', () => {
      metrics.recordFlush(100, 50000, 200)

      expect(metrics.flushes).toHaveLength(1)
      expect(metrics.flushes[0]).toEqual(expect.objectContaining({
        objectCount: 100,
        sizeBytes: 50000,
        latencyMs: 200,
      }))
    })
  })

  describe('recordCompaction', () => {
    it('should collect compaction events', () => {
      metrics.recordCompaction(5, 500, 100000, 3000)

      expect(metrics.compactions).toHaveLength(1)
      expect(metrics.compactions[0]).toEqual(expect.objectContaining({
        sourceFileCount: 5,
        resultObjectCount: 500,
        resultSizeBytes: 100000,
        latencyMs: 3000,
      }))
    })
  })

  describe('recordError', () => {
    it('should collect errors', () => {
      const error = new Error('test error')
      metrics.recordError('write', error, { sha: 'abc' })

      expect(metrics.errors).toHaveLength(1)
      expect(metrics.errors[0]).toEqual(expect.objectContaining({
        operation: 'write',
        error,
        context: { sha: 'abc' },
      }))
    })
  })

  describe('recordTiming', () => {
    it('should collect timing events', () => {
      metrics.recordTiming('initialize', 500, { cold: 1 })

      expect(metrics.timings).toHaveLength(1)
      expect(metrics.timings[0]).toEqual(expect.objectContaining({
        operation: 'initialize',
        latencyMs: 500,
        labels: { cold: 1 },
      }))
    })
  })

  describe('recordCounter', () => {
    it('should collect counter increments', () => {
      metrics.recordCounter('objects_read', 5)
      metrics.recordCounter('objects_read', 3, { type: 'blob' })

      expect(metrics.counters).toHaveLength(2)
      expect(metrics.counters[0]).toEqual(expect.objectContaining({
        name: 'objects_read',
        value: 5,
      }))
    })

    it('should default to value of 1', () => {
      metrics.recordCounter('requests')
      expect(metrics.counters[0]?.value).toBe(1)
    })
  })

  describe('recordGauge', () => {
    it('should collect gauge values', () => {
      metrics.recordGauge('buffer_bytes', 1024)
      metrics.recordGauge('buffer_objects', 50, { prefix: 'test' })

      expect(metrics.gauges).toHaveLength(2)
      expect(metrics.gauges[1]).toEqual(expect.objectContaining({
        name: 'buffer_objects',
        value: 50,
        labels: { prefix: 'test' },
      }))
    })
  })

  describe('clear', () => {
    it('should clear all collected metrics', () => {
      metrics.recordObjectRead('sha1', 'buffer', 10)
      metrics.recordObjectWrite('sha2', 100, 'parquet', 20)
      metrics.recordCacheHit('sha3', 'bloom')
      metrics.recordFlush(10, 1000, 50)
      metrics.recordCompaction(2, 100, 5000, 200)
      metrics.recordError('read', new Error('test'))
      metrics.recordTiming('write', 15)
      metrics.recordCounter('test', 1)
      metrics.recordGauge('test', 42)

      metrics.clear()

      expect(metrics.reads).toHaveLength(0)
      expect(metrics.writes).toHaveLength(0)
      expect(metrics.cacheEvents).toHaveLength(0)
      expect(metrics.flushes).toHaveLength(0)
      expect(metrics.compactions).toHaveLength(0)
      expect(metrics.errors).toHaveLength(0)
      expect(metrics.timings).toHaveLength(0)
      expect(metrics.counters).toHaveLength(0)
      expect(metrics.gauges).toHaveLength(0)
    })
  })

  describe('getAverageReadLatency', () => {
    it('should calculate average read latency', () => {
      metrics.recordObjectRead('sha1', 'buffer', 10)
      metrics.recordObjectRead('sha2', 'parquet', 20)
      metrics.recordObjectRead('sha3', 'r2', 30)

      expect(metrics.getAverageReadLatency()).toBe(20)
    })

    it('should return 0 for no reads', () => {
      expect(metrics.getAverageReadLatency()).toBe(0)
    })
  })

  describe('getAverageWriteLatency', () => {
    it('should calculate average write latency', () => {
      metrics.recordObjectWrite('sha1', 100, 'buffer', 5)
      metrics.recordObjectWrite('sha2', 200, 'buffer', 15)

      expect(metrics.getAverageWriteLatency()).toBe(10)
    })

    it('should return 0 for no writes', () => {
      expect(metrics.getAverageWriteLatency()).toBe(0)
    })
  })

  describe('getTotalBytesWritten', () => {
    it('should sum all bytes written', () => {
      metrics.recordObjectWrite('sha1', 100, 'buffer', 5)
      metrics.recordObjectWrite('sha2', 200, 'buffer', 10)
      metrics.recordObjectWrite('sha3', 50, 'parquet', 15)

      expect(metrics.getTotalBytesWritten()).toBe(350)
    })
  })

  describe('getSummary', () => {
    it('should return a complete summary', () => {
      metrics.recordObjectRead('sha1', 'buffer', 10)
      metrics.recordObjectRead('sha2', 'parquet', 20)
      metrics.recordObjectWrite('sha1', 100, 'buffer', 5)
      metrics.recordCacheHit('sha1', 'bloom')
      metrics.recordCacheHit('sha2', 'exact')
      metrics.recordCacheMiss('sha3', 'bloom')
      metrics.recordFlush(10, 1000, 50)
      metrics.recordCompaction(2, 100, 5000, 200)
      metrics.recordError('read', new Error('test'))

      const summary = metrics.getSummary()

      expect(summary).toEqual({
        totalReads: 2,
        totalWrites: 1,
        totalFlushes: 1,
        totalCompactions: 1,
        totalErrors: 1,
        cacheHitRate: 2 / 3,
        avgReadLatencyMs: 15,
        avgWriteLatencyMs: 5,
        totalBytesWritten: 100,
      })
    })

    it('should handle empty metrics', () => {
      const summary = metrics.getSummary()

      expect(summary).toEqual({
        totalReads: 0,
        totalWrites: 0,
        totalFlushes: 0,
        totalCompactions: 0,
        totalErrors: 0,
        cacheHitRate: 0,
        avgReadLatencyMs: 0,
        avgWriteLatencyMs: 0,
        totalBytesWritten: 0,
      })
    })
  })
})
