# R2 Bundle Storage Pattern

## Overview

This document describes a storage pattern for fsx and gitx that stores multiple logical files/blobs in a **single R2 object** with an offset map/index, optimizing for:

1. **Reduced R2 operations** - Fewer GET/PUT requests = lower costs
2. **Efficient range reads** - R2 supports byte-range requests
3. **DO SQLite integration** - Works with 2MB BLOB chunking in Durable Object SQLite
4. **Append-only growth** - Supports incremental additions without rewriting

---

## Design Principles

### Prior Art

1. **Git Packfiles** - Store multiple objects with header-based indexing
   - Pack format: `PACK` + version + object count + objects + SHA trailer
   - Index format (v2): Fanout table + SHA list + CRC list + offset list
   - Uses deflate compression per-object

2. **Parquet/Iceberg** - Footer-based metadata
   - Data stored first, metadata at end
   - Footer contains row group locations, column chunk offsets
   - Enables reading metadata with single range request to end of file

3. **SQLite VFS** - Single-file database
   - Page-based structure with header at offset 0
   - B-tree index for fast lookups
   - WAL for durability

### Design Choice: Header-Based Index

We choose a **header-based index** (like Git packfiles) rather than footer-based (like Parquet) because:

1. **Append-friendly** - Can add objects without rewriting footer
2. **Streaming writes** - Write header, then append objects
3. **Fast initial read** - Read header first to get all offsets
4. **R2 range read optimization** - Single request for index, then targeted reads

---

## Data Structure

### Bundle File Format

```
+------------------+-------------------+
| BUNDLE HEADER    | Fixed 32 bytes    |
+------------------+-------------------+
| INDEX SECTION    | Variable size     |
|  - Entry count   |                   |
|  - Index entries |                   |
+------------------+-------------------+
| DATA SECTION     | Variable size     |
|  - Object 1      |                   |
|  - Object 2      |                   |
|  - ...           |                   |
+------------------+-------------------+
| FOOTER           | 20 bytes          |
|  - Checksum      |                   |
+------------------+-------------------+
```

### Header (32 bytes)

```typescript
interface BundleHeader {
  magic: string           // 4 bytes: "BNDL"
  version: number         // 4 bytes: uint32 BE
  entryCount: number      // 4 bytes: uint32 BE
  indexSize: number       // 4 bytes: uint32 BE (bytes)
  dataOffset: number      // 8 bytes: uint64 BE
  flags: number           // 4 bytes: uint32 (compression, etc.)
  reserved: Uint8Array    // 4 bytes: future use
}
```

### Index Entry (48 bytes per entry)

```typescript
interface IndexEntry {
  // Identification (24 bytes)
  keyHash: Uint8Array     // 20 bytes: SHA-1 of key
  keyLength: number       // 4 bytes: uint32 BE

  // Location (16 bytes)
  offset: number          // 8 bytes: uint64 BE (from data section start)
  size: number            // 4 bytes: uint32 BE (compressed size)
  uncompressedSize: number // 4 bytes: uint32 BE

  // Metadata (8 bytes)
  type: number            // 2 bytes: object type (file, dir, blob, etc.)
  flags: number           // 2 bytes: compression, chunk status
  crc32: number           // 4 bytes: data integrity check
}
```

### Extended Key Storage

For keys longer than what fits in the hash, store full keys after the index:

```typescript
interface ExtendedKeySection {
  // After index entries, before data
  keys: Array<{
    length: number        // 4 bytes: varint
    data: Uint8Array      // variable: UTF-8 key
  }>
}
```

---

## Implementation

### TypeScript Types

```typescript
/**
 * Bundle storage configuration
 */
interface BundleConfig {
  /** Maximum bundle size before rotation (default: 100MB) */
  maxBundleSize: number

  /** Maximum objects per bundle (default: 10000) */
  maxObjects: number

  /** Compression level (0=none, 1-9=zlib) */
  compressionLevel: number

  /** Enable CRC32 verification */
  enableCRC: boolean

  /** R2 key prefix for bundles */
  prefix: string
}

/**
 * Bundle metadata stored in SQLite
 */
interface BundleMeta {
  id: string              // UUID
  r2Key: string           // R2 object key
  entryCount: number      // Number of objects
  size: number            // Total bundle size
  dataOffset: number      // Where data section starts
  createdAt: number       // Timestamp
  sealed: boolean         // No more appends allowed
}

/**
 * Object index stored in SQLite for fast lookups
 */
interface ObjectIndex {
  keyHash: string         // Hex SHA-1 of key
  key: string             // Full key (path or blob ID)
  bundleId: string        // Which bundle contains it
  offset: number          // Offset within bundle data section
  size: number            // Compressed size
  uncompressedSize: number
  type: 'file' | 'blob' | 'chunk' | 'metadata'
  crc32: number
}
```

### SQLite Schema

```sql
-- Bundle metadata
CREATE TABLE bundles (
  id TEXT PRIMARY KEY,
  r2_key TEXT UNIQUE NOT NULL,
  entry_count INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  data_offset INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  sealed INTEGER NOT NULL DEFAULT 0,
  checksum TEXT
);

-- Object index for fast lookups (covers all bundles)
CREATE TABLE bundle_objects (
  key_hash TEXT NOT NULL,
  key TEXT NOT NULL,
  bundle_id TEXT NOT NULL REFERENCES bundles(id),
  offset INTEGER NOT NULL,
  size INTEGER NOT NULL,
  uncompressed_size INTEGER NOT NULL,
  type TEXT NOT NULL,
  crc32 INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (key_hash, bundle_id)
);

-- Indexes for fast lookup
CREATE INDEX idx_bundle_objects_key ON bundle_objects(key);
CREATE INDEX idx_bundle_objects_bundle ON bundle_objects(bundle_id);

-- Active bundle for appends
CREATE TABLE active_bundle (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  bundle_id TEXT REFERENCES bundles(id)
);
```

---

## Read/Write Algorithms

### Write Algorithm

```typescript
class BundleWriter {
  private activeBundle: BundleMeta | null = null
  private pendingWrites: Array<{key: string, data: Uint8Array}> = []

  async write(key: string, data: Uint8Array): Promise<void> {
    // 1. Compress data
    const compressed = await compress(data)
    const crc32 = calculateCRC32(compressed)

    // 2. Get or create active bundle
    if (!this.activeBundle || this.shouldRotate()) {
      await this.rotateBundle()
    }

    // 3. Add to pending writes (batched)
    this.pendingWrites.push({ key, data: compressed })

    // 4. Record in SQLite index immediately
    await this.sql.exec(`
      INSERT INTO bundle_objects
      (key_hash, key, bundle_id, offset, size, uncompressed_size, type, crc32, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, sha1Hex(key), key, this.activeBundle.id,
       this.activeBundle.size, compressed.length, data.length,
       'blob', crc32, Date.now())

    // 5. Update bundle metadata
    this.activeBundle.size += compressed.length
    this.activeBundle.entryCount++
  }

  async flush(): Promise<void> {
    if (this.pendingWrites.length === 0) return

    // Build append buffer
    const appendData = concatBuffers(
      this.pendingWrites.map(w => w.data)
    )

    // Append to R2 using multipart upload
    await this.appendToR2(this.activeBundle.r2Key, appendData)

    // Clear pending
    this.pendingWrites = []
  }

  private shouldRotate(): boolean {
    return (
      this.activeBundle.size >= this.config.maxBundleSize ||
      this.activeBundle.entryCount >= this.config.maxObjects
    )
  }

  private async rotateBundle(): Promise<void> {
    // Seal current bundle
    if (this.activeBundle) {
      await this.sealBundle(this.activeBundle)
    }

    // Create new bundle
    const id = crypto.randomUUID()
    const r2Key = `${this.config.prefix}/${id}.bundle`

    // Write initial header (placeholder)
    const header = createBundleHeader({
      entryCount: 0,
      indexSize: 0,
      dataOffset: 32, // Header size
      flags: 0
    })
    await this.r2.put(r2Key, header)

    // Record in SQLite
    this.activeBundle = {
      id,
      r2Key,
      entryCount: 0,
      size: 32,
      dataOffset: 32,
      createdAt: Date.now(),
      sealed: false
    }

    await this.sql.exec(`
      INSERT INTO bundles (id, r2_key, entry_count, size, data_offset, created_at, sealed)
      VALUES (?, ?, 0, 32, 32, ?, 0)
    `, id, r2Key, Date.now())

    await this.sql.exec(`
      INSERT OR REPLACE INTO active_bundle (id, bundle_id) VALUES (1, ?)
    `, id)
  }

  private async sealBundle(bundle: BundleMeta): Promise<void> {
    // 1. Build complete index from SQLite
    const entries = await this.sql.exec<ObjectIndex>(`
      SELECT * FROM bundle_objects WHERE bundle_id = ? ORDER BY offset
    `, bundle.id).toArray()

    // 2. Build index section
    const indexBuffer = buildIndexSection(entries)

    // 3. Rebuild bundle with proper header + index + data
    // This requires reading existing data and rewriting
    const existingData = await this.r2.get(bundle.r2Key)
    const dataSection = (await existingData.arrayBuffer()).slice(bundle.dataOffset)

    const newBundle = buildBundle({
      entries,
      data: new Uint8Array(dataSection)
    })

    // 4. Upload final bundle
    await this.r2.put(bundle.r2Key, newBundle)

    // 5. Update metadata
    await this.sql.exec(`
      UPDATE bundles SET sealed = 1, checksum = ? WHERE id = ?
    `, sha1Hex(newBundle), bundle.id)
  }
}
```

### Read Algorithm

```typescript
class BundleReader {
  // Cache for frequently accessed bundle headers/indexes
  private indexCache = new LRUCache<string, IndexEntry[]>(100)

  async read(key: string): Promise<Uint8Array | null> {
    // 1. Look up in SQLite index
    const entry = await this.sql.exec<ObjectIndex>(`
      SELECT * FROM bundle_objects WHERE key = ? LIMIT 1
    `, key).one()

    if (!entry) return null

    // 2. Get bundle info
    const bundle = await this.sql.exec<BundleMeta>(`
      SELECT * FROM bundles WHERE id = ?
    `, entry.bundle_id).one()

    // 3. Calculate byte range
    const start = bundle.data_offset + entry.offset
    const end = start + entry.size - 1

    // 4. Range read from R2
    const response = await this.r2.get(bundle.r2_key, {
      range: { offset: start, length: entry.size }
    })

    if (!response) return null

    const compressed = new Uint8Array(await response.arrayBuffer())

    // 5. Verify CRC32
    if (this.config.enableCRC) {
      const actualCRC = calculateCRC32(compressed)
      if (actualCRC !== entry.crc32) {
        throw new Error(`CRC mismatch for key ${key}`)
      }
    }

    // 6. Decompress and return
    return decompress(compressed)
  }

  async readMultiple(keys: string[]): Promise<Map<string, Uint8Array>> {
    // Batch lookup
    const entries = await this.sql.exec<ObjectIndex>(`
      SELECT * FROM bundle_objects WHERE key IN (${keys.map(() => '?').join(',')})
    `, ...keys).toArray()

    // Group by bundle for efficient fetching
    const byBundle = new Map<string, ObjectIndex[]>()
    for (const entry of entries) {
      const list = byBundle.get(entry.bundle_id) || []
      list.push(entry)
      byBundle.set(entry.bundle_id, list)
    }

    const results = new Map<string, Uint8Array>()

    // Fetch from each bundle
    for (const [bundleId, bundleEntries] of byBundle) {
      const bundle = await this.getBundleMeta(bundleId)

      // Sort by offset for sequential reading
      bundleEntries.sort((a, b) => a.offset - b.offset)

      // Check if entries are contiguous for single range read
      if (this.areContiguous(bundleEntries)) {
        // Single range read
        const start = bundle.data_offset + bundleEntries[0].offset
        const totalSize = bundleEntries.reduce((sum, e) => sum + e.size, 0)

        const response = await this.r2.get(bundle.r2_key, {
          range: { offset: start, length: totalSize }
        })

        const data = new Uint8Array(await response.arrayBuffer())
        let offset = 0

        for (const entry of bundleEntries) {
          const chunk = data.slice(offset, offset + entry.size)
          results.set(entry.key, decompress(chunk))
          offset += entry.size
        }
      } else {
        // Multiple range reads (or full bundle read if cheaper)
        for (const entry of bundleEntries) {
          const data = await this.read(entry.key)
          if (data) results.set(entry.key, data)
        }
      }
    }

    return results
  }
}
```

---

## Compaction Strategy

### When to Compact

1. **Fragmentation threshold** - >30% of bundle is deleted objects
2. **Small bundles** - Multiple bundles under 10MB each
3. **Age-based** - Bundles older than 30 days with low access
4. **Manual trigger** - User-initiated maintenance

### Compaction Algorithm

```typescript
class BundleCompactor {
  async compact(): Promise<CompactionResult> {
    // 1. Identify bundles to compact
    const candidates = await this.findCompactionCandidates()

    if (candidates.length < 2) {
      return { bundlesCompacted: 0 }
    }

    // 2. Read all live objects from candidate bundles
    const liveObjects: Array<{key: string, data: Uint8Array}> = []

    for (const bundle of candidates) {
      const entries = await this.sql.exec<ObjectIndex>(`
        SELECT * FROM bundle_objects
        WHERE bundle_id = ? AND deleted = 0
        ORDER BY offset
      `, bundle.id).toArray()

      for (const entry of entries) {
        const data = await this.readFromBundle(bundle, entry)
        liveObjects.push({ key: entry.key, data })
      }
    }

    // 3. Create new compacted bundle(s)
    const writer = new BundleWriter(this.config)

    for (const obj of liveObjects) {
      await writer.write(obj.key, obj.data)
    }

    await writer.flush()

    // 4. Update SQLite atomically
    await this.sql.exec('BEGIN TRANSACTION')

    try {
      // Delete old entries
      for (const bundle of candidates) {
        await this.sql.exec('DELETE FROM bundle_objects WHERE bundle_id = ?', bundle.id)
        await this.sql.exec('DELETE FROM bundles WHERE id = ?', bundle.id)
      }

      await this.sql.exec('COMMIT')
    } catch (e) {
      await this.sql.exec('ROLLBACK')
      throw e
    }

    // 5. Delete old R2 objects
    for (const bundle of candidates) {
      await this.r2.delete(bundle.r2_key)
    }

    return {
      bundlesCompacted: candidates.length,
      objectsMoved: liveObjects.length
    }
  }

  private async findCompactionCandidates(): Promise<BundleMeta[]> {
    // Find sealed bundles with high fragmentation
    return this.sql.exec<BundleMeta>(`
      SELECT b.*,
        (SELECT COUNT(*) FROM bundle_objects WHERE bundle_id = b.id AND deleted = 1) as deleted_count,
        (SELECT COUNT(*) FROM bundle_objects WHERE bundle_id = b.id) as total_count
      FROM bundles b
      WHERE b.sealed = 1
      AND (deleted_count * 1.0 / total_count) > 0.3
      ORDER BY b.size ASC
      LIMIT 10
    `).toArray()
  }
}
```

---

## Integration with DO SQLite Hot Tier

### 2MB BLOB Chunking Strategy

DO SQLite has a soft limit around 2MB for BLOBs. For the hot tier:

```typescript
const CHUNK_SIZE = 2 * 1024 * 1024 - 1024  // ~2MB with safety margin

class ChunkedHotTier {
  async store(key: string, data: Uint8Array): Promise<void> {
    if (data.length <= CHUNK_SIZE) {
      // Single chunk
      await this.sql.exec(`
        INSERT INTO hot_objects (key, chunk_index, data, total_size, total_chunks)
        VALUES (?, 0, ?, ?, 1)
      `, key, data, data.length)
    } else {
      // Multiple chunks
      const chunks = Math.ceil(data.length / CHUNK_SIZE)

      for (let i = 0; i < chunks; i++) {
        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, data.length)
        const chunk = data.slice(start, end)

        await this.sql.exec(`
          INSERT INTO hot_objects (key, chunk_index, data, total_size, total_chunks)
          VALUES (?, ?, ?, ?, ?)
        `, key, i, chunk, data.length, chunks)
      }
    }
  }

  async retrieve(key: string): Promise<Uint8Array | null> {
    const chunks = await this.sql.exec<{chunk_index: number, data: ArrayBuffer, total_size: number}>(`
      SELECT chunk_index, data, total_size FROM hot_objects
      WHERE key = ? ORDER BY chunk_index
    `, key).toArray()

    if (chunks.length === 0) return null

    if (chunks.length === 1) {
      return new Uint8Array(chunks[0].data)
    }

    // Reassemble
    const result = new Uint8Array(chunks[0].total_size)
    let offset = 0

    for (const chunk of chunks) {
      const data = new Uint8Array(chunk.data)
      result.set(data, offset)
      offset += data.length
    }

    return result
  }
}
```

### Tiered Storage Integration

```typescript
class TieredBundleStorage {
  private hot: ChunkedHotTier
  private warm: BundleStorage  // R2 bundles
  private accessCount = new Map<string, number>()

  async get(key: string): Promise<Uint8Array | null> {
    // 1. Try hot tier
    const hotData = await this.hot.retrieve(key)
    if (hotData) {
      this.recordAccess(key)
      return hotData
    }

    // 2. Try warm tier (R2 bundles)
    const warmData = await this.warm.read(key)
    if (warmData) {
      this.recordAccess(key)

      // Promote to hot if frequently accessed
      if (this.shouldPromote(key)) {
        await this.hot.store(key, warmData)
      }

      return warmData
    }

    return null
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    // Small, frequently written objects go to hot tier
    if (data.length <= 100 * 1024) {  // 100KB threshold
      await this.hot.store(key, data)
    } else {
      // Large objects go directly to R2 bundles
      await this.warm.write(key, data)
    }
  }

  async demote(): Promise<number> {
    // Move cold objects from hot to warm
    const candidates = await this.sql.exec<{key: string}>(`
      SELECT DISTINCT key FROM hot_objects
      WHERE last_accessed < ?
      ORDER BY last_accessed ASC
      LIMIT 100
    `, Date.now() - 7 * 24 * 60 * 60 * 1000).toArray()

    let demoted = 0

    for (const {key} of candidates) {
      const data = await this.hot.retrieve(key)
      if (data) {
        await this.warm.write(key, data)
        await this.sql.exec('DELETE FROM hot_objects WHERE key = ?', key)
        demoted++
      }
    }

    return demoted
  }
}
```

---

## Cost Analysis

### Many Small Objects vs. Bundle Pattern

#### R2 Pricing (as of 2024)
- Storage: $0.015/GB/month
- Class A operations (PUT, POST, LIST): $4.50/million
- Class B operations (GET, HEAD): $0.36/million
- Free egress

#### Scenario: 100,000 files averaging 10KB each

**Many Small Objects:**
- Storage: 1GB = $0.015/month
- Initial writes: 100,000 PUTs = $0.45
- Monthly reads (assume 10% accessed): 10,000 GETs = $0.0036
- **Total first month: $0.47**

**Bundle Pattern (100 bundles of 1000 objects each):**
- Storage: 1GB + ~5MB indexes = $0.015/month
- Initial writes: 100 PUTs = $0.00045
- Monthly reads (same 10%): ~100 range GETs = $0.000036
- **Total first month: $0.015**

**Savings: 96.8%** for write-heavy workloads

#### Additional Benefits

1. **Reduced latency** - Fewer round trips for batch reads
2. **Better compression** - Cross-object compression opportunities
3. **Atomic batch writes** - All-or-nothing semantics
4. **Simplified GC** - Delete one bundle vs. thousands of objects

#### Tradeoffs

1. **Complexity** - More code to maintain
2. **Compaction overhead** - Periodic rewriting needed
3. **Failure domain** - Bundle corruption affects all contained objects
4. **Read amplification** - May read more bytes than needed

---

## Code Examples

### Basic Usage

```typescript
import { BundleStorage } from 'gitx/storage/bundle'

// Initialize
const storage = new BundleStorage({
  r2: env.R2_BUCKET,
  sql: ctx.storage.sql,
  prefix: 'fs/bundles',
  maxBundleSize: 100 * 1024 * 1024,
  compressionLevel: 6
})

// Write files
await storage.write('/path/to/file.txt', textEncoder.encode('Hello World'))
await storage.write('/path/to/image.png', imageData)

// Flush to R2
await storage.flush()

// Read files
const content = await storage.read('/path/to/file.txt')

// Batch read
const files = await storage.readMultiple([
  '/path/to/file.txt',
  '/path/to/image.png'
])

// Delete (marks as deleted, cleaned up during compaction)
await storage.delete('/path/to/file.txt')

// Trigger compaction
const result = await storage.compact()
console.log(`Compacted ${result.bundlesCompacted} bundles`)
```

### Integration with FsModule

```typescript
class FsModule {
  private bundleStorage: BundleStorage
  private hotStorage: ChunkedHotTier

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    // Store in appropriate tier
    if (data.length <= HOT_TIER_THRESHOLD) {
      await this.hotStorage.store(path, data)
    } else {
      await this.bundleStorage.write(path, data)
    }

    // Update metadata
    await this.updateFileMetadata(path, data.length)
  }

  async readFile(path: string): Promise<Uint8Array | null> {
    // Check hot tier first
    const hotData = await this.hotStorage.retrieve(path)
    if (hotData) return hotData

    // Fall back to R2 bundles
    return this.bundleStorage.read(path)
  }
}
```

---

## Migration Path

### Phase 1: Parallel Write
- Write to both old (loose objects) and new (bundles) storage
- Read from old first, fall back to new

### Phase 2: Background Migration
- Migrate existing objects to bundles during low-usage periods
- Track migration progress in SQLite

### Phase 3: Cutover
- Switch reads to bundles first
- Disable writes to old storage
- Clean up old objects

### Phase 4: Cleanup
- Delete migrated loose objects from R2
- Remove migration tracking tables

---

## Future Enhancements

1. **Delta compression** - Store similar objects as deltas (like Git)
2. **Bloom filters** - Negative lookups without SQLite query
3. **Predictive prefetching** - Load related objects proactively
4. **Cross-bundle deduplication** - Dedupe across bundles during compaction
5. **Encryption at rest** - Per-bundle or per-object encryption
6. **Replication** - Multi-region bundle copies

---

## References

- [Git Packfile Format](https://git-scm.com/docs/pack-format)
- [Apache Parquet Format](https://parquet.apache.org/docs/file-format/)
- [R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [DO SQLite Limits](https://developers.cloudflare.com/durable-objects/api/storage-sql/)
