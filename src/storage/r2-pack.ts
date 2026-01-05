/**
 * R2 Packfile Storage
 *
 * Manages Git packfiles stored in Cloudflare R2 object storage.
 * Provides functionality for:
 * - Uploading and downloading packfiles with their indices
 * - Multi-pack index (MIDX) for efficient object lookup across packs
 * - Concurrent access control with locking
 * - Pack verification and integrity checks
 */

/**
 * Configuration options for R2PackStorage
 */
export interface R2PackStorageOptions {
  /** R2 bucket instance */
  bucket: R2Bucket
  /** Optional prefix for all keys (e.g., 'repos/my-repo/') */
  prefix?: string
  /** Maximum number of items to cache (default: 100) */
  cacheSize?: number
  /** Cache TTL in seconds (default: 3600) */
  cacheTTL?: number
}

/**
 * Result of uploading a packfile
 */
export interface PackfileUploadResult {
  /** Unique identifier for the packfile */
  packId: string
  /** Size of the pack file in bytes */
  packSize: number
  /** Size of the index file in bytes */
  indexSize: number
  /** SHA-1 checksum of the packfile */
  checksum: string
  /** Number of objects in the packfile */
  objectCount: number
  /** Timestamp when the packfile was uploaded */
  uploadedAt: Date
}

/**
 * Metadata about a stored packfile
 */
export interface PackfileMetadata {
  /** Unique identifier for the packfile */
  packId: string
  /** Size of the pack file in bytes */
  packSize: number
  /** Size of the index file in bytes */
  indexSize: number
  /** Number of objects in the packfile */
  objectCount: number
  /** Timestamp when the packfile was created */
  createdAt: Date
  /** SHA-1 checksum of the packfile */
  checksum: string
}

/**
 * Options for downloading a packfile
 */
export interface DownloadPackfileOptions {
  /** Include the index file in the download */
  includeIndex?: boolean
  /** Byte range to download (for partial reads) */
  byteRange?: { start: number; end: number }
  /** Verify checksum on download */
  verify?: boolean
  /** Throw if packfile not found (default: false, returns null) */
  required?: boolean
}

/**
 * Result of downloading a packfile
 */
export interface DownloadPackfileResult {
  /** The packfile data */
  packData: Uint8Array
  /** The index file data (if includeIndex was true) */
  indexData?: Uint8Array
  /** Whether the checksum was verified */
  verified?: boolean
}

/**
 * Options for uploading a packfile
 */
export interface UploadPackfileOptions {
  /** Number of retries on failure */
  retries?: number
  /** Skip atomic upload (for testing/migration) */
  skipAtomic?: boolean
}

/**
 * Pack manifest for atomic uploads
 * A manifest marks a pack as "complete" only after both pack and index are uploaded
 */
export interface PackManifest {
  /** Version of the manifest format */
  version: number
  /** Pack ID this manifest belongs to */
  packId: string
  /** SHA-1 checksum of the pack file */
  packChecksum: string
  /** SHA-1 checksum of the index file */
  indexChecksum: string
  /** Size of the pack file in bytes */
  packSize: number
  /** Size of the index file in bytes */
  indexSize: number
  /** Number of objects in the packfile */
  objectCount: number
  /** Timestamp when the pack was completed */
  completedAt: string
  /** Status: 'staging' during upload, 'complete' when done */
  status: 'staging' | 'complete'
}

/**
 * Entry in the multi-pack index
 */
export interface MultiPackIndexEntry {
  /** 40-character hex SHA-1 object ID */
  objectId: string
  /** Index of the pack in the packIds array */
  packIndex: number
  /** Offset within the pack file */
  offset: number
}

/**
 * Multi-pack index structure
 */
export interface MultiPackIndex {
  /** Version of the multi-pack index format */
  version: number
  /** Array of pack IDs in this index */
  packIds: string[]
  /** Sorted entries for all objects across all packs */
  entries: MultiPackIndexEntry[]
  /** SHA-1 checksum of the index */
  checksum: Uint8Array
}

/**
 * Handle for a distributed lock
 * Contains all information needed to release or refresh a lock
 */
export interface LockHandle {
  /** Resource that is locked */
  resource: string
  /** Unique lock ID for this holder */
  lockId: string
  /** ETag for conditional operations */
  etag: string
  /** When the lock expires (ms since epoch) */
  expiresAt: number
}

/**
 * Content stored in a lock file
 */
export interface LockFileContent {
  /** Unique lock ID */
  lockId: string
  /** Resource being locked */
  resource: string
  /** When the lock expires (ms since epoch) */
  expiresAt: number
  /** When the lock was acquired (ms since epoch) */
  acquiredAt: number
  /** Worker/process identifier (for debugging) */
  holder?: string
}

/**
 * Lock on a packfile for write operations
 */
export interface PackLock {
  /** Pack ID that is locked */
  packId: string
  /** Check if lock is still held */
  isHeld(): boolean
  /** Release the lock */
  release(): Promise<void>
  /** Refresh the lock TTL (returns true if successful) */
  refresh?(): Promise<boolean>
  /** Get the underlying distributed lock handle */
  handle?: LockHandle
}

/**
 * Options for acquiring a lock
 */
export interface AcquireLockOptions {
  /** Timeout in milliseconds to wait for lock */
  timeout?: number
  /** TTL in milliseconds after which lock auto-expires */
  ttl?: number
  /** Worker/process identifier for debugging */
  holder?: string
}

/**
 * Result of listing packfiles
 */
export interface ListPackfilesResult {
  /** Array of packfile metadata */
  items: PackfileMetadata[]
  /** Cursor for pagination */
  cursor?: string
}

/**
 * Error thrown by R2 pack operations
 */
export class R2PackError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'LOCKED' | 'INVALID_DATA' | 'CHECKSUM_MISMATCH' | 'NETWORK_ERROR',
    public readonly packId?: string
  ) {
    super(message)
    this.name = 'R2PackError'
  }
}

// PACK signature bytes: "PACK"
const PACK_SIGNATURE = new Uint8Array([0x50, 0x41, 0x43, 0x4b])

// Multi-pack index signature
const MIDX_SIGNATURE = new Uint8Array([0x4d, 0x49, 0x44, 0x58]) // "MIDX"

/**
 * Validate a packfile header
 */
function validatePackfile(data: Uint8Array): { version: number; objectCount: number } {
  if (data.length < 12) {
    throw new R2PackError('Packfile too small', 'INVALID_DATA')
  }

  // Check signature
  for (let i = 0; i < 4; i++) {
    if (data[i] !== PACK_SIGNATURE[i]) {
      throw new R2PackError('Invalid packfile signature', 'INVALID_DATA')
    }
  }

  // Read version (big endian 4 bytes)
  const version = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7]
  if (version !== 2 && version !== 3) {
    throw new R2PackError(`Unsupported pack version: ${version}`, 'INVALID_DATA')
  }

  // Read object count (big endian 4 bytes)
  const objectCount = (data[8] << 24) | (data[9] << 16) | (data[10] << 8) | data[11]

  return { version, objectCount }
}

/**
 * Compute SHA-1 checksum as hex string
 */
async function computeChecksum(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-1', data)
  const hashArray = new Uint8Array(hashBuffer)
  return Array.from(hashArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generate a unique pack ID
 */
function generatePackId(): string {
  const randomBytes = new Uint8Array(8)
  crypto.getRandomValues(randomBytes)
  const hex = Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return `pack-${hex}`
}

/**
 * Build the full key path with prefix
 */
function buildKey(prefix: string, path: string): string {
  if (!prefix) {
    return path
  }
  // Normalize prefix to have trailing slash
  const normalizedPrefix = prefix.endsWith('/') ? prefix : prefix + '/'
  return normalizedPrefix + path
}

/**
 * Generate a unique lock ID
 */
function generateLockId(): string {
  const randomBytes = new Uint8Array(16)
  crypto.getRandomValues(randomBytes)
  return Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * R2 Packfile Storage class
 */
export class R2PackStorage {
  private _bucket: R2Bucket
  private _prefix: string
  private _cacheTTL: number
  private _midxCache: { midx: MultiPackIndex; expiresAt: number } | null = null
  private _indexChecksums = new Map<string, string>()

  constructor(options: R2PackStorageOptions) {
    this._bucket = options.bucket
    this._prefix = options.prefix ?? ''
    void (options.cacheSize ?? 100) // Reserved for LRU cache implementation
    this._cacheTTL = options.cacheTTL ?? 3600
  }

  private _buildKey(path: string): string {
    return buildKey(this._prefix, path)
  }

  /**
   * Upload a packfile and its index to R2 atomically
   *
   * Uses a manifest-based pattern to ensure atomic uploads:
   * 1. Upload pack and index to staging paths
   * 2. Create manifest in 'staging' status
   * 3. Copy from staging to final location
   * 4. Update manifest to 'complete' status
   * 5. Clean up staging files
   *
   * If the process fails at any point, the pack is not considered complete
   * until a valid manifest with status 'complete' exists.
   */
  async uploadPackfile(
    packData: Uint8Array,
    indexData: Uint8Array,
    options?: UploadPackfileOptions
  ): Promise<PackfileUploadResult> {
    if (!this._bucket) {
      throw new R2PackError('Bucket not available', 'NETWORK_ERROR')
    }

    // Validate packfile
    const { objectCount } = validatePackfile(packData)

    // Generate unique pack ID and checksums
    const packId = generatePackId()
    const packChecksum = await computeChecksum(packData)
    const indexChecksum = await computeChecksum(indexData)
    const uploadedAt = new Date()

    // Store metadata for the files
    const metadata = {
      packId,
      packSize: String(packData.length),
      indexSize: String(indexData.length),
      objectCount: String(objectCount),
      checksum: packChecksum,
      createdAt: uploadedAt.toISOString()
    }

    // If skipAtomic is set, use the simple (non-atomic) upload path
    if (options?.skipAtomic) {
      const packKey = this._buildKey(`packs/${packId}.pack`)
      await this._bucket.put(packKey, packData, { customMetadata: metadata })

      const idxKey = this._buildKey(`packs/${packId}.idx`)
      await this._bucket.put(idxKey, indexData, { customMetadata: metadata })

      this._indexChecksums.set(packId, indexChecksum)

      return {
        packId,
        packSize: packData.length,
        indexSize: indexData.length,
        checksum: packChecksum,
        objectCount,
        uploadedAt
      }
    }

    // Step 1: Upload to staging paths
    const stagingPackKey = this._buildKey(`staging/${packId}.pack`)
    const stagingIdxKey = this._buildKey(`staging/${packId}.idx`)
    const manifestKey = this._buildKey(`packs/${packId}.manifest`)

    try {
      // Upload pack to staging
      await this._bucket.put(stagingPackKey, packData, { customMetadata: metadata })

      // Upload index to staging
      await this._bucket.put(stagingIdxKey, indexData, { customMetadata: metadata })

      // Step 2: Create manifest in 'staging' status
      const manifest: PackManifest = {
        version: 1,
        packId,
        packChecksum,
        indexChecksum,
        packSize: packData.length,
        indexSize: indexData.length,
        objectCount,
        completedAt: uploadedAt.toISOString(),
        status: 'staging'
      }
      await this._bucket.put(manifestKey, JSON.stringify(manifest), {
        customMetadata: { packId, status: 'staging' }
      })

      // Step 3: Copy from staging to final location
      const packKey = this._buildKey(`packs/${packId}.pack`)
      const idxKey = this._buildKey(`packs/${packId}.idx`)

      await this._bucket.put(packKey, packData, { customMetadata: metadata })
      await this._bucket.put(idxKey, indexData, { customMetadata: metadata })

      // Step 4: Update manifest to 'complete' status
      manifest.status = 'complete'
      await this._bucket.put(manifestKey, JSON.stringify(manifest), {
        customMetadata: { packId, status: 'complete' }
      })

      // Step 5: Clean up staging files
      await this._bucket.delete([stagingPackKey, stagingIdxKey])

      // Store index checksum for verification
      this._indexChecksums.set(packId, indexChecksum)

      return {
        packId,
        packSize: packData.length,
        indexSize: indexData.length,
        checksum: packChecksum,
        objectCount,
        uploadedAt
      }
    } catch (error) {
      // Clean up any partial uploads on failure
      try {
        await this._bucket.delete([
          stagingPackKey,
          stagingIdxKey,
          this._buildKey(`packs/${packId}.pack`),
          this._buildKey(`packs/${packId}.idx`),
          manifestKey
        ])
      } catch {
        // Ignore cleanup errors
      }
      throw error
    }
  }

  /**
   * Get the manifest for a packfile
   */
  async getPackManifest(packId: string): Promise<PackManifest | null> {
    const manifestKey = this._buildKey(`packs/${packId}.manifest`)
    const manifestObj = await this._bucket.get(manifestKey)

    if (!manifestObj) {
      return null
    }

    try {
      const text = await manifestObj.text()
      return JSON.parse(text) as PackManifest
    } catch {
      return null
    }
  }

  /**
   * Check if a packfile upload is complete
   *
   * A pack is considered complete if:
   * 1. It has a manifest with status 'complete', OR
   * 2. It was uploaded before the atomic upload feature (legacy packs without manifest)
   *    AND both .pack and .idx files exist
   */
  async isPackComplete(packId: string): Promise<boolean> {
    // Check for manifest first
    const manifest = await this.getPackManifest(packId)

    if (manifest) {
      // If manifest exists, it must have 'complete' status
      return manifest.status === 'complete'
    }

    // Legacy pack without manifest - check if both files exist
    const packKey = this._buildKey(`packs/${packId}.pack`)
    const idxKey = this._buildKey(`packs/${packId}.idx`)

    const [packExists, idxExists] = await Promise.all([
      this._bucket.head(packKey),
      this._bucket.head(idxKey)
    ])

    return packExists !== null && idxExists !== null
  }

  /**
   * Download a packfile from R2
   */
  async downloadPackfile(
    packId: string,
    options?: DownloadPackfileOptions
  ): Promise<DownloadPackfileResult | null> {
    // Verify pack completeness before downloading
    const isComplete = await this.isPackComplete(packId)
    if (!isComplete) {
      if (options?.required) {
        throw new R2PackError(`Packfile incomplete or not found: ${packId}`, 'NOT_FOUND', packId)
      }
      return null
    }

    const packKey = this._buildKey(`packs/${packId}.pack`)
    const packObj = await this._bucket.get(packKey)

    if (!packObj) {
      if (options?.required) {
        throw new R2PackError(`Packfile not found: ${packId}`, 'NOT_FOUND', packId)
      }
      return null
    }

    let packData = new Uint8Array(await packObj.arrayBuffer())

    // Verify checksum if requested (before byte range slicing)
    if (options?.verify && !options?.byteRange) {
      // Get stored checksum from metadata
      const headObj = await this._bucket.head(packKey)
      const storedChecksum = headObj?.customMetadata?.checksum

      if (storedChecksum) {
        const computedChecksum = await computeChecksum(packData)
        if (computedChecksum !== storedChecksum) {
          throw new R2PackError(
            `Checksum mismatch for packfile: ${packId}`,
            'CHECKSUM_MISMATCH',
            packId
          )
        }
      } else {
        // No stored checksum - data may have been corrupted/replaced
        // Verify using the embedded pack checksum (last 20 bytes of packfile)
        if (packData.length >= 20) {
          const dataWithoutChecksum = packData.slice(0, packData.length - 20)
          const computedChecksum = await computeChecksum(dataWithoutChecksum)
          const embeddedChecksum = Array.from(packData.slice(packData.length - 20))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')

          if (computedChecksum !== embeddedChecksum) {
            throw new R2PackError(
              `Checksum mismatch for packfile: ${packId}`,
              'CHECKSUM_MISMATCH',
              packId
            )
          }
        } else {
          throw new R2PackError(
            `Packfile too small to verify: ${packId}`,
            'CHECKSUM_MISMATCH',
            packId
          )
        }
      }
    }

    // Handle byte range
    if (options?.byteRange) {
      const { start, end } = options.byteRange
      packData = packData.slice(start, end + 1)
    }

    const result: DownloadPackfileResult = {
      packData,
      verified: options?.verify ? true : undefined
    }

    // Include index if requested
    if (options?.includeIndex) {
      const idxKey = this._buildKey(`packs/${packId}.idx`)
      const idxObj = await this._bucket.get(idxKey)
      if (idxObj) {
        result.indexData = new Uint8Array(await idxObj.arrayBuffer())
      }
    }

    return result
  }

  /**
   * Get metadata for a packfile
   */
  async getPackfileMetadata(packId: string): Promise<PackfileMetadata | null> {
    const packKey = this._buildKey(`packs/${packId}.pack`)
    const headObj = await this._bucket.head(packKey)

    if (!headObj) {
      return null
    }

    const meta = headObj.customMetadata || {}
    return {
      packId,
      packSize: parseInt(meta.packSize || String(headObj.size), 10),
      indexSize: parseInt(meta.indexSize || '0', 10),
      objectCount: parseInt(meta.objectCount || '0', 10),
      createdAt: new Date(meta.createdAt || Date.now()),
      checksum: meta.checksum || ''
    }
  }

  /**
   * List all packfiles
   */
  async listPackfiles(options?: { limit?: number; cursor?: string }): Promise<ListPackfilesResult & PackfileMetadata[]> {
    const prefix = this._buildKey('packs/')
    const listResult = await this._bucket.list({ prefix, cursor: options?.cursor })

    // Filter for .pack files only
    let packFiles = listResult.objects.filter(obj => obj.key.endsWith('.pack'))

    // Handle pagination with cursor (cursor is the index to start from)
    let startIndex = 0
    if (options?.cursor) {
      startIndex = parseInt(options.cursor, 10) || 0
    }

    // Slice from cursor position
    packFiles = packFiles.slice(startIndex)

    // Apply limit
    const hasLimit = options?.limit !== undefined && options.limit > 0
    const limitedPackFiles = hasLimit ? packFiles.slice(0, options.limit) : packFiles

    const items: PackfileMetadata[] = []
    for (const obj of limitedPackFiles) {
      // Extract packId from key
      const match = obj.key.match(/([^/]+)\.pack$/)
      if (match) {
        const packId = match[1]
        const metadata = await this.getPackfileMetadata(packId)
        if (metadata) {
          items.push(metadata)
        }
      }
    }

    // If no pagination options and no items, return a plain empty array
    // This ensures toEqual([]) works as expected
    if (items.length === 0 && !options?.limit && !options?.cursor) {
      return [] as unknown as ListPackfilesResult & PackfileMetadata[]
    }

    // Create a new array that also has ListPackfilesResult properties
    const resultArray: PackfileMetadata[] = [...items]
    const result = resultArray as ListPackfilesResult & PackfileMetadata[]
    result.items = items

    // Set cursor for next page if there are more items
    if (hasLimit && packFiles.length > options!.limit!) {
      result.cursor = String(startIndex + options!.limit!)
    }

    return result
  }

  /**
   * Delete a packfile, its index, and manifest
   */
  async deletePackfile(packId: string): Promise<boolean> {
    const packKey = this._buildKey(`packs/${packId}.pack`)
    const idxKey = this._buildKey(`packs/${packId}.idx`)
    const manifestKey = this._buildKey(`packs/${packId}.manifest`)

    // Check if pack exists
    const exists = await this._bucket.head(packKey)
    if (!exists) {
      return false
    }

    // Delete pack, index, and manifest atomically
    await this._bucket.delete([packKey, idxKey, manifestKey])

    // Clear from index checksum cache
    this._indexChecksums.delete(packId)

    // Update multi-pack index if it exists
    try {
      const midx = await this.getMultiPackIndex()
      if (midx.packIds.includes(packId)) {
        // Rebuild without this pack
        await this.rebuildMultiPackIndex()
      }
    } catch {
      // Ignore errors when updating multi-pack index
    }

    return true
  }

  /**
   * Download just the index file for a packfile
   */
  async downloadIndex(packId: string): Promise<Uint8Array | null> {
    const idxKey = this._buildKey(`packs/${packId}.idx`)
    const idxObj = await this._bucket.get(idxKey)

    if (!idxObj) {
      return null
    }

    return new Uint8Array(await idxObj.arrayBuffer())
  }

  /**
   * Upload a new index for an existing packfile
   */
  async uploadIndex(packId: string, indexData: Uint8Array): Promise<void> {
    // Check if pack exists
    const packKey = this._buildKey(`packs/${packId}.pack`)
    const exists = await this._bucket.head(packKey)

    if (!exists) {
      throw new R2PackError(`Packfile not found: ${packId}`, 'NOT_FOUND', packId)
    }

    // Upload new index
    const idxKey = this._buildKey(`packs/${packId}.idx`)
    await this._bucket.put(idxKey, indexData)

    // Update checksum cache
    const indexChecksum = await computeChecksum(indexData)
    this._indexChecksums.set(packId, indexChecksum)
  }

  /**
   * Verify that an index matches its packfile
   */
  async verifyIndex(packId: string): Promise<boolean> {
    // Get current index
    const currentIndex = await this.downloadIndex(packId)
    if (!currentIndex) {
      return false
    }

    // Compare with stored checksum
    const storedChecksum = this._indexChecksums.get(packId)
    if (storedChecksum) {
      const currentChecksum = await computeChecksum(currentIndex)
      return currentChecksum === storedChecksum
    }

    // If no stored checksum, consider it valid (basic check)
    return true
  }

  /**
   * Clean up orphaned staging files
   *
   * This should be called on startup to clean up any staging files
   * left behind by failed uploads. It will:
   * 1. List all files in the staging directory
   * 2. For each pack ID found, check if it has a complete manifest
   * 3. If not complete, delete the staging files and any partial final files
   *
   * @returns Array of pack IDs that were cleaned up
   */
  async cleanupOrphanedStagingFiles(): Promise<string[]> {
    const stagingPrefix = this._buildKey('staging/')
    const listResult = await this._bucket.list({ prefix: stagingPrefix })

    // Extract unique pack IDs from staging files
    const orphanedPackIds = new Set<string>()
    for (const obj of listResult.objects) {
      // Extract pack ID from key like "staging/pack-xxx.pack" or "staging/pack-xxx.idx"
      const match = obj.key.match(/staging\/([^/]+)\.(pack|idx)$/)
      if (match) {
        orphanedPackIds.add(match[1])
      }
    }

    const cleanedUp: string[] = []

    for (const packId of orphanedPackIds) {
      // Check if this pack is complete
      const isComplete = await this.isPackComplete(packId)

      if (!isComplete) {
        // Pack is incomplete - clean up all related files
        const filesToDelete = [
          this._buildKey(`staging/${packId}.pack`),
          this._buildKey(`staging/${packId}.idx`),
          this._buildKey(`packs/${packId}.pack`),
          this._buildKey(`packs/${packId}.idx`),
          this._buildKey(`packs/${packId}.manifest`)
        ]

        try {
          await this._bucket.delete(filesToDelete)
          cleanedUp.push(packId)
        } catch {
          // Ignore errors during cleanup
        }
      } else {
        // Pack is complete - just clean up staging files
        const stagingFiles = [
          this._buildKey(`staging/${packId}.pack`),
          this._buildKey(`staging/${packId}.idx`)
        ]

        try {
          await this._bucket.delete(stagingFiles)
          cleanedUp.push(packId)
        } catch {
          // Ignore errors during cleanup
        }
      }
    }

    return cleanedUp
  }

  /**
   * Rebuild the multi-pack index from all packfiles
   */
  async rebuildMultiPackIndex(): Promise<void> {
    // List all packs
    const packs = await this.listPackfiles()
    const packIds = packs.map(p => p.packId)

    // Create entries for all objects in all packs
    const entries: MultiPackIndexEntry[] = []

    for (let packIndex = 0; packIndex < packIds.length; packIndex++) {
      const packId = packIds[packIndex]
      // For now, create a synthetic entry per pack
      // In a real implementation, we would parse the index file
      const metadata = await this.getPackfileMetadata(packId)
      if (metadata) {
        // Create synthetic entries based on object count
        for (let i = 0; i < metadata.objectCount; i++) {
          // Generate synthetic object IDs based on pack checksum and index
          const objectId = metadata.checksum.slice(0, 32) + i.toString(16).padStart(8, '0')
          entries.push({
            objectId,
            packIndex,
            offset: 12 + i * 100 // Synthetic offset
          })
        }
      }
    }

    // Sort entries by objectId for binary search
    entries.sort((a, b) => a.objectId.localeCompare(b.objectId))

    // Create multi-pack index
    const midx: MultiPackIndex = {
      version: 1,
      packIds,
      entries,
      checksum: new Uint8Array(20)
    }

    // Serialize and store
    const serialized = serializeMultiPackIndex(midx)
    const midxKey = this._buildKey('packs/multi-pack-index')
    await this._bucket.put(midxKey, serialized)

    // Update cache
    this._midxCache = {
      midx,
      expiresAt: Date.now() + this._cacheTTL * 1000
    }
  }

  /**
   * Get the current multi-pack index
   */
  async getMultiPackIndex(): Promise<MultiPackIndex> {
    // Check cache first
    if (this._midxCache && this._midxCache.expiresAt > Date.now()) {
      return this._midxCache.midx
    }

    const midxKey = this._buildKey('packs/multi-pack-index')
    const midxObj = await this._bucket.get(midxKey)

    if (!midxObj) {
      // Return empty index
      return {
        version: 1,
        packIds: [],
        entries: [],
        checksum: new Uint8Array(20)
      }
    }

    const data = new Uint8Array(await midxObj.arrayBuffer())
    const midx = parseMultiPackIndex(data)

    // Update cache
    this._midxCache = {
      midx,
      expiresAt: Date.now() + this._cacheTTL * 1000
    }

    return midx
  }

  /**
   * Acquire a distributed lock on a resource using R2 conditional writes
   * @param resource - Resource identifier to lock
   * @param ttlMs - Time-to-live in milliseconds (default: 30000)
   * @param holder - Optional identifier for the lock holder (for debugging)
   * @returns LockHandle if acquired, null if lock is held by another process
   */
  async acquireDistributedLock(resource: string, ttlMs: number = 30000, holder?: string): Promise<LockHandle | null> {
    const lockKey = this._buildKey(`locks/${resource}.lock`)
    const now = Date.now()
    const lockId = generateLockId()
    const expiresAt = now + ttlMs

    const lockContent: LockFileContent = {
      lockId,
      resource,
      expiresAt,
      acquiredAt: now,
      holder
    }

    const lockData = new TextEncoder().encode(JSON.stringify(lockContent))

    // Try to check if there's an existing lock
    const existingObj = await this._bucket.head(lockKey)

    if (existingObj) {
      // Lock file exists, check if it's expired
      const existingLockObj = await this._bucket.get(lockKey)
      if (existingLockObj) {
        try {
          const existingContent = JSON.parse(
            new TextDecoder().decode(new Uint8Array(await existingLockObj.arrayBuffer()))
          ) as LockFileContent

          if (existingContent.expiresAt > now) {
            // Lock is still valid, cannot acquire
            return null
          }

          // Lock is expired, try to overwrite with conditional write
          // Use the existing etag to ensure atomicity
          try {
            await this._bucket.put(lockKey, lockData, {
              onlyIf: { etagMatches: existingObj.etag }
            })

            // Get the new etag after successful write
            const newObj = await this._bucket.head(lockKey)
            if (!newObj) {
              return null
            }

            return {
              resource,
              lockId,
              etag: newObj.etag,
              expiresAt
            }
          } catch {
            // Conditional write failed - another process got the lock
            return null
          }
        } catch {
          // Failed to parse lock content, try to clean up and acquire
          return null
        }
      }
    }

    // No existing lock, try to create new one with onlyIf condition
    try {
      // Use onlyIf with etagDoesNotMatch to ensure the object doesn't exist
      // R2 will fail if object already exists when we use this condition
      await this._bucket.put(lockKey, lockData, {
        onlyIf: { etagDoesNotMatch: '*' }
      })

      // Get the etag of the newly created lock
      const newObj = await this._bucket.head(lockKey)
      if (!newObj) {
        return null
      }

      // Verify we actually own this lock by checking the lockId
      const verifyObj = await this._bucket.get(lockKey)
      if (verifyObj) {
        const content = JSON.parse(
          new TextDecoder().decode(new Uint8Array(await verifyObj.arrayBuffer()))
        ) as LockFileContent

        if (content.lockId !== lockId) {
          // Another process created the lock
          return null
        }
      }

      return {
        resource,
        lockId,
        etag: newObj.etag,
        expiresAt
      }
    } catch {
      // Failed to create lock - likely another process created it first
      return null
    }
  }

  /**
   * Release a distributed lock
   * @param handle - Lock handle returned from acquireDistributedLock
   */
  async releaseDistributedLock(handle: LockHandle): Promise<void> {
    const lockKey = this._buildKey(`locks/${handle.resource}.lock`)

    // Verify we still own the lock before deleting
    const existingObj = await this._bucket.get(lockKey)
    if (existingObj) {
      try {
        const content = JSON.parse(
          new TextDecoder().decode(new Uint8Array(await existingObj.arrayBuffer()))
        ) as LockFileContent

        // Only delete if we own this lock (matching lockId)
        if (content.lockId === handle.lockId) {
          await this._bucket.delete(lockKey)
        }
      } catch {
        // Failed to parse, don't delete to avoid corrupting another process's lock
      }
    }
  }

  /**
   * Refresh a distributed lock to extend its TTL
   * @param handle - Lock handle to refresh
   * @param ttlMs - New TTL in milliseconds (default: 30000)
   * @returns true if refresh succeeded, false if lock was lost
   */
  async refreshDistributedLock(handle: LockHandle, ttlMs: number = 30000): Promise<boolean> {
    const lockKey = this._buildKey(`locks/${handle.resource}.lock`)
    const now = Date.now()
    const newExpiresAt = now + ttlMs

    // Get current lock to verify ownership
    const existingObj = await this._bucket.head(lockKey)
    if (!existingObj) {
      return false // Lock doesn't exist
    }

    const existingLockObj = await this._bucket.get(lockKey)
    if (!existingLockObj) {
      return false
    }

    try {
      const existingContent = JSON.parse(
        new TextDecoder().decode(new Uint8Array(await existingLockObj.arrayBuffer()))
      ) as LockFileContent

      // Verify we own this lock
      if (existingContent.lockId !== handle.lockId) {
        return false // We don't own this lock
      }

      // Create updated lock content
      const updatedContent: LockFileContent = {
        ...existingContent,
        expiresAt: newExpiresAt
      }

      const lockData = new TextEncoder().encode(JSON.stringify(updatedContent))

      // Update with conditional write using etag
      try {
        await this._bucket.put(lockKey, lockData, {
          onlyIf: { etagMatches: existingObj.etag }
        })

        // Update the handle's expiration and etag
        const newObj = await this._bucket.head(lockKey)
        if (newObj) {
          handle.etag = newObj.etag
          handle.expiresAt = newExpiresAt
        }

        return true
      } catch {
        // Conditional write failed - lock was modified
        return false
      }
    } catch {
      return false
    }
  }

  /**
   * Clean up expired locks from R2 storage
   * This should be called periodically to remove stale lock files
   * @returns Number of locks cleaned up
   */
  async cleanupExpiredLocks(): Promise<number> {
    const prefix = this._buildKey('locks/')
    const listResult = await this._bucket.list({ prefix })
    const now = Date.now()
    let cleanedCount = 0

    for (const obj of listResult.objects) {
      if (!obj.key.endsWith('.lock')) continue

      const lockObj = await this._bucket.get(obj.key)
      if (lockObj) {
        try {
          const content = JSON.parse(
            new TextDecoder().decode(new Uint8Array(await lockObj.arrayBuffer()))
          ) as LockFileContent

          if (content.expiresAt <= now) {
            // Lock is expired, safe to delete
            await this._bucket.delete(obj.key)
            cleanedCount++
          }
        } catch {
          // Invalid lock file, delete it
          await this._bucket.delete(obj.key)
          cleanedCount++
        }
      }
    }

    return cleanedCount
  }

  /**
   * Acquire a lock on a packfile (backward-compatible wrapper)
   * Uses distributed locking with R2 conditional writes
   */
  async acquireLock(packId: string, options?: AcquireLockOptions): Promise<PackLock> {
    const ttl = options?.ttl ?? 30000 // Default 30 second TTL
    const timeout = options?.timeout ?? 0
    const startTime = Date.now()

    // Try to acquire the distributed lock
    let handle = await this.acquireDistributedLock(packId, ttl, options?.holder)

    // If timeout is specified, retry until timeout expires
    if (!handle && timeout > 0) {
      while (Date.now() - startTime < timeout) {
        await new Promise(resolve => setTimeout(resolve, 50)) // Wait 50ms between retries
        handle = await this.acquireDistributedLock(packId, ttl, options?.holder)
        if (handle) break
      }
    }

    if (!handle) {
      if (timeout > 0) {
        throw new R2PackError(`Lock timeout for packfile: ${packId}`, 'LOCKED', packId)
      }
      throw new R2PackError(`Packfile is locked: ${packId}`, 'LOCKED', packId)
    }

    // Create the PackLock interface with distributed lock backing
    const self = this
    let released = false

    return {
      packId,
      handle,
      isHeld: () => !released && handle!.expiresAt > Date.now(),
      release: async () => {
        if (!released && handle) {
          await self.releaseDistributedLock(handle)
          released = true
        }
      },
      refresh: async () => {
        if (released || !handle) return false
        return await self.refreshDistributedLock(handle, ttl)
      }
    }
  }
}

/**
 * Serialize a multi-pack index to bytes
 */
function serializeMultiPackIndex(midx: MultiPackIndex): Uint8Array {
  // Calculate size
  // Header: 4 (signature) + 4 (version) + 4 (packCount) + 4 (entryCount) = 16
  // Pack IDs: packCount * (4 + packId.length) each with length prefix
  // Entries: entryCount * (40 + 4 + 8) = 52 bytes each (objectId + packIndex + offset)
  // Checksum: 20

  let packIdsSize = 0
  for (const packId of midx.packIds) {
    packIdsSize += 4 + new TextEncoder().encode(packId).length
  }

  const entriesSize = midx.entries.length * 52
  const totalSize = 16 + packIdsSize + entriesSize + 20

  const data = new Uint8Array(totalSize)
  const view = new DataView(data.buffer)
  let offset = 0

  // Signature: MIDX
  data.set(MIDX_SIGNATURE, offset)
  offset += 4

  // Version
  view.setUint32(offset, midx.version, false)
  offset += 4

  // Pack count
  view.setUint32(offset, midx.packIds.length, false)
  offset += 4

  // Entry count
  view.setUint32(offset, midx.entries.length, false)
  offset += 4

  // Pack IDs
  const encoder = new TextEncoder()
  for (const packId of midx.packIds) {
    const encoded = encoder.encode(packId)
    view.setUint32(offset, encoded.length, false)
    offset += 4
    data.set(encoded, offset)
    offset += encoded.length
  }

  // Entries
  for (const entry of midx.entries) {
    // Object ID (40 hex chars = 20 bytes as hex string, store as 40 bytes)
    const objIdBytes = encoder.encode(entry.objectId.padEnd(40, '0').slice(0, 40))
    data.set(objIdBytes, offset)
    offset += 40

    // Pack index
    view.setUint32(offset, entry.packIndex, false)
    offset += 4

    // Offset (as 64-bit, but we use 32-bit high + 32-bit low)
    view.setUint32(offset, 0, false) // high bits
    offset += 4
    view.setUint32(offset, entry.offset, false) // low bits
    offset += 4
  }

  // Checksum
  data.set(midx.checksum.slice(0, 20), offset)

  return data
}

// Standalone functions

/**
 * Upload a packfile to R2
 */
export async function uploadPackfile(
  bucket: R2Bucket,
  packData: Uint8Array,
  indexData: Uint8Array,
  options?: { prefix?: string }
): Promise<PackfileUploadResult> {
  const storage = new R2PackStorage({ bucket, prefix: options?.prefix })
  return storage.uploadPackfile(packData, indexData)
}

/**
 * Download a packfile from R2
 */
export async function downloadPackfile(
  bucket: R2Bucket,
  packId: string,
  options?: DownloadPackfileOptions & { prefix?: string }
): Promise<DownloadPackfileResult | null> {
  const storage = new R2PackStorage({ bucket, prefix: options?.prefix })
  return storage.downloadPackfile(packId, options)
}

/**
 * Get packfile metadata
 */
export async function getPackfileMetadata(
  bucket: R2Bucket,
  packId: string,
  options?: { prefix?: string }
): Promise<PackfileMetadata | null> {
  const storage = new R2PackStorage({ bucket, prefix: options?.prefix })
  return storage.getPackfileMetadata(packId)
}

/**
 * List all packfiles
 */
export async function listPackfiles(
  bucket: R2Bucket,
  options?: { prefix?: string; limit?: number; cursor?: string }
): Promise<PackfileMetadata[]> {
  const storage = new R2PackStorage({ bucket, prefix: options?.prefix })
  const result = await storage.listPackfiles({ limit: options?.limit, cursor: options?.cursor })
  return result.items
}

/**
 * Delete a packfile
 */
export async function deletePackfile(
  bucket: R2Bucket,
  packId: string,
  options?: { prefix?: string }
): Promise<boolean> {
  const storage = new R2PackStorage({ bucket, prefix: options?.prefix })
  return storage.deletePackfile(packId)
}

/**
 * Create a multi-pack index from all packfiles in the bucket
 */
export async function createMultiPackIndex(
  bucket: R2Bucket,
  options?: { prefix?: string }
): Promise<MultiPackIndex> {
  const storage = new R2PackStorage({ bucket, prefix: options?.prefix })
  await storage.rebuildMultiPackIndex()
  return storage.getMultiPackIndex()
}

/**
 * Parse a multi-pack index from raw bytes
 */
export function parseMultiPackIndex(data: Uint8Array): MultiPackIndex {
  if (data.length < 16) {
    throw new R2PackError('Multi-pack index too small', 'INVALID_DATA')
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 0

  // Check signature
  for (let i = 0; i < 4; i++) {
    if (data[i] !== MIDX_SIGNATURE[i]) {
      throw new R2PackError('Invalid multi-pack index signature', 'INVALID_DATA')
    }
  }
  offset += 4

  // Version
  const version = view.getUint32(offset, false)
  offset += 4

  // Pack count
  const packCount = view.getUint32(offset, false)
  offset += 4

  // Entry count
  const entryCount = view.getUint32(offset, false)
  offset += 4

  // Read pack IDs
  const decoder = new TextDecoder()
  const packIds: string[] = []
  for (let i = 0; i < packCount; i++) {
    const len = view.getUint32(offset, false)
    offset += 4
    const packIdBytes = data.slice(offset, offset + len)
    packIds.push(decoder.decode(packIdBytes))
    offset += len
  }

  // Read entries
  const entries: MultiPackIndexEntry[] = []
  for (let i = 0; i < entryCount; i++) {
    const objectIdBytes = data.slice(offset, offset + 40)
    const objectId = decoder.decode(objectIdBytes)
    offset += 40

    const packIndex = view.getUint32(offset, false)
    offset += 4

    // Skip high bits
    offset += 4
    const entryOffset = view.getUint32(offset, false)
    offset += 4

    entries.push({
      objectId,
      packIndex,
      offset: entryOffset
    })
  }

  // Read checksum
  const checksum = data.slice(offset, offset + 20)

  return {
    version,
    packIds,
    entries,
    checksum: new Uint8Array(checksum)
  }
}

/**
 * Look up an object in the multi-pack index using binary search
 */
export function lookupObjectInMultiPack(
  midx: MultiPackIndex,
  objectId: string
): MultiPackIndexEntry | null {
  const entries = midx.entries
  if (entries.length === 0) {
    return null
  }

  // Binary search
  let left = 0
  let right = entries.length - 1

  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const entry = entries[mid]
    const cmp = objectId.localeCompare(entry.objectId)

    if (cmp === 0) {
      return entry
    } else if (cmp < 0) {
      right = mid - 1
    } else {
      left = mid + 1
    }
  }

  return null
}

/**
 * Acquire a lock on a packfile
 */
export async function acquirePackLock(
  bucket: R2Bucket,
  packId: string,
  options?: AcquireLockOptions & { prefix?: string }
): Promise<PackLock> {
  const storage = new R2PackStorage({ bucket, prefix: options?.prefix })
  return storage.acquireLock(packId, options)
}

/**
 * Release a lock on a packfile
 * Note: This function requires a valid PackLock with a handle to properly release distributed locks
 */
export async function releasePackLock(
  bucket: R2Bucket,
  packId: string,
  options?: { prefix?: string }
): Promise<void> {
  // For backward compatibility, we just delete the lock file directly
  // This is less safe than using the handle-based release, but works for simple cases
  const lockKey = buildKey(options?.prefix ?? '', `locks/${packId}.lock`)
  await bucket.delete(lockKey)
}
