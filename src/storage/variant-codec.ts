/**
 * @fileoverview VARIANT Codec for Git Objects
 *
 * Encodes and decodes Git objects to/from Parquet VARIANT format.
 * VARIANT allows storing semi-structured data (like git objects) in Parquet
 * while shredding commonly-queried fields into separate columns.
 *
 * Three storage modes:
 * - `inline`: Object data stored directly in VARIANT (< 1MB)
 * - `r2`: Reference to raw R2 object (> 1MB, non-LFS)
 * - `lfs`: LFS metadata in VARIANT, data in R2
 *
 * @module storage/variant-codec
 */

import { encodeVariant } from 'hyparquet-writer'
import type { ObjectType } from '../types/objects'

// ============================================================================
// Constants
// ============================================================================

/** Maximum size for inline storage in VARIANT (1MB) */
export const INLINE_THRESHOLD = 1024 * 1024

/** Git LFS pointer file signature */
const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1'

// ============================================================================
// Types
// ============================================================================

/** Storage mode for a git object */
export type StorageMode = 'inline' | 'r2' | 'lfs'

/**
 * Encoded git object ready for Parquet storage.
 * Contains shredded fields + VARIANT-encoded data.
 */
export interface EncodedGitObject {
  /** SHA-1 hash */
  sha: string
  /** Object type (commit, tree, blob, tag) */
  type: ObjectType
  /** Object size in bytes */
  size: number
  /** File path (for tree-walked objects, nullable) */
  path: string | null
  /** Storage mode */
  storage: StorageMode
  /** VARIANT-encoded data (metadata + value buffers) */
  data: { metadata: Uint8Array; value: Uint8Array }
}

/**
 * Decoded git object from Parquet storage.
 */
export interface DecodedGitObject {
  sha: string
  type: ObjectType
  size: number
  path: string | null
  storage: StorageMode
  /** Raw object content (for inline), or R2 key (for r2/lfs) */
  content: Uint8Array | string
}

/**
 * Shredded commit fields (optional, for enriched storage).
 */
export interface ShreddedCommitFields {
  author_name?: string
  author_date?: number
  message?: string
  tree_sha?: string
  parent_shas?: string[]
}

/**
 * LFS pointer metadata parsed from a pointer file.
 */
export interface LfsPointer {
  oid: string
  size: number
}

// ============================================================================
// Encoding
// ============================================================================

const decoder = new TextDecoder()

/**
 * Detect storage mode for a git object.
 */
export function detectStorageMode(type: ObjectType, data: Uint8Array): StorageMode {
  // Check for LFS pointer (blob type, starts with LFS signature)
  if (type === 'blob' && data.length < 512) {
    const text = decoder.decode(data)
    if (text.startsWith(LFS_POINTER_PREFIX)) {
      return 'lfs'
    }
  }

  // Large objects go to R2
  if (data.length > INLINE_THRESHOLD) {
    return 'r2'
  }

  return 'inline'
}

/**
 * Parse a Git LFS pointer file.
 *
 * @param data - Raw pointer file content
 * @returns Parsed LFS pointer or null if not a valid pointer
 */
export function parseLfsPointer(data: Uint8Array): LfsPointer | null {
  const text = decoder.decode(data)
  if (!text.startsWith(LFS_POINTER_PREFIX)) {
    return null
  }

  const oidMatch = text.match(/oid sha256:([0-9a-f]{64})/)
  const sizeMatch = text.match(/size (\d+)/)

  if (!oidMatch || !sizeMatch) {
    return null
  }

  return {
    oid: oidMatch[1],
    size: parseInt(sizeMatch[1], 10),
  }
}

/**
 * Build an R2 key for a large object.
 */
export function buildR2Key(sha: string, prefix?: string): string {
  const p = prefix ?? 'objects'
  return `${p}/${sha.slice(0, 2)}/${sha.slice(2)}`
}

/**
 * Encode a git object for Parquet VARIANT storage.
 *
 * For inline objects, the VARIANT contains the raw binary data.
 * For R2 objects, the VARIANT contains a reference { r2_key, size }.
 * For LFS objects, the VARIANT contains LFS metadata { oid, size, r2_key }.
 */
export function encodeGitObject(
  sha: string,
  type: ObjectType,
  data: Uint8Array,
  options?: { path?: string; r2Prefix?: string }
): EncodedGitObject {
  const storage = detectStorageMode(type, data)
  const path = options?.path ?? null

  let variantPayload: unknown

  switch (storage) {
    case 'inline':
      // Store raw bytes directly in VARIANT
      variantPayload = data
      break

    case 'r2': {
      // Store reference to R2 object
      const r2Key = buildR2Key(sha, options?.r2Prefix)
      variantPayload = { r2_key: r2Key, size: data.length }
      break
    }

    case 'lfs': {
      // Store LFS metadata
      const pointer = parseLfsPointer(data)
      const r2Key = pointer
        ? `lfs/${pointer.oid.slice(0, 2)}/${pointer.oid.slice(2)}`
        : buildR2Key(sha, 'lfs')
      variantPayload = {
        r2_key: r2Key,
        oid: pointer?.oid ?? sha,
        size: pointer?.size ?? data.length,
        pointer: true,
      }
      break
    }
  }

  const encoded = encodeVariant(variantPayload)

  return {
    sha,
    type,
    size: data.length,
    path,
    storage,
    data: { metadata: encoded.metadata, value: encoded.value },
  }
}

/**
 * Extract shredded commit fields from raw commit data.
 *
 * These fields are stored as separate Parquet columns for efficient querying.
 */
export function extractCommitFields(data: Uint8Array): ShreddedCommitFields | null {
  const text = decoder.decode(data)
  const lines = text.split('\n')

  const fields: ShreddedCommitFields = {}
  let messageStart = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === '') {
      messageStart = i + 1
      break
    }
    if (line.startsWith('tree ')) {
      fields.tree_sha = line.slice(5)
    } else if (line.startsWith('parent ')) {
      if (!fields.parent_shas) fields.parent_shas = []
      fields.parent_shas.push(line.slice(7))
    } else if (line.startsWith('author ')) {
      const match = line.match(/^author (.+) <.+> (\d+) [+-]\d{4}$/)
      if (match) {
        fields.author_name = match[1]
        fields.author_date = parseInt(match[2], 10) * 1000 // to millis
      }
    }
  }

  if (messageStart >= 0) {
    fields.message = lines.slice(messageStart).join('\n')
  }

  // Must have at least tree_sha to be a valid commit
  return fields.tree_sha ? fields : null
}

/**
 * Encode multiple git objects into column-oriented arrays for Parquet writing.
 *
 * Returns parallel arrays suitable for hyparquet-writer's columnData format.
 */
export function encodeObjectBatch(
  objects: Array<{ sha: string; type: ObjectType; data: Uint8Array; path?: string }>,
  options?: { r2Prefix?: string }
): {
  shas: string[]
  types: string[]
  sizes: bigint[]
  paths: (string | null)[]
  storages: string[]
  variantData: Array<{ metadata: Uint8Array; value: Uint8Array }>
  commitFields: Array<ShreddedCommitFields | null>
} {
  const shas: string[] = []
  const types: string[] = []
  const sizes: bigint[] = []
  const paths: (string | null)[] = []
  const storages: string[] = []
  const variantData: Array<{ metadata: Uint8Array; value: Uint8Array }> = []
  const commitFields: Array<ShreddedCommitFields | null> = []

  for (const obj of objects) {
    const encoded = encodeGitObject(obj.sha, obj.type, obj.data, {
      path: obj.path,
      r2Prefix: options?.r2Prefix,
    })

    shas.push(encoded.sha)
    types.push(encoded.type)
    sizes.push(BigInt(encoded.size))
    paths.push(encoded.path)
    storages.push(encoded.storage)
    variantData.push(encoded.data)
    commitFields.push(
      obj.type === 'commit' ? extractCommitFields(obj.data) : null
    )
  }

  return { shas, types, sizes, paths, storages, variantData, commitFields }
}
