/**
 * @fileoverview Git Packfile Unpacking Implementation
 *
 * This module implements full packfile unpacking, extracting individual objects
 * from a packed format. This is the inverse operation of packfile generation.
 *
 * ## Unpacking Process
 *
 * 1. **Header Validation**: Verify PACK signature, version 2, and object count
 * 2. **Object Iteration**: For each object in the pack:
 *    - Read type and size from variable-length header
 *    - For delta objects, read base reference (offset or SHA)
 *    - Decompress zlib-compressed data
 *    - For delta objects, resolve base and apply delta
 * 3. **Checksum Verification**: Validate trailing SHA-1 checksum
 *
 * ## Delta Resolution
 *
 * Delta objects (OFS_DELTA, REF_DELTA) require resolving their base:
 * - OFS_DELTA: Base is at a relative byte offset within the same pack
 * - REF_DELTA: Base is referenced by SHA-1 (may be in pack or external)
 *
 * Delta chains are resolved recursively until a non-delta base is found.
 *
 * @module pack/unpack
 * @see {@link https://git-scm.com/docs/pack-format} Git Pack Format Documentation
 */

import pako from 'pako'
import { sha1 } from '../utils/sha1'
import {
  PackObjectType,
  parsePackHeader,
  decodeTypeAndSize,
} from './format'
import { applyDelta } from './delta'
import type { ObjectType } from '../types/objects'

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Represents a single unpacked object from a packfile.
 */
export interface UnpackedObject {
  /** The 40-character hexadecimal SHA-1 hash of the object */
  sha: string
  /** The Git object type (commit, tree, blob, tag) */
  type: ObjectType
  /** The raw (uncompressed) object data */
  data: Uint8Array
  /** Byte offset where this object started in the packfile */
  offset: number
}

/**
 * Result of unpacking a complete packfile.
 */
export interface UnpackResult {
  /** Array of all unpacked objects */
  objects: UnpackedObject[]
  /** Total number of objects in the pack */
  objectCount: number
  /** Pack version (should always be 2) */
  version: number
  /** Whether checksum verification passed */
  checksumValid: boolean
}

/**
 * Callback for resolving external REF_DELTA bases.
 *
 * When unpacking thin packs, delta objects may reference bases
 * that exist outside the pack. This callback is invoked to
 * resolve such external references.
 */
export type ExternalBaseResolver = (
  sha: string
) => Promise<{ type: ObjectType; data: Uint8Array } | null>

/**
 * Options for unpacking a packfile.
 */
export interface UnpackOptions {
  /**
   * Callback to resolve external delta bases (for thin packs).
   * If not provided, unpacking will fail for REF_DELTA objects
   * whose base is not in the pack.
   */
  resolveExternalBase?: ExternalBaseResolver
  /** Whether to verify the pack checksum (default: true) */
  verifyChecksum?: boolean
  /** Maximum delta chain depth to prevent stack overflow (default: 50) */
  maxDeltaDepth?: number
}

/**
 * Internal representation of a parsed but not yet resolved object.
 */
interface ParsedObjectEntry {
  offset: number
  type: PackObjectType
  size: number
  /** Compressed data for non-delta objects */
  compressedData: Uint8Array
  /** For OFS_DELTA: relative offset to base */
  ofsBaseOffset?: number
  /** For REF_DELTA: SHA of base object */
  refBaseSha?: string
  /** Resolved object (set during delta resolution) */
  resolved?: { type: ObjectType; data: Uint8Array; sha: string }
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum delta chain depth to prevent stack overflow */
const DEFAULT_MAX_DELTA_DEPTH = 50

// ============================================================================
// Main Unpacking Functions
// ============================================================================

/**
 * Unpacks a complete packfile into individual objects.
 *
 * @description Parses the binary packfile format and extracts all objects,
 * resolving delta chains to produce the original object content.
 *
 * @param packData - Complete packfile data including checksum
 * @param options - Unpacking options
 * @returns Unpacking result with all objects
 * @throws {Error} If packfile is invalid or corrupted
 *
 * @example
 * const result = await unpackPackfile(packData);
 * for (const obj of result.objects) {
 *   console.log(`${obj.sha}: ${obj.type} (${obj.data.length} bytes)`);
 * }
 */
export async function unpackPackfile(
  packData: Uint8Array,
  options: UnpackOptions = {}
): Promise<UnpackResult> {
  const verifyChecksum = options.verifyChecksum ?? true
  const maxDeltaDepth = options.maxDeltaDepth ?? DEFAULT_MAX_DELTA_DEPTH

  // Verify minimum size (12 header + 20 checksum)
  if (packData.length < 32) {
    throw new Error('Packfile too short: minimum 32 bytes required')
  }

  // Parse and validate header
  const header = parsePackHeader(packData)

  // Verify checksum if requested
  let checksumValid = true
  if (verifyChecksum) {
    const packContent = packData.subarray(0, packData.length - 20)
    const storedChecksum = packData.subarray(packData.length - 20)
    const computedChecksum = sha1(packContent)

    checksumValid = true
    for (let i = 0; i < 20; i++) {
      if (computedChecksum[i] !== storedChecksum[i]) {
        checksumValid = false
        break
      }
    }

    if (!checksumValid) {
      throw new Error('Packfile checksum verification failed')
    }
  }

  // Parse all objects in the pack
  const entries = parsePackObjects(packData, header.objectCount)

  // Build offset-to-entry map for OFS_DELTA resolution
  const offsetMap = new Map<number, ParsedObjectEntry>()
  for (const entry of entries) {
    offsetMap.set(entry.offset, entry)
  }

  // Resolve all objects (including delta chains)
  const objects: UnpackedObject[] = []

  for (const entry of entries) {
    const resolved = await resolveObject(
      entry,
      offsetMap,
      options.resolveExternalBase,
      maxDeltaDepth,
      0
    )
    objects.push({
      sha: resolved.sha,
      type: resolved.type,
      data: resolved.data,
      offset: entry.offset,
    })
  }

  return {
    objects,
    objectCount: header.objectCount,
    version: header.version,
    checksumValid,
  }
}

/**
 * Iterates through a packfile yielding objects one at a time.
 *
 * @description Memory-efficient alternative to unpackPackfile for large packs.
 * Objects are yielded as they are parsed and resolved.
 *
 * @param packData - Complete packfile data
 * @param options - Unpacking options
 * @yields Unpacked objects
 *
 * @example
 * for await (const obj of iteratePackfile(packData)) {
 *   await store.putObject(obj.type, obj.data);
 * }
 */
export async function* iteratePackfile(
  packData: Uint8Array,
  options: UnpackOptions = {}
): AsyncGenerator<UnpackedObject> {
  const maxDeltaDepth = options.maxDeltaDepth ?? DEFAULT_MAX_DELTA_DEPTH

  if (packData.length < 32) {
    throw new Error('Packfile too short')
  }

  const header = parsePackHeader(packData)
  const entries = parsePackObjects(packData, header.objectCount)

  // Build offset map for delta resolution
  const offsetMap = new Map<number, ParsedObjectEntry>()
  for (const entry of entries) {
    offsetMap.set(entry.offset, entry)
  }

  try {
    for (const entry of entries) {
      const resolved = await resolveObject(
        entry,
        offsetMap,
        options.resolveExternalBase,
        maxDeltaDepth,
        0
      )
      yield {
        sha: resolved.sha,
        type: resolved.type,
        data: resolved.data,
        offset: entry.offset,
      }
    }
  } finally {
    // Clean up references on early termination (break, return, throw)
    // to allow garbage collection of potentially large data structures
    offsetMap.clear()
  }
}

// ============================================================================
// Internal Parsing Functions
// ============================================================================

/**
 * Parses all object entries from a packfile without resolving deltas.
 */
function parsePackObjects(
  packData: Uint8Array,
  objectCount: number
): ParsedObjectEntry[] {
  const entries: ParsedObjectEntry[] = []
  let offset = 12 // Skip header

  const dataEnd = packData.length - 20 // Exclude checksum

  for (let i = 0; i < objectCount; i++) {
    if (offset >= dataEnd) {
      throw new Error(`Unexpected end of packfile at object ${i}`)
    }

    const { entry, nextOffset } = parseObjectEntry(packData, offset, dataEnd)
    entries.push(entry)
    offset = nextOffset
  }

  return entries
}

/**
 * Parses a single object entry at the given offset.
 * Returns both the entry and the offset of the next object.
 */
function parseObjectEntry(
  packData: Uint8Array,
  startOffset: number,
  dataEnd: number
): { entry: ParsedObjectEntry; nextOffset: number } {
  let offset = startOffset

  // Decode type and size
  const { type, size, bytesRead } = decodeTypeAndSize(packData, offset)
  offset += bytesRead

  let ofsBaseOffset: number | undefined
  let refBaseSha: string | undefined

  // Handle delta types
  if (type === PackObjectType.OBJ_OFS_DELTA) {
    const { offset: baseOffset, bytesRead: offsetBytes } = decodeOfsOffset(
      packData,
      offset
    )
    ofsBaseOffset = baseOffset
    offset += offsetBytes
  } else if (type === PackObjectType.OBJ_REF_DELTA) {
    const shaBytes = packData.subarray(offset, offset + 20)
    if (shaBytes.length < 20) {
      throw new Error('Unexpected end of packfile reading REF_DELTA base SHA')
    }
    refBaseSha = bytesToHex(shaBytes)
    offset += 20
  }

  // Find the end of compressed data by attempting decompression
  const remainingData = packData.subarray(offset, dataEnd)
  const { compressedSize } = decompressWithSize(remainingData, size)

  const compressedData = packData.subarray(offset, offset + compressedSize)
  const nextOffset = offset + compressedSize

  const entry: ParsedObjectEntry = {
    offset: startOffset,
    type,
    size,
    compressedData,
  }

  // Only set optional properties if they have values
  if (ofsBaseOffset !== undefined) {
    entry.ofsBaseOffset = ofsBaseOffset
  }
  if (refBaseSha !== undefined) {
    entry.refBaseSha = refBaseSha
  }

  return {
    entry,
    nextOffset,
  }
}

/**
 * Decodes the variable-length base offset for OFS_DELTA.
 *
 * Git uses a special encoding where each byte after the first adds 1
 * before shifting, to avoid ambiguity.
 */
function decodeOfsOffset(
  data: Uint8Array,
  startOffset: number
): { offset: number; bytesRead: number } {
  let byte = data[startOffset]
  if (byte === undefined) {
    throw new Error('Unexpected end of data reading OFS_DELTA offset')
  }

  let offset = byte & 0x7f
  let bytesRead = 1

  while (byte & 0x80) {
    offset += 1
    byte = data[startOffset + bytesRead]
    if (byte === undefined) {
      throw new Error('Unexpected end of data reading OFS_DELTA offset')
    }
    offset = (offset << 7) | (byte & 0x7f)
    bytesRead++
  }

  return { offset, bytesRead }
}

/**
 * Decompresses zlib data and returns both the result and compressed size.
 *
 * The challenge is that zlib streams are self-terminating, but we don't know
 * exactly where they end without attempting decompression. We use a binary
 * search approach to find the minimum compressed size that produces valid
 * output of the expected size.
 */
function decompressWithSize(
  data: Uint8Array,
  expectedSize: number
): { decompressed: Uint8Array; compressedSize: number } {
  // Binary search for the minimum compressed size that produces correct output
  // Zlib has overhead, so minimum compressed size is roughly 10 bytes
  let lo = Math.min(10, data.length)
  let hi = data.length
  let lastGood: Uint8Array | null = null
  let lastGoodSize = 0

  // First, try the full data - if it works, use binary search to find minimum
  try {
    const fullResult = pako.inflate(data)
    if (fullResult.length === expectedSize) {
      lastGood = fullResult
      lastGoodSize = data.length
    }
  } catch {
    // Full data doesn't work as a complete stream, which is fine
    // (likely multiple objects concatenated)
  }

  // Binary search for minimum working size
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    try {
      const attempt = pako.inflate(data.subarray(0, mid))
      if (attempt.length === expectedSize) {
        lastGood = attempt
        lastGoodSize = mid
        hi = mid - 1 // Try to find smaller
      } else if (attempt.length < expectedSize) {
        // Need more data
        lo = mid + 1
      } else {
        // Got too much, need less
        hi = mid - 1
      }
    } catch {
      // Decompression failed, need more data
      lo = mid + 1
    }
  }

  if (lastGood && lastGoodSize > 0) {
    return { decompressed: lastGood, compressedSize: lastGoodSize }
  }

  // Fallback: linear search from minimum
  for (let len = 1; len <= data.length; len++) {
    try {
      const result = pako.inflate(data.subarray(0, len))
      if (result.length === expectedSize) {
        return { decompressed: result, compressedSize: len }
      }
    } catch {
      // Continue
    }
  }

  throw new Error(
    `Failed to decompress: could not find valid zlib stream producing ${expectedSize} bytes`
  )
}

// ============================================================================
// Delta Resolution
// ============================================================================

/**
 * Resolves an object entry to its final type and data.
 * For delta objects, this recursively resolves the base chain.
 */
async function resolveObject(
  entry: ParsedObjectEntry,
  offsetMap: Map<number, ParsedObjectEntry>,
  resolveExternal: ExternalBaseResolver | undefined,
  maxDepth: number,
  currentDepth: number
): Promise<{ type: ObjectType; data: Uint8Array; sha: string }> {
  // Return cached result if already resolved
  if (entry.resolved) {
    return entry.resolved
  }

  if (currentDepth > maxDepth) {
    throw new Error(
      `Delta chain depth exceeded maximum of ${maxDepth} (possible cycle)`
    )
  }

  // Non-delta objects: decompress and compute SHA
  if (
    entry.type !== PackObjectType.OBJ_OFS_DELTA &&
    entry.type !== PackObjectType.OBJ_REF_DELTA
  ) {
    const data = pako.inflate(entry.compressedData)
    const type = packTypeToObjectType(entry.type)
    const sha = computeObjectSha(type, data)
    entry.resolved = { type, data, sha }
    return entry.resolved
  }

  // Delta objects: resolve base first
  let baseData: Uint8Array | undefined
  let baseType: ObjectType | undefined

  if (entry.ofsBaseOffset !== undefined) {
    // OFS_DELTA: base is at a relative offset within the pack
    const baseAbsOffset = entry.offset - entry.ofsBaseOffset
    const baseEntry = offsetMap.get(baseAbsOffset)

    if (!baseEntry) {
      throw new Error(
        `OFS_DELTA base not found at offset ${baseAbsOffset} (delta at ${entry.offset})`
      )
    }

    const resolvedBase = await resolveObject(
      baseEntry,
      offsetMap,
      resolveExternal,
      maxDepth,
      currentDepth + 1
    )
    baseData = resolvedBase.data
    baseType = resolvedBase.type
  } else if (entry.refBaseSha !== undefined) {
    // REF_DELTA: base is referenced by SHA
    // First check if the base is in this pack
    let found = false
    for (const [, candidate] of offsetMap) {
      if (candidate.resolved?.sha === entry.refBaseSha) {
        baseData = candidate.resolved.data
        baseType = candidate.resolved.type
        found = true
        break
      }
    }

    if (!found) {
      // Try to resolve non-delta objects that might match
      for (const [, candidate] of offsetMap) {
        if (
          candidate.type !== PackObjectType.OBJ_OFS_DELTA &&
          candidate.type !== PackObjectType.OBJ_REF_DELTA
        ) {
          const resolved = await resolveObject(
            candidate,
            offsetMap,
            resolveExternal,
            maxDepth,
            currentDepth + 1
          )
          if (resolved.sha === entry.refBaseSha) {
            baseData = resolved.data
            baseType = resolved.type
            found = true
            break
          }
        }
      }
    }

    if (!found) {
      // Try external resolution
      if (!resolveExternal) {
        throw new Error(
          `REF_DELTA base ${entry.refBaseSha} not found in pack and no external resolver provided`
        )
      }

      const external = await resolveExternal(entry.refBaseSha)
      if (!external) {
        throw new Error(
          `REF_DELTA base ${entry.refBaseSha} not found (external resolution failed)`
        )
      }
      baseData = external.data
      baseType = external.type
    }
  } else {
    throw new Error('Delta object has no base reference')
  }

  // At this point baseData and baseType must be set
  if (baseData === undefined || baseType === undefined) {
    throw new Error('Failed to resolve delta base')
  }

  // Decompress delta data and apply to base
  const deltaData = pako.inflate(entry.compressedData)
  const resultData = applyDelta(baseData, deltaData)
  const sha = computeObjectSha(baseType, resultData)

  entry.resolved = { type: baseType, data: resultData, sha }
  return entry.resolved
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Converts PackObjectType to ObjectType string.
 */
function packTypeToObjectType(type: PackObjectType): ObjectType {
  switch (type) {
    case PackObjectType.OBJ_COMMIT:
      return 'commit'
    case PackObjectType.OBJ_TREE:
      return 'tree'
    case PackObjectType.OBJ_BLOB:
      return 'blob'
    case PackObjectType.OBJ_TAG:
      return 'tag'
    default:
      throw new Error(`Cannot convert delta type ${type} to object type`)
  }
}

/**
 * Computes the SHA-1 hash of a Git object.
 * Git hashes the header "type size\0" + data.
 */
function computeObjectSha(type: ObjectType, data: Uint8Array): string {
  const header = `${type} ${data.length}\0`
  const headerBytes = new TextEncoder().encode(header)
  const combined = new Uint8Array(headerBytes.length + data.length)
  combined.set(headerBytes, 0)
  combined.set(data, headerBytes.length)
  return bytesToHex(sha1(combined))
}

/**
 * Converts a byte array to lowercase hexadecimal string.
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ============================================================================
// Exports for Integration
// ============================================================================

export {
  packTypeToObjectType,
  computeObjectSha,
  bytesToHex,
}
