/**
 * @fileoverview Performance benchmarks for GitX storage operations
 *
 * Run with: pnpm bench
 *
 * These benchmarks measure the performance of critical storage paths:
 * - Object read/write operations (putObject, getObject, hasObject)
 * - Flush operations (buffer to Parquet)
 * - Bloom filter lookups (existence checks)
 * - Variant encoding/decoding
 *
 * Baseline Performance Expectations (M1 Mac, dev environment):
 * - Object write (1KB blob): < 1ms
 * - Object read from buffer: < 0.1ms
 * - Bloom filter lookup (absent): < 0.01ms
 * - Bloom filter lookup (present): < 0.1ms
 * - Flush (100 objects): < 100ms
 * - Variant encode (1KB blob): < 0.5ms
 *
 * @module bench/storage
 */

import { bench, describe } from 'vitest'
import { BloomFilter, SegmentedBloomFilter, BloomCache } from '../src/storage/bloom-cache'
import {
  encodeGitObject,
  encodeObjectBatch,
  detectStorageMode,
  extractCommitFields,
} from '../src/storage/variant-codec'
import type { ObjectType } from '../src/types/objects'

// ============================================================================
// Test Data Generators
// ============================================================================

const encoder = new TextEncoder()

/** Generate random SHA-like hex string */
function randomSha(): string {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Generate test blob data of specified size */
function generateBlob(sizeBytes: number): Uint8Array {
  const data = new Uint8Array(sizeBytes)
  crypto.getRandomValues(data)
  return data
}

/** Generate a realistic commit object */
function generateCommit(): Uint8Array {
  const treeSha = randomSha()
  const parentSha = randomSha()
  const timestamp = Math.floor(Date.now() / 1000)
  const commit = `tree ${treeSha}
parent ${parentSha}
author Test User <test@example.com> ${timestamp} +0000
committer Test User <test@example.com> ${timestamp} +0000

Initial commit with some message content that describes the changes made.
`
  return encoder.encode(commit)
}

/** Generate a batch of objects for flush benchmarks */
function generateObjectBatch(count: number): Array<{ sha: string; type: ObjectType; data: Uint8Array; path?: string }> {
  const objects: Array<{ sha: string; type: ObjectType; data: Uint8Array; path?: string }> = []
  for (let i = 0; i < count; i++) {
    const type: ObjectType = i % 10 === 0 ? 'commit' : 'blob'
    const data = type === 'commit' ? generateCommit() : generateBlob(1024)
    objects.push({
      sha: randomSha(),
      type,
      data,
      path: type === 'blob' ? `/src/file${i}.ts` : undefined,
    })
  }
  return objects
}

// ============================================================================
// Bloom Filter Benchmarks
// ============================================================================

describe('BloomFilter', () => {
  const filter = new BloomFilter()

  // Pre-populate filter with test data
  const testShas = Array.from({ length: 10000 }, () => randomSha())
  for (const sha of testShas) {
    filter.add(sha)
  }

  bench('add SHA', () => {
    filter.add(randomSha())
  })

  bench('mightContain - present', () => {
    const sha = testShas[Math.floor(Math.random() * testShas.length)]
    filter.mightContain(sha)
  })

  bench('mightContain - absent', () => {
    filter.mightContain(randomSha())
  })
})

describe('SegmentedBloomFilter', () => {
  const filter = new SegmentedBloomFilter({
    segmentThreshold: 5000,
    maxSegments: 5,
  })

  // Pre-populate filter with test data
  const testShas = Array.from({ length: 10000 }, () => randomSha())
  for (const sha of testShas) {
    filter.add(sha)
  }

  bench('add SHA', () => {
    filter.add(randomSha())
  })

  bench('mightContain - present (2 segments)', () => {
    const sha = testShas[Math.floor(Math.random() * testShas.length)]
    filter.mightContain(sha)
  })

  bench('mightContain - absent (2 segments)', () => {
    filter.mightContain(randomSha())
  })

  bench('serializeSegments', () => {
    filter.serializeSegments()
  })
})

describe('BloomCache (mock storage)', () => {
  // Create a mock SQLStorage for benchmarking
  const mockStorage = {
    sql: {
      exec: () => ({ toArray: () => [] }),
    },
  }

  const cache = new BloomCache(mockStorage as any)

  // Pre-populate with test data (skip async for benchmark)
  const testShas = Array.from({ length: 1000 }, () => randomSha())

  bench('check - absent (bloom only)', async () => {
    await cache.check(randomSha())
  })
})

// ============================================================================
// Variant Codec Benchmarks
// ============================================================================

describe('Variant Codec - detectStorageMode', () => {
  const smallBlob = generateBlob(1024) // 1KB
  const largeBlob = generateBlob(2 * 1024 * 1024) // 2MB
  const lfsPointer = encoder.encode(
    'version https://git-lfs.github.com/spec/v1\noid sha256:' +
      '0'.repeat(64) +
      '\nsize 1234567890\n'
  )

  bench('detect inline (1KB blob)', () => {
    detectStorageMode('blob', smallBlob)
  })

  bench('detect r2 (2MB blob)', () => {
    detectStorageMode('blob', largeBlob)
  })

  bench('detect lfs (pointer)', () => {
    detectStorageMode('blob', lfsPointer)
  })
})

describe('Variant Codec - encodeGitObject', () => {
  const smallBlob = generateBlob(1024)
  const mediumBlob = generateBlob(100 * 1024) // 100KB
  const sha = randomSha()

  bench('encode 1KB blob (inline)', () => {
    encodeGitObject(sha, 'blob', smallBlob)
  })

  bench('encode 100KB blob (inline)', () => {
    encodeGitObject(sha, 'blob', mediumBlob)
  })

  bench('encode commit object', () => {
    const commit = generateCommit()
    encodeGitObject(sha, 'commit', commit)
  })
})

describe('Variant Codec - extractCommitFields', () => {
  const commit = generateCommit()

  bench('extract commit fields', () => {
    extractCommitFields(commit)
  })
})

describe('Variant Codec - encodeObjectBatch', () => {
  const batch10 = generateObjectBatch(10)
  const batch100 = generateObjectBatch(100)
  const batch1000 = generateObjectBatch(1000)

  bench('encode batch of 10 objects', () => {
    encodeObjectBatch(batch10)
  })

  bench('encode batch of 100 objects', () => {
    encodeObjectBatch(batch100)
  })

  bench('encode batch of 1000 objects', () => {
    encodeObjectBatch(batch1000)
  })
})

// ============================================================================
// Object Size Benchmarks
// ============================================================================

describe('Object Encoding by Size', () => {
  const sha = randomSha()

  // Various sizes to benchmark
  const sizes = [100, 1024, 10 * 1024, 100 * 1024, 500 * 1024]

  for (const size of sizes) {
    const blob = generateBlob(size)
    const label = size >= 1024 ? `${size / 1024}KB` : `${size}B`

    bench(`encode ${label} blob`, () => {
      encodeGitObject(sha, 'blob', blob)
    })
  }
})

// ============================================================================
// Hash Function Benchmarks (used by bloom filter)
// ============================================================================

describe('Hash Functions', () => {
  const testSha = randomSha()

  // FNV-1a implementation (same as in bloom-cache.ts)
  function fnv1a(str: string, seed: number): number {
    let hash = seed
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193)
    }
    return hash >>> 0
  }

  bench('FNV-1a hash', () => {
    fnv1a(testSha, 0x811c9dc5)
  })

  bench('double hash (bloom)', () => {
    const h1 = fnv1a(testSha, 0x811c9dc5)
    const h2 = fnv1a(testSha, 0xc4ceb9fe)
    const hashes: number[] = []
    for (let i = 0; i < 7; i++) {
      hashes.push((h1 + i * h2) >>> 0)
    }
  })
})

// ============================================================================
// Memory Allocation Benchmarks
// ============================================================================

describe('Memory Allocation', () => {
  bench('allocate 1KB Uint8Array', () => {
    new Uint8Array(1024)
  })

  bench('allocate 1MB Uint8Array', () => {
    new Uint8Array(1024 * 1024)
  })

  bench('TextEncoder encode (100 chars)', () => {
    encoder.encode('x'.repeat(100))
  })

  bench('TextEncoder encode (10000 chars)', () => {
    encoder.encode('x'.repeat(10000))
  })

  bench('crypto.randomUUID', () => {
    crypto.randomUUID()
  })

  bench('generate random SHA', () => {
    randomSha()
  })
})
