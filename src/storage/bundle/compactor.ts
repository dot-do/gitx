/**
 * @fileoverview BundleCompactor - Merge and defragment R2 bundles
 *
 * Over time, bundle storage accumulates many small bundles and bundles with
 * deleted (garbage collected) objects. The compactor merges multiple source
 * bundles into fewer, larger, defragmented target bundles.
 *
 * Compaction strategy:
 * 1. Identify candidate bundles (small, high dead-object ratio, or old)
 * 2. Read all live objects from candidate bundles
 * 3. Write them into new, tightly-packed bundles
 * 4. Delete the old bundles after successful write
 *
 * This runs as a background maintenance task, not in the critical path.
 *
 * @module storage/bundle/compactor
 */

import {
  type BundleObjectType,
  BUNDLE_HEADER_SIZE,
  BUNDLE_INDEX_ENTRY_SIZE,
  DEFAULT_MAX_BUNDLE_SIZE,
  createBundle,
  parseBundle,
} from './format'

// ============================================================================
// Types
// ============================================================================

/** R2-compatible storage for compaction (needs read + write + delete + list) */
export interface CompactorStorage {
  /** Read a bundle from storage */
  get(key: string): Promise<Uint8Array | null>
  /** Write a bundle to storage */
  put(key: string, data: Uint8Array | ArrayBuffer): Promise<void>
  /** Delete a bundle from storage */
  delete(key: string): Promise<void>
  /** List bundle keys with a given prefix */
  list(prefix: string): Promise<string[]>
}

/** Configuration for the compactor */
export interface BundleCompactorConfig {
  /** Maximum size of compacted bundles (default: 128MB) */
  maxBundleSize?: number
  /** Minimum number of source bundles to trigger compaction (default: 4) */
  minBundlesForCompaction?: number
  /** Maximum ratio of dead/total objects before a bundle is a compaction candidate (default: 0.3) */
  deadObjectThreshold?: number
  /** Maximum size of a bundle to be considered "small" for compaction (default: 1MB) */
  smallBundleThreshold?: number
  /** R2 key prefix for bundles (default: 'bundles/') */
  keyPrefix?: string
}

/** Information about a bundle being considered for compaction */
export interface CompactionCandidate {
  /** R2 key of the bundle */
  key: string
  /** Total size in bytes */
  size: number
  /** Total number of entries */
  entryCount: number
  /** Number of live (non-deleted) objects */
  liveObjects: number
  /** Reason this bundle was selected for compaction */
  reason: 'small' | 'fragmented' | 'explicit'
}

/** Result of a compaction run */
export interface CompactionResult {
  /** Whether compaction was performed */
  compacted: boolean
  /** Number of source bundles merged */
  sourceBundles: number
  /** Number of target bundles created */
  targetBundles: number
  /** Total live objects moved */
  objectsMoved: number
  /** Total bytes in source bundles */
  sourceTotalBytes: number
  /** Total bytes in target bundles */
  targetTotalBytes: number
  /** Space saved in bytes */
  bytesSaved: number
  /** R2 keys of newly created bundles */
  newBundleKeys: string[]
  /** R2 keys of deleted source bundles */
  deletedBundleKeys: string[]
  /** Duration in milliseconds */
  durationMs: number
}

/** Predicate to determine if an object is still live (not garbage collected) */
export type LiveObjectPredicate = (oid: string) => boolean | Promise<boolean>

export class CompactionError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message)
    this.name = 'CompactionError'
  }
}

// ============================================================================
// BundleCompactor
// ============================================================================

function generateCompactedBundleId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 10)
  return `compacted-${timestamp}-${random}`
}

/**
 * BundleCompactor merges and defragments R2 bundles.
 *
 * @example
 * ```typescript
 * const compactor = new BundleCompactor(r2Storage, {
 *   minBundlesForCompaction: 4,
 *   smallBundleThreshold: 1024 * 1024,
 * })
 *
 * // Compact all small bundles
 * const result = await compactor.compact()
 * console.log(`Saved ${result.bytesSaved} bytes by merging ${result.sourceBundles} bundles`)
 *
 * // Compact specific bundles
 * const result2 = await compactor.compactBundles(['bundles/a.bundle', 'bundles/b.bundle'])
 * ```
 */
export class BundleCompactor {
  private readonly storage: CompactorStorage
  private readonly config: Required<BundleCompactorConfig>

  constructor(storage: CompactorStorage, config?: BundleCompactorConfig) {
    this.config = {
      maxBundleSize: config?.maxBundleSize ?? DEFAULT_MAX_BUNDLE_SIZE,
      minBundlesForCompaction: config?.minBundlesForCompaction ?? 4,
      deadObjectThreshold: config?.deadObjectThreshold ?? 0.3,
      smallBundleThreshold: config?.smallBundleThreshold ?? 1 * 1024 * 1024,
      keyPrefix: config?.keyPrefix ?? 'bundles/',
    }
    this.storage = storage
  }

  /**
   * Run automatic compaction.
   *
   * Scans for candidate bundles (small or fragmented), reads their live
   * objects, and writes them into new, larger bundles. Old bundles are
   * deleted after successful write.
   *
   * @param isLive - Optional predicate to filter out dead objects during compaction.
   *                 If not provided, all objects in source bundles are considered live.
   */
  async compact(isLive?: LiveObjectPredicate): Promise<CompactionResult> {
    const startTime = Date.now()

    // List all bundle keys
    const allKeys = await this.storage.list(this.config.keyPrefix)
    const bundleKeys = allKeys.filter((k) => k.endsWith('.bundle'))

    if (bundleKeys.length < this.config.minBundlesForCompaction) {
      return emptyResult(startTime)
    }

    // Identify candidates
    const candidates = await this.identifyCandidates(bundleKeys)

    if (candidates.length < this.config.minBundlesForCompaction) {
      return emptyResult(startTime)
    }

    return this.compactCandidates(candidates, isLive, startTime)
  }

  /**
   * Compact specific bundles by their R2 keys.
   *
   * Unlike compact(), this does not apply candidate selection heuristics.
   * All specified bundles are merged.
   */
  async compactBundles(
    bundleKeys: string[],
    isLive?: LiveObjectPredicate
  ): Promise<CompactionResult> {
    const startTime = Date.now()

    if (bundleKeys.length === 0) return emptyResult(startTime)

    const candidates: CompactionCandidate[] = bundleKeys.map((key) => ({
      key,
      size: 0,
      entryCount: 0,
      liveObjects: 0,
      reason: 'explicit' as const,
    }))

    return this.compactCandidates(candidates, isLive, startTime)
  }

  /**
   * Identify bundles that are good candidates for compaction.
   */
  async identifyCandidates(bundleKeys: string[]): Promise<CompactionCandidate[]> {
    const candidates: CompactionCandidate[] = []

    for (const key of bundleKeys) {
      const data = await this.storage.get(key)
      if (!data) continue

      try {
        const bundle = parseBundle(data)
        const entryCount = bundle.header.entryCount
        const size = data.length

        // Small bundle
        if (size < this.config.smallBundleThreshold) {
          candidates.push({
            key,
            size,
            entryCount,
            liveObjects: entryCount,
            reason: 'small',
          })
        }
      } catch {
        // Skip corrupt bundles
        continue
      }
    }

    return candidates
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private async compactCandidates(
    candidates: CompactionCandidate[],
    isLive: LiveObjectPredicate | undefined,
    startTime: number
  ): Promise<CompactionResult> {
    // Collect all live objects from candidate bundles
    const liveObjects: Array<{ oid: string; type: BundleObjectType; data: Uint8Array }> = []
    let sourceTotalBytes = 0
    const candidateKeys: string[] = []

    for (const candidate of candidates) {
      const data = await this.storage.get(candidate.key)
      if (!data) continue

      sourceTotalBytes += data.length
      candidateKeys.push(candidate.key)

      try {
        const bundle = parseBundle(data)
        for (const entry of bundle.entries) {
          // Check liveness
          if (isLive) {
            const live = await isLive(entry.oid)
            if (!live) continue
          }

          // Skip duplicates (object may exist in multiple bundles)
          if (liveObjects.some((o) => o.oid === entry.oid)) continue

          const objectData = data.slice(entry.offset, entry.offset + entry.size)
          liveObjects.push({ oid: entry.oid, type: entry.type, data: objectData })
        }
      } catch {
        // Skip corrupt bundles
        continue
      }
    }

    if (liveObjects.length === 0) {
      // All objects were dead - just delete source bundles
      for (const key of candidateKeys) {
        await this.storage.delete(key)
      }
      return {
        compacted: true,
        sourceBundles: candidateKeys.length,
        targetBundles: 0,
        objectsMoved: 0,
        sourceTotalBytes,
        targetTotalBytes: 0,
        bytesSaved: sourceTotalBytes,
        newBundleKeys: [],
        deletedBundleKeys: candidateKeys,
        durationMs: Date.now() - startTime,
      }
    }

    // Partition live objects into target bundles respecting maxBundleSize
    const targetBundles: Array<Array<{ oid: string; type: BundleObjectType; data: Uint8Array }>> = []
    let currentBatch: Array<{ oid: string; type: BundleObjectType; data: Uint8Array }> = []
    let currentSize = BUNDLE_HEADER_SIZE

    for (const obj of liveObjects) {
      const entrySize = obj.data.length + BUNDLE_INDEX_ENTRY_SIZE
      if (currentSize + entrySize > this.config.maxBundleSize && currentBatch.length > 0) {
        targetBundles.push(currentBatch)
        currentBatch = []
        currentSize = BUNDLE_HEADER_SIZE
      }
      currentBatch.push(obj)
      currentSize += entrySize
    }
    if (currentBatch.length > 0) {
      targetBundles.push(currentBatch)
    }

    // Write target bundles
    const newBundleKeys: string[] = []
    let targetTotalBytes = 0

    for (const batch of targetBundles) {
      const bundleData = createBundle(batch)
      const id = generateCompactedBundleId()
      const key = `${this.config.keyPrefix}${id}.bundle`

      try {
        await this.storage.put(key, bundleData)
        newBundleKeys.push(key)
        targetTotalBytes += bundleData.length
      } catch (error) {
        // Clean up any already-written target bundles
        for (const written of newBundleKeys) {
          try { await this.storage.delete(written) } catch { /* best effort */ }
        }
        throw new CompactionError(
          'Failed to write compacted bundle',
          error instanceof Error ? error : new Error(String(error))
        )
      }
    }

    // Delete source bundles only after all targets are written
    for (const key of candidateKeys) {
      try {
        await this.storage.delete(key)
      } catch {
        // Log but continue - source bundle deletion is best-effort
      }
    }

    return {
      compacted: true,
      sourceBundles: candidateKeys.length,
      targetBundles: newBundleKeys.length,
      objectsMoved: liveObjects.length,
      sourceTotalBytes,
      targetTotalBytes,
      bytesSaved: sourceTotalBytes - targetTotalBytes,
      newBundleKeys,
      deletedBundleKeys: candidateKeys,
      durationMs: Date.now() - startTime,
    }
  }
}

function emptyResult(startTime: number): CompactionResult {
  return {
    compacted: false,
    sourceBundles: 0,
    targetBundles: 0,
    objectsMoved: 0,
    sourceTotalBytes: 0,
    targetTotalBytes: 0,
    bytesSaved: 0,
    newBundleKeys: [],
    deletedBundleKeys: [],
    durationMs: Date.now() - startTime,
  }
}
