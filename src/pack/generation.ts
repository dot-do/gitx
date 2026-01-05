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

import pako from 'pako'
import { PackObjectType, encodeTypeAndSize } from './format'
import { createDelta } from './delta'
import { sha1 } from '../utils/sha1'

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * An object that can be packed
 */
export interface PackableObject {
  sha: string
  type: PackObjectType
  data: Uint8Array
  path?: string
}

/**
 * A delta object that references an external base
 */
export interface DeltaObject {
  sha: string
  type: PackObjectType
  baseSha: string
  delta: Uint8Array
}

/**
 * Options for pack generation
 */
export interface GeneratorOptions {
  enableDeltaCompression?: boolean
  maxDeltaDepth?: number
  windowSize?: number
  compressionLevel?: number
  useRefDelta?: boolean
  minDeltaSize?: number
}

/**
 * Statistics from pack generation
 */
export interface PackGenerationStats {
  totalObjects: number
  deltaObjects: number
  totalSize: number
  compressedSize: number
  maxDeltaDepth: number
  generationTimeMs: number
}

/**
 * Result of pack generation
 */
export interface GeneratedPackfile {
  packData: Uint8Array
  checksum: Uint8Array
  stats: PackGenerationStats
}

/**
 * A candidate for delta base selection
 */
export interface DeltaCandidate {
  sha: string
  type: PackObjectType
  data: Uint8Array
}

/**
 * Options for thin pack generation
 */
export interface ThinPackOptions {
  externalObjects: Set<string>
  baseData?: Map<string, Uint8Array>
}

/**
 * Result of thin pack generation
 */
export interface ThinPackResult {
  packData: Uint8Array
  checksum: Uint8Array
  isThin: boolean
  missingBases: string[]
  stats: PackGenerationStats
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Compute SHA-1 checksum of pack content
 */
export function computePackChecksum(data: Uint8Array): Uint8Array {
  return sha1(data)
}

/**
 * Create pack file header
 */
function createPackHeader(objectCount: number): Uint8Array {
  const header = new Uint8Array(12)
  // Signature: "PACK"
  header[0] = 0x50 // P
  header[1] = 0x41 // A
  header[2] = 0x43 // C
  header[3] = 0x4b // K
  // Version: 2 (big-endian)
  header[4] = 0
  header[5] = 0
  header[6] = 0
  header[7] = 2
  // Object count (big-endian)
  header[8] = (objectCount >> 24) & 0xff
  header[9] = (objectCount >> 16) & 0xff
  header[10] = (objectCount >> 8) & 0xff
  header[11] = objectCount & 0xff

  return header
}

/**
 * Encode offset for OFS_DELTA
 * Uses variable-length encoding with MSB as continuation bit
 */
function encodeOffset(offset: number): Uint8Array {
  const bytes: number[] = []

  // First byte: 7 bits of offset (no continuation)
  bytes.push(offset & 0x7f)
  offset >>>= 7

  // Subsequent bytes: continuation bit + 7 bits, but we need to subtract 1
  // to avoid ambiguity
  while (offset > 0) {
    offset -= 1
    bytes.unshift((offset & 0x7f) | 0x80)
    offset >>>= 7
  }

  return new Uint8Array(bytes)
}

/**
 * Hex string to bytes
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

/**
 * Concatenate multiple Uint8Arrays
 */
function concatArrays(arrays: Uint8Array[]): Uint8Array {
  let totalLength = 0
  for (const arr of arrays) {
    totalLength += arr.length
  }

  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }

  return result
}

/**
 * Calculate similarity between two byte arrays (simple hash-based)
 */
function calculateSimilarity(a: Uint8Array, b: Uint8Array): number {
  if (a.length === 0 || b.length === 0) return 0

  // Use a simple approach: count matching 4-byte sequences
  const windowSize = 4
  if (a.length < windowSize || b.length < windowSize) {
    // For small objects, compare byte by byte
    let matches = 0
    const minLen = Math.min(a.length, b.length)
    for (let i = 0; i < minLen; i++) {
      if (a[i] === b[i]) matches++
    }
    return matches / Math.max(a.length, b.length)
  }

  // Build hash set from 'a'
  const hashes = new Set<number>()
  for (let i = 0; i <= a.length - windowSize; i++) {
    let hash = 0
    for (let j = 0; j < windowSize; j++) {
      hash = ((hash << 5) - hash + a[i + j]) | 0
    }
    hashes.add(hash)
  }

  // Count matches in 'b'
  let matches = 0
  for (let i = 0; i <= b.length - windowSize; i++) {
    let hash = 0
    for (let j = 0; j < windowSize; j++) {
      hash = ((hash << 5) - hash + b[i + j]) | 0
    }
    if (hashes.has(hash)) matches++
  }

  return matches / Math.max(a.length - windowSize + 1, b.length - windowSize + 1)
}

// ============================================================================
// Object Ordering
// ============================================================================

/**
 * Order objects for optimal compression
 * Groups by type, then sorts by size (larger first for better delta bases)
 */
export function orderObjectsForCompression(objects: PackableObject[]): PackableObject[] {
  // Define type order: commits, trees, blobs, tags
  const typeOrder: Record<PackObjectType, number> = {
    [PackObjectType.OBJ_COMMIT]: 0,
    [PackObjectType.OBJ_TREE]: 1,
    [PackObjectType.OBJ_BLOB]: 2,
    [PackObjectType.OBJ_TAG]: 3,
    [PackObjectType.OBJ_OFS_DELTA]: 4,
    [PackObjectType.OBJ_REF_DELTA]: 5
  }

  return [...objects].sort((a, b) => {
    // First, sort by type
    const typeCompare = typeOrder[a.type] - typeOrder[b.type]
    if (typeCompare !== 0) return typeCompare

    // Within same type, sort by path if available (groups similar files)
    if (a.path && b.path) {
      const pathCompare = a.path.localeCompare(b.path)
      if (pathCompare !== 0) return pathCompare
    }

    // Then by size (larger first - better delta bases)
    return b.data.length - a.data.length
  })
}

/**
 * Select the best delta base from candidates
 */
export function selectDeltaBase(
  target: DeltaCandidate,
  candidates: DeltaCandidate[]
): DeltaCandidate | null {
  if (candidates.length === 0) return null

  let bestCandidate: DeltaCandidate | null = null
  let bestSimilarity = 0

  for (const candidate of candidates) {
    // Only consider same type for delta
    if (candidate.type !== target.type) continue
    // Don't delta against self
    if (candidate.sha === target.sha) continue

    const similarity = calculateSimilarity(candidate.data, target.data)
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity
      bestCandidate = candidate
    }
  }

  // Only return if similarity is good enough
  return bestSimilarity > 0.3 ? bestCandidate : null
}

// ============================================================================
// Packfile Generator Class
// ============================================================================

interface InternalObject {
  sha: string
  type: PackObjectType
  data: Uint8Array
  path?: string
  isDelta: boolean
  baseSha?: string
  baseOffset?: number
  deltaData?: Uint8Array
  depth: number
}

export class PackfileGenerator {
  private objects: Map<string, InternalObject> = new Map()
  private deltaObjects: DeltaObject[] = []
  private options: GeneratorOptions

  constructor(options: GeneratorOptions = {}) {
    this.options = {
      enableDeltaCompression: options.enableDeltaCompression ?? false,
      maxDeltaDepth: options.maxDeltaDepth ?? 50,
      windowSize: options.windowSize ?? 10,
      compressionLevel: options.compressionLevel ?? 6,
      useRefDelta: options.useRefDelta ?? false,
      minDeltaSize: options.minDeltaSize ?? 0  // Default to 0, use caller-specified value if set
    }
  }

  get objectCount(): number {
    return this.objects.size + this.deltaObjects.length
  }

  addObject(object: PackableObject): void {
    // Skip duplicates
    if (this.objects.has(object.sha)) return

    this.objects.set(object.sha, {
      sha: object.sha,
      type: object.type,
      data: object.data,
      path: object.path,
      isDelta: false,
      depth: 0
    })
  }

  addDeltaObject(deltaObj: DeltaObject): void {
    this.deltaObjects.push(deltaObj)
  }

  reset(): void {
    this.objects.clear()
    this.deltaObjects = []
  }

  generate(): GeneratedPackfile {
    const startTime = Date.now()

    let totalSize = 0
    let compressedSize = 0
    let deltaCount = 0
    let maxDeltaDepth = 0

    // Get all objects and order them
    const objectList = Array.from(this.objects.values())
    const orderedObjects = orderObjectsForCompression(
      objectList.map(o => ({ sha: o.sha, type: o.type, data: o.data, path: o.path }))
    )

    // Calculate total size
    for (const obj of orderedObjects) {
      totalSize += obj.data.length
    }

    // Build offset map for OFS_DELTA
    const offsetMap = new Map<string, number>()
    const parts: Uint8Array[] = []

    // Create header
    const header = createPackHeader(orderedObjects.length + this.deltaObjects.length)
    parts.push(header)
    let currentOffset = 12 // After header

    // Compute delta chains if enabled
    const deltaChains = new Map<string, { base: InternalObject; delta: Uint8Array; depth: number }>()

    if (this.options.enableDeltaCompression) {
      // Window of recent objects for delta comparison
      const window: InternalObject[] = []
      const depthMap = new Map<string, number>()

      for (const obj of orderedObjects) {
        const internalObj = this.objects.get(obj.sha)!

        // Skip small objects
        if (obj.data.length < (this.options.minDeltaSize ?? 50)) {
          window.push(internalObj)
          if (window.length > (this.options.windowSize ?? 10)) {
            window.shift()
          }
          continue
        }

        // Look for a good base in the window
        let bestBase: InternalObject | null = null
        let bestDelta: Uint8Array | null = null
        let bestSavings = 0

        for (const candidate of window) {
          if (candidate.type !== obj.type) continue

          // Check depth limit
          const candidateDepth = depthMap.get(candidate.sha) ?? 0
          if (candidateDepth >= (this.options.maxDeltaDepth ?? 50)) continue

          const delta = createDelta(candidate.data, obj.data)
          const savings = obj.data.length - delta.length

          if (savings > bestSavings && delta.length < obj.data.length * 0.9) {
            bestBase = candidate
            bestDelta = delta
            bestSavings = savings
          }
        }

        if (bestBase && bestDelta) {
          const depth = (depthMap.get(bestBase.sha) ?? 0) + 1
          deltaChains.set(obj.sha, { base: bestBase, delta: bestDelta, depth })
          depthMap.set(obj.sha, depth)
          if (depth > maxDeltaDepth) maxDeltaDepth = depth
        }

        window.push(internalObj)
        if (window.length > (this.options.windowSize ?? 10)) {
          window.shift()
        }
      }
    }

    // Write objects
    for (const obj of orderedObjects) {
      const objStart = currentOffset
      offsetMap.set(obj.sha, objStart)

      const deltaInfo = deltaChains.get(obj.sha)

      if (deltaInfo && offsetMap.has(deltaInfo.base.sha)) {
        // Write as OFS_DELTA
        const baseOffset = offsetMap.get(deltaInfo.base.sha)!
        const relativeOffset = objStart - baseOffset

        // OFS_DELTA header
        const typeAndSize = encodeTypeAndSize(PackObjectType.OBJ_OFS_DELTA, deltaInfo.delta.length)
        const offsetEncoded = encodeOffset(relativeOffset)
        const compressed = pako.deflate(deltaInfo.delta, { level: this.options.compressionLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 })

        parts.push(typeAndSize)
        parts.push(offsetEncoded)
        parts.push(compressed)

        currentOffset += typeAndSize.length + offsetEncoded.length + compressed.length
        compressedSize += compressed.length
        deltaCount++
      } else {
        // Write as full object
        const typeAndSize = encodeTypeAndSize(obj.type, obj.data.length)
        const compressed = pako.deflate(obj.data, { level: this.options.compressionLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 })

        parts.push(typeAndSize)
        parts.push(compressed)

        currentOffset += typeAndSize.length + compressed.length
        compressedSize += compressed.length
      }
    }

    // Write REF_DELTA objects
    for (const deltaObj of this.deltaObjects) {
      // REF_DELTA header
      const typeAndSize = encodeTypeAndSize(PackObjectType.OBJ_REF_DELTA, deltaObj.delta.length)
      const baseShaBytes = hexToBytes(deltaObj.baseSha)
      const compressed = pako.deflate(deltaObj.delta, { level: this.options.compressionLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 })

      parts.push(typeAndSize)
      parts.push(baseShaBytes)
      parts.push(compressed)

      currentOffset += typeAndSize.length + baseShaBytes.length + compressed.length
      compressedSize += compressed.length
      totalSize += deltaObj.delta.length
    }

    // Combine all parts (this is the pack data without trailing checksum)
    const packData = concatArrays(parts)

    // Calculate checksum of the pack data
    const checksum = computePackChecksum(packData)

    const generationTimeMs = Date.now() - startTime

    // packData does NOT include the trailing checksum
    // To get a complete packfile, concatenate packData + checksum
    // This allows the caller to verify or manipulate the pack before finalizing
    return {
      packData,
      checksum,
      stats: {
        totalObjects: orderedObjects.length + this.deltaObjects.length,
        deltaObjects: deltaCount,
        totalSize,
        compressedSize,
        maxDeltaDepth,
        generationTimeMs
      }
    }
  }
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Generate a packfile from an array of objects
 * Returns a complete packfile with trailing SHA-1 checksum
 */
export function generatePackfile(objects: PackableObject[]): Uint8Array {
  const generator = new PackfileGenerator()

  for (const obj of objects) {
    generator.addObject(obj)
  }

  const result = generator.generate()

  // Combine packData with checksum to form complete packfile
  const completePackfile = new Uint8Array(result.packData.length + result.checksum.length)
  completePackfile.set(result.packData, 0)
  completePackfile.set(result.checksum, result.packData.length)

  return completePackfile
}

/**
 * Generate a thin pack that can reference external objects
 */
export function generateThinPack(
  objects: PackableObject[],
  options: ThinPackOptions
): ThinPackResult {
  const startTime = Date.now()
  const missingBases: string[] = []
  let deltaCount = 0
  let totalSize = 0
  let compressedSize = 0

  // Check if any objects can use external bases
  const hasExternalBases = options.externalObjects.size > 0

  const parts: Uint8Array[] = []

  // Create header
  const header = createPackHeader(objects.length)
  parts.push(header)

  // Process objects
  for (const obj of objects) {
    totalSize += obj.data.length

    // Try to find an external base for delta
    let usedExternalBase = false

    if (hasExternalBases && options.baseData) {
      for (const externalSha of options.externalObjects) {
        const baseData = options.baseData.get(externalSha)
        if (baseData) {
          // Calculate similarity
          const similarity = calculateSimilarity(baseData, obj.data)
          if (similarity > 0.3) {
            // Create delta
            const delta = createDelta(baseData, obj.data)
            if (delta.length < obj.data.length * 0.9) {
              // Use REF_DELTA
              const typeAndSize = encodeTypeAndSize(PackObjectType.OBJ_REF_DELTA, delta.length)
              const baseShaBytes = hexToBytes(externalSha)
              const compressed = pako.deflate(delta)

              parts.push(typeAndSize)
              parts.push(baseShaBytes)
              parts.push(compressed)

              compressedSize += compressed.length
              deltaCount++
              usedExternalBase = true

              if (!missingBases.includes(externalSha)) {
                missingBases.push(externalSha)
              }
              break
            }
          }
        }
      }
    }

    if (!usedExternalBase) {
      // Write as full object
      const typeAndSize = encodeTypeAndSize(obj.type, obj.data.length)
      const compressed = pako.deflate(obj.data)

      parts.push(typeAndSize)
      parts.push(compressed)

      compressedSize += compressed.length
    }
  }

  // Combine all parts
  const packData = concatArrays(parts)

  // Calculate checksum
  const checksum = computePackChecksum(packData)

  // Create final packfile with checksum
  const finalPack = new Uint8Array(packData.length + 20)
  finalPack.set(packData, 0)
  finalPack.set(checksum, packData.length)

  const generationTimeMs = Date.now() - startTime

  // A pack is considered "thin" if it's generated with the capability to reference
  // external objects, even if no actual external references were used
  const isThin = hasExternalBases

  return {
    packData: finalPack,
    checksum,
    isThin,
    missingBases,
    stats: {
      totalObjects: objects.length,
      deltaObjects: deltaCount,
      totalSize,
      compressedSize,
      maxDeltaDepth: deltaCount > 0 ? 1 : 0,
      generationTimeMs
    }
  }
}
