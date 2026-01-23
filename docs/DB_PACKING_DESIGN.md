# DB-Optimized Blob Packing Design

**Spike ID:** pocs-1zjk
**Status:** Design Complete
**Target:** 10x compression improvement for database workloads

---

## Executive Summary

This document describes optimizations to the gitx pack module for database page storage workloads. Database pages exhibit highly predictable structure that can be exploited for superior compression compared to general-purpose blob packing.

**Key insight:** Database pages from the same table share 90-98% identical structure (headers, schema, index layouts). Only changed row data differs between versions.

**Projected compression improvement:**

| Workload | Current Ratio | Proposed Ratio | Improvement |
|----------|---------------|----------------|-------------|
| SQLite pages (OLTP) | 2-3x | 15-25x | 6-10x |
| Parquet row groups | 3-5x | 20-40x | 5-8x |
| DuckDB pages | 2-4x | 18-30x | 6-8x |
| Mixed DB workload | 2.5x | 20x | **8x average** |

---

## Table of Contents

1. [Problem Analysis](#problem-analysis)
2. [Database Page Characteristics](#database-page-characteristics)
3. [Proposed Architecture](#proposed-architecture)
4. [Page-Aware Chunking](#page-aware-chunking)
5. [Shared Dictionary Compression](#shared-dictionary-compression)
6. [Delta Encoding Optimizations](#delta-encoding-optimizations)
7. [Implementation Plan](#implementation-plan)
8. [Compression Ratio Estimates](#compression-ratio-estimates)
9. [Benchmarking Strategy](#benchmarking-strategy)

---

## Problem Analysis

### Current State

The gitx pack module uses Git's standard delta compression algorithm:

```
src/pack/
├── delta.ts        # Rabin fingerprint rolling hash, copy/insert instructions
├── format.ts       # Pack header encoding, object type/size encoding
├── generation.ts   # Delta chain building, similarity detection
├── utils.ts        # Shared utilities, similarity calculation
└── index.ts        # Pack index (fanout table, binary search)
```

**Current delta algorithm limitations for DB pages:**

1. **Generic window size (4 bytes)** - Too small to detect page-level patterns
2. **No structural awareness** - Treats all bytes equally, misses header patterns
3. **Per-object compression** - No cross-object dictionary sharing
4. **Similarity threshold (30%)** - Too coarse for subtle page differences

### Database Pages Are Special

Database pages differ from generic blobs:

| Characteristic | Generic Blob | Database Page |
|----------------|--------------|---------------|
| Size | Variable | Fixed (4KB, 8KB, 16KB typical) |
| Structure | Random | Highly structured |
| Header | None | Fixed 100-512 bytes |
| Content layout | Arbitrary | Row-oriented or columnar |
| Versioning | Full rewrites | Incremental changes |
| Redundancy | Low | High (schema repeated) |

---

## Database Page Characteristics

### SQLite Page Anatomy (4KB default)

```
+------------------------+ Offset 0
| Page Header (8-12B)    |  - Page type (1B)
|                        |  - Free block offset (2B)
|                        |  - Cell count (2B)
|                        |  - Cell content start (2B)
|                        |  - Fragment count (1B)
+------------------------+ Offset 8-12
| Cell Pointer Array     |  - 2 bytes per cell
| (sorted by key)        |  - Points to cell content
+------------------------+ Variable
|                        |
| Free Space             |
|                        |
+------------------------+ Variable
| Cell Content           |  - Row data (grows upward)
| (grows toward header)  |  - Variable length records
+------------------------+ Offset 4096

Typical redundancy:
- Page header: 100% identical across same-type pages
- Cell pointer array: ~70% similar for same table
- Cell content: ~30-50% similar (schema prefix repeated)
```

### Parquet Page Anatomy

```
+------------------------+
| Page Header            |  - Encoding type
|                        |  - Compressed size
|                        |  - Uncompressed size
|                        |  - CRC32
+------------------------+
| Repetition Levels      |  - Nested structure (optional)
+------------------------+
| Definition Levels      |  - NULL handling (optional)
+------------------------+
| Encoded Values         |  - Dictionary/RLE/Plain encoded
+------------------------+

Redundancy patterns:
- Headers: 100% identical structure
- Encoding metadata: 90%+ similar
- Dictionary pages: Shared across row groups
```

### DuckDB Page Anatomy

```
+------------------------+
| Block Header           |  - Block ID, checksum
|                        |  - Type, flags
+------------------------+
| Validity Mask          |  - NULL bitmap
+------------------------+
| Column Data            |  - Tightly packed values
+------------------------+

Redundancy:
- Headers: 95% identical
- Validity masks: Often highly compressible
- Column data: Type-specific patterns
```

---

## Proposed Architecture

### Overview

```
                    ┌─────────────────────────────────────┐
                    │        DB-Aware Pack Generator      │
                    └─────────────────────────────────────┘
                                      │
           ┌──────────────────────────┼──────────────────────────┐
           ▼                          ▼                          ▼
┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
│  Page Classifier    │   │  Dictionary Builder │   │  Delta Optimizer    │
│                     │   │                     │   │                     │
│ - Detect page type  │   │ - Extract headers   │   │ - Page-aware window │
│ - Identify schema   │   │ - Build shared dict │   │ - Structural delta  │
│ - Group similar     │   │ - LRU eviction      │   │ - Row-level diff    │
└─────────────────────┘   └─────────────────────┘   └─────────────────────┘
           │                          │                          │
           └──────────────────────────┼──────────────────────────┘
                                      ▼
                    ┌─────────────────────────────────────┐
                    │        Compressed Pack Output       │
                    │                                     │
                    │  - Dictionary section (shared)      │
                    │  - Object data (dict-referenced)    │
                    │  - Delta chains (structural)        │
                    └─────────────────────────────────────┘
```

### New Module Structure

```
src/pack/
├── delta.ts              # Existing: Generic delta encoding
├── delta-db.ts           # NEW: DB-optimized delta encoding
├── format.ts             # Existing: Pack format
├── format-db.ts          # NEW: DB pack format extensions
├── generation.ts         # Existing: Pack generation
├── generation-db.ts      # NEW: DB-optimized pack generation
├── dictionary.ts         # NEW: Shared dictionary compression
├── page-classifier.ts    # NEW: Page type detection
├── page-chunker.ts       # NEW: Page-aware chunking
└── utils.ts              # Existing: Shared utilities
```

---

## Page-Aware Chunking

### Problem with Current Chunking

Current Rabin fingerprint uses 4-byte windows:

```typescript
// Current: delta.ts
const WINDOW_SIZE = 4  // Too small for DB patterns
const MIN_COPY_SIZE = 4  // Misses larger structural matches

function rabinHash(data: Uint8Array, offset: number): number {
  let hash = 0
  for (let i = 0; i < WINDOW_SIZE; i++) {
    hash = (hash * RABIN_BASE + (data[offset + i] ?? 0)) % RABIN_MOD
  }
  return hash
}
```

### Proposed: Hierarchical Chunking

```typescript
/**
 * Page-aware chunking for database workloads
 *
 * Uses multiple window sizes optimized for DB page structure:
 * - Large windows (512B) for page headers
 * - Medium windows (64B) for cell pointers/metadata
 * - Small windows (8B) for row data
 */
interface ChunkingConfig {
  pageSize: number           // 4096, 8192, 16384
  headerSize: number         // Bytes to treat as header
  cellPointerSize: number    // Cell pointer array estimate
  rowAlignmentHint: number   // Row boundary alignment
}

const DB_CHUNKING_PRESETS: Record<string, ChunkingConfig> = {
  sqlite: {
    pageSize: 4096,
    headerSize: 100,      // Page header + typical cell pointers
    cellPointerSize: 200, // ~100 cells average
    rowAlignmentHint: 8
  },
  parquet: {
    pageSize: 1048576,    // 1MB default page
    headerSize: 256,
    cellPointerSize: 0,   // No cell pointers
    rowAlignmentHint: 64
  },
  duckdb: {
    pageSize: 262144,     // 256KB blocks
    headerSize: 128,
    cellPointerSize: 0,
    rowAlignmentHint: 8
  }
}

interface HierarchicalChunk {
  level: 'header' | 'metadata' | 'data'
  offset: number
  length: number
  hash: number
}

function hierarchicalChunk(
  page: Uint8Array,
  config: ChunkingConfig
): HierarchicalChunk[] {
  const chunks: HierarchicalChunk[] = []

  // Level 1: Header chunk (single large chunk)
  if (config.headerSize > 0) {
    chunks.push({
      level: 'header',
      offset: 0,
      length: Math.min(config.headerSize, page.length),
      hash: hashLargeWindow(page, 0, config.headerSize)
    })
  }

  // Level 2: Metadata chunks (medium windows)
  const metadataEnd = config.headerSize + config.cellPointerSize
  for (let i = config.headerSize; i < metadataEnd && i < page.length; i += 64) {
    chunks.push({
      level: 'metadata',
      offset: i,
      length: Math.min(64, page.length - i),
      hash: hashMediumWindow(page, i, 64)
    })
  }

  // Level 3: Data chunks (small windows, row-aligned)
  for (let i = metadataEnd; i < page.length; i += config.rowAlignmentHint) {
    chunks.push({
      level: 'data',
      offset: i,
      length: Math.min(config.rowAlignmentHint, page.length - i),
      hash: hashSmallWindow(page, i, config.rowAlignmentHint)
    })
  }

  return chunks
}
```

### Content-Defined Chunking for Variable Pages

For pages with variable-length records, use content-defined chunking at row boundaries:

```typescript
/**
 * Detect row boundaries in SQLite pages
 *
 * SQLite cells start with:
 * - Varint: payload size
 * - Varint: rowid (for table leaf pages)
 * - Header: column types
 */
function detectSQLiteCellBoundaries(page: Uint8Array): number[] {
  const boundaries: number[] = []
  const view = new DataView(page.buffer, page.byteOffset, page.byteLength)

  // Read cell count from header
  const cellCount = view.getUint16(3, false)  // Offset 3-4 in page header

  // Read cell pointer array
  const cellPointers: number[] = []
  for (let i = 0; i < cellCount; i++) {
    const ptrOffset = 8 + i * 2  // Cell pointers start at offset 8
    if (ptrOffset + 2 <= page.length) {
      cellPointers.push(view.getUint16(ptrOffset, false))
    }
  }

  // Sort by offset (they're sorted by key, not offset)
  cellPointers.sort((a, b) => a - b)

  return cellPointers
}
```

---

## Shared Dictionary Compression

### Concept

Instead of compressing each page independently, extract common patterns into a shared dictionary:

```
Traditional:                    Dictionary-based:
┌──────────────┐               ┌──────────────┐
│ Page 1       │  compress     │ Dictionary   │
│ [header][data]│  ────────►   │ [patterns]   │
│ 4096B → 2KB  │               └──────────────┘
└──────────────┘                      │
┌──────────────┐                      ▼
│ Page 2       │  compress     ┌──────────────┐
│ [header][data]│  ────────►   │ Page 1 refs  │
│ 4096B → 2KB  │               │ 4096B → 200B │
└──────────────┘               └──────────────┘
                               ┌──────────────┐
                               │ Page 2 refs  │
                               │ 4096B → 250B │
                               └──────────────┘
```

### Dictionary Structure

```typescript
/**
 * Shared dictionary for DB page compression
 *
 * Dictionary entries are sorted by frequency and can be:
 * 1. Header templates (full page headers)
 * 2. Schema patterns (column type sequences)
 * 3. Common value patterns (NULLs, defaults, zeros)
 */
interface DictionaryEntry {
  id: number              // 0-65535 (16-bit reference)
  data: Uint8Array        // Pattern bytes
  frequency: number       // Usage count for LRU
  type: 'header' | 'schema' | 'value' | 'row'
}

interface SharedDictionary {
  version: number
  entryCount: number
  totalSize: number       // Sum of all entry sizes
  entries: DictionaryEntry[]

  // Index for fast pattern lookup
  hashIndex: Map<number, number[]>  // hash -> entry IDs
}

const DICTIONARY_CONFIG = {
  maxEntries: 4096,       // 4K dictionary entries
  maxTotalSize: 1 << 20,  // 1MB total dictionary size
  minPatternSize: 16,     // Minimum pattern length
  maxPatternSize: 4096,   // Maximum pattern length (full page)
  hashWindowSize: 32      // Window for pattern hashing
}

class DictionaryBuilder {
  private entries: Map<string, DictionaryEntry> = new Map()
  private patternCounts: Map<string, number> = new Map()

  /**
   * Learn patterns from a set of database pages
   */
  learnFromPages(pages: Uint8Array[], pageType: string): void {
    const config = DB_CHUNKING_PRESETS[pageType] ?? DB_CHUNKING_PRESETS.sqlite

    for (const page of pages) {
      // Extract header as pattern
      if (config.headerSize > 0) {
        const header = page.slice(0, config.headerSize)
        this.recordPattern(header, 'header')
      }

      // Extract repeating patterns within page
      const patterns = this.findRepeatingPatterns(page, config)
      for (const pattern of patterns) {
        this.recordPattern(pattern.data, pattern.type)
      }
    }
  }

  /**
   * Build optimized dictionary from learned patterns
   */
  build(): SharedDictionary {
    // Sort patterns by (frequency * size) to maximize compression
    const sorted = Array.from(this.entries.values())
      .sort((a, b) => (b.frequency * b.data.length) - (a.frequency * a.data.length))

    // Take top patterns up to size limit
    const selected: DictionaryEntry[] = []
    let totalSize = 0

    for (const entry of sorted) {
      if (selected.length >= DICTIONARY_CONFIG.maxEntries) break
      if (totalSize + entry.data.length > DICTIONARY_CONFIG.maxTotalSize) continue

      entry.id = selected.length
      selected.push(entry)
      totalSize += entry.data.length
    }

    // Build hash index
    const hashIndex = new Map<number, number[]>()
    for (const entry of selected) {
      const hash = this.hashPattern(entry.data)
      const existing = hashIndex.get(hash) ?? []
      existing.push(entry.id)
      hashIndex.set(hash, existing)
    }

    return {
      version: 1,
      entryCount: selected.length,
      totalSize,
      entries: selected,
      hashIndex
    }
  }

  private recordPattern(data: Uint8Array, type: DictionaryEntry['type']): void {
    const key = this.patternKey(data)
    const existing = this.entries.get(key)

    if (existing) {
      existing.frequency++
    } else if (data.length >= DICTIONARY_CONFIG.minPatternSize) {
      this.entries.set(key, {
        id: -1,  // Assigned during build()
        data: new Uint8Array(data),
        frequency: 1,
        type
      })
    }
  }

  private patternKey(data: Uint8Array): string {
    // Use hash + length for key (handles collisions)
    const hash = this.hashPattern(data)
    return `${hash}:${data.length}`
  }

  private hashPattern(data: Uint8Array): number {
    let hash = 0
    for (let i = 0; i < Math.min(data.length, DICTIONARY_CONFIG.hashWindowSize); i++) {
      hash = ((hash << 5) - hash + (data[i] ?? 0)) | 0
    }
    return hash >>> 0
  }

  private findRepeatingPatterns(
    page: Uint8Array,
    config: ChunkingConfig
  ): Array<{ data: Uint8Array; type: DictionaryEntry['type'] }> {
    const patterns: Array<{ data: Uint8Array; type: DictionaryEntry['type'] }> = []

    // Look for repeated byte sequences
    const windowSizes = [128, 64, 32, 16]

    for (const windowSize of windowSizes) {
      const seen = new Map<number, number>()  // hash -> first occurrence offset

      for (let i = 0; i <= page.length - windowSize; i += 8) {
        const hash = this.hashPattern(page.slice(i, i + windowSize))

        if (seen.has(hash)) {
          // Potential match, verify
          const prevOffset = seen.get(hash)!
          if (this.bytesEqual(page, prevOffset, i, windowSize)) {
            patterns.push({
              data: page.slice(i, i + windowSize),
              type: i < config.headerSize + config.cellPointerSize ? 'schema' : 'value'
            })
          }
        } else {
          seen.set(hash, i)
        }
      }
    }

    return patterns
  }

  private bytesEqual(
    data: Uint8Array,
    offset1: number,
    offset2: number,
    length: number
  ): boolean {
    for (let i = 0; i < length; i++) {
      if (data[offset1 + i] !== data[offset2 + i]) return false
    }
    return true
  }
}
```

### Dictionary-Based Encoding

```typescript
/**
 * Encode a page using shared dictionary
 *
 * Output format:
 * [instruction_count: varint]
 * [instructions: (type, data)*]
 *
 * Instruction types:
 * - DICT_REF (0x80 | id_high): Reference dictionary entry
 * - LITERAL (0x00 | length): Literal bytes follow
 * - COPY (0x40 | offset_high): Copy from base page
 */
interface EncodingInstruction {
  type: 'dict_ref' | 'literal' | 'copy'
  dictId?: number      // For dict_ref
  offset?: number      // For copy
  length?: number      // For literal/copy
  data?: Uint8Array    // For literal
}

function encodeWithDictionary(
  page: Uint8Array,
  dictionary: SharedDictionary,
  basePage?: Uint8Array
): Uint8Array {
  const instructions: EncodingInstruction[] = []
  let position = 0

  while (position < page.length) {
    // 1. Try dictionary match (longest match wins)
    const dictMatch = findDictionaryMatch(page, position, dictionary)
    if (dictMatch && dictMatch.length >= DICTIONARY_CONFIG.minPatternSize) {
      instructions.push({
        type: 'dict_ref',
        dictId: dictMatch.entryId
      })
      position += dictMatch.length
      continue
    }

    // 2. Try base page copy (if base provided)
    if (basePage) {
      const copyMatch = findCopyMatch(page, position, basePage)
      if (copyMatch && copyMatch.length >= 8) {
        instructions.push({
          type: 'copy',
          offset: copyMatch.baseOffset,
          length: copyMatch.length
        })
        position += copyMatch.length
        continue
      }
    }

    // 3. Fallback to literal
    // Batch literals until next match
    const literalEnd = findNextMatchPosition(page, position + 1, dictionary, basePage)
    const literalLength = literalEnd - position

    instructions.push({
      type: 'literal',
      length: literalLength,
      data: page.slice(position, literalEnd)
    })
    position = literalEnd
  }

  return serializeInstructions(instructions)
}

function findDictionaryMatch(
  page: Uint8Array,
  offset: number,
  dictionary: SharedDictionary
): { entryId: number; length: number } | null {
  // Hash the current position
  const windowSize = Math.min(DICTIONARY_CONFIG.hashWindowSize, page.length - offset)
  if (windowSize < DICTIONARY_CONFIG.minPatternSize) return null

  let hash = 0
  for (let i = 0; i < windowSize; i++) {
    hash = ((hash << 5) - hash + (page[offset + i] ?? 0)) | 0
  }
  hash >>>= 0

  // Look up candidates in index
  const candidates = dictionary.hashIndex.get(hash)
  if (!candidates) return null

  let bestMatch: { entryId: number; length: number } | null = null

  for (const entryId of candidates) {
    const entry = dictionary.entries[entryId]
    if (!entry) continue

    // Verify match
    const matchLength = verifyMatch(page, offset, entry.data)
    if (matchLength >= DICTIONARY_CONFIG.minPatternSize) {
      if (!bestMatch || matchLength > bestMatch.length) {
        bestMatch = { entryId, length: matchLength }
      }
    }
  }

  return bestMatch
}

function verifyMatch(page: Uint8Array, offset: number, pattern: Uint8Array): number {
  const maxLength = Math.min(pattern.length, page.length - offset)
  for (let i = 0; i < maxLength; i++) {
    if (page[offset + i] !== pattern[i]) return i
  }
  return maxLength
}
```

---

## Delta Encoding Optimizations

### Structural Delta for Database Pages

Instead of byte-level delta, use page-structure-aware delta:

```typescript
/**
 * Structural delta encoding for database pages
 *
 * Leverages knowledge of page structure:
 * 1. Header typically unchanged (skip entirely)
 * 2. Cell pointers may shift (track reorderings)
 * 3. Cell data has row-level changes (diff by cell)
 */
interface StructuralDelta {
  basePageHash: Uint8Array     // SHA-1 of base page
  pageType: string             // 'sqlite' | 'parquet' | 'duckdb'
  headerDelta: HeaderDelta | null
  cellChanges: CellChange[]
  newCells: NewCell[]
  deletedCellIds: number[]
}

interface HeaderDelta {
  changedOffsets: Array<{offset: number, newValue: number}>
}

interface CellChange {
  cellId: number               // Cell index
  oldOffset: number            // Position in base
  newOffset: number            // Position in target
  contentDelta: Uint8Array     // Byte-level delta of content
}

interface NewCell {
  cellId: number
  offset: number
  content: Uint8Array
}

function createStructuralDelta(
  basePage: Uint8Array,
  targetPage: Uint8Array,
  pageType: string
): StructuralDelta {
  const config = DB_CHUNKING_PRESETS[pageType] ?? DB_CHUNKING_PRESETS.sqlite

  // 1. Compare headers
  const headerDelta = compareHeaders(basePage, targetPage, config.headerSize)

  // 2. Parse cell structure
  const baseCells = parseCells(basePage, pageType)
  const targetCells = parseCells(targetPage, pageType)

  // 3. Match cells by content hash (cells may have moved)
  const cellMatches = matchCellsByContent(baseCells, targetCells)

  // 4. Generate changes
  const cellChanges: CellChange[] = []
  const newCells: NewCell[] = []
  const deletedCellIds: number[] = []

  for (const [targetIdx, baseIdx] of cellMatches) {
    if (baseIdx === -1) {
      // New cell
      newCells.push({
        cellId: targetIdx,
        offset: targetCells[targetIdx].offset,
        content: targetCells[targetIdx].content
      })
    } else {
      // Modified or moved cell
      const baseCell = baseCells[baseIdx]
      const targetCell = targetCells[targetIdx]

      if (baseCell.offset !== targetCell.offset ||
          !arraysEqual(baseCell.content, targetCell.content)) {
        cellChanges.push({
          cellId: targetIdx,
          oldOffset: baseCell.offset,
          newOffset: targetCell.offset,
          contentDelta: createByteDelta(baseCell.content, targetCell.content)
        })
      }
    }
  }

  // Find deleted cells
  for (let i = 0; i < baseCells.length; i++) {
    const stillExists = Array.from(cellMatches.values()).includes(i)
    if (!stillExists) {
      deletedCellIds.push(i)
    }
  }

  return {
    basePageHash: sha1(basePage),
    pageType,
    headerDelta,
    cellChanges,
    newCells,
    deletedCellIds
  }
}

function matchCellsByContent(
  baseCells: ParsedCell[],
  targetCells: ParsedCell[]
): Map<number, number> {
  const matches = new Map<number, number>()
  const baseHashes = new Map<string, number>()

  // Hash base cells
  for (let i = 0; i < baseCells.length; i++) {
    const hash = hashCell(baseCells[i])
    baseHashes.set(hash, i)
  }

  // Match target cells
  for (let i = 0; i < targetCells.length; i++) {
    const hash = hashCell(targetCells[i])
    const baseIdx = baseHashes.get(hash) ?? -1
    matches.set(i, baseIdx)

    // Remove matched base cell to handle duplicates
    if (baseIdx !== -1) {
      baseHashes.delete(hash)
    }
  }

  return matches
}
```

### Optimized Copy Instructions

Extend the existing copy instruction format for larger matches:

```typescript
/**
 * Extended copy instruction for DB pages
 *
 * Standard Git copy: max 64KB copy, max 4GB offset
 * Extended copy: up to 16MB copy, dictionary-relative offset
 */

// New instruction types for DB packing
const DB_INSTRUCTION = {
  COPY_HEADER: 0xC0,     // Copy entire header region
  COPY_CELLS: 0xC1,      // Copy cell range
  DICT_HEADER: 0xC2,     // Use dictionary header
  DICT_PATTERN: 0xC3,    // Use dictionary pattern
  STRUCTURAL: 0xC4       // Apply structural delta
}

function emitDbCopy(
  instructions: Uint8Array[],
  type: number,
  offset: number,
  length: number
): void {
  const bytes: number[] = [type]

  // Encode offset (up to 32-bit)
  if (offset > 0) {
    bytes.push(offset & 0xFF)
    bytes.push((offset >> 8) & 0xFF)
    if (offset > 0xFFFF) {
      bytes.push((offset >> 16) & 0xFF)
      bytes.push((offset >> 24) & 0xFF)
    }
  }

  // Encode length (up to 24-bit for 16MB max)
  bytes.push(length & 0xFF)
  bytes.push((length >> 8) & 0xFF)
  bytes.push((length >> 16) & 0xFF)

  instructions.push(new Uint8Array(bytes))
}
```

---

## Implementation Plan

### Phase 1: Page Classifier (Week 1-2)

**Goal:** Detect database page types and extract structural metadata

```typescript
// New file: src/pack/page-classifier.ts

interface PageClassification {
  type: 'sqlite' | 'parquet' | 'duckdb' | 'unknown'
  confidence: number  // 0-1
  pageSize: number
  headerSize: number
  cellCount?: number
  freeSpace?: number
}

function classifyPage(data: Uint8Array): PageClassification {
  // Check SQLite
  if (isSQLitePage(data)) {
    return classifySQLitePage(data)
  }

  // Check Parquet
  if (isParquetPage(data)) {
    return classifyParquetPage(data)
  }

  // Check DuckDB
  if (isDuckDBPage(data)) {
    return classifyDuckDBPage(data)
  }

  return { type: 'unknown', confidence: 0, pageSize: data.length, headerSize: 0 }
}

function isSQLitePage(data: Uint8Array): boolean {
  // SQLite pages have specific header patterns
  if (data.length < 100) return false

  // First byte is page type: 0x02 (index interior), 0x05 (table interior),
  // 0x0a (index leaf), 0x0d (table leaf)
  const pageType = data[0]
  return [0x02, 0x05, 0x0a, 0x0d].includes(pageType)
}
```

**Deliverables:**
- `page-classifier.ts` with detection for SQLite, Parquet, DuckDB
- Unit tests with sample pages from each database type
- Benchmark: <1ms classification per page

### Phase 2: Dictionary Builder (Week 3-4)

**Goal:** Build and serialize shared dictionaries

```typescript
// New file: src/pack/dictionary.ts

// Binary format for serialized dictionary
const DICT_MAGIC = 'DBDC'  // DB Dictionary Compressed
const DICT_VERSION = 1

interface SerializedDictionary {
  // Header (32 bytes)
  magic: string           // 4 bytes
  version: number         // 4 bytes
  entryCount: number      // 4 bytes
  totalDataSize: number   // 4 bytes
  hashTableOffset: number // 8 bytes
  reserved: Uint8Array    // 8 bytes

  // Entry table (variable)
  entries: Array<{
    offset: number        // 4 bytes (into data section)
    length: number        // 2 bytes
    type: number          // 1 byte
    flags: number         // 1 byte
  }>

  // Hash table (for fast lookup)
  hashBuckets: Uint32Array  // hash -> entry index

  // Data section
  data: Uint8Array
}

function serializeDictionary(dict: SharedDictionary): Uint8Array
function deserializeDictionary(data: Uint8Array): SharedDictionary
```

**Deliverables:**
- `dictionary.ts` with build/serialize/deserialize
- Learning algorithm that extracts patterns from page sets
- Dictionary compaction (remove unused entries)
- Target: <10ms to build dictionary from 1000 pages

### Phase 3: Page-Aware Delta (Week 5-6)

**Goal:** Implement structural delta encoding

```typescript
// New file: src/pack/delta-db.ts

function createDbDelta(
  base: Uint8Array,
  target: Uint8Array,
  dict: SharedDictionary | null,
  options: DbDeltaOptions
): Uint8Array

function applyDbDelta(
  base: Uint8Array,
  delta: Uint8Array,
  dict: SharedDictionary | null
): Uint8Array
```

**Deliverables:**
- `delta-db.ts` with structural delta encoding
- Support for SQLite, Parquet, DuckDB page formats
- Fallback to standard delta for unknown formats
- Target: 5-10x better compression than standard delta

### Phase 4: Pack Generation Integration (Week 7-8)

**Goal:** Integrate with existing pack generation

```typescript
// New file: src/pack/generation-db.ts

interface DbPackOptions extends GeneratorOptions {
  // Enable DB-optimized compression
  enableDbOptimization: boolean

  // Page type hint (auto-detect if not specified)
  pageTypeHint?: 'sqlite' | 'parquet' | 'duckdb'

  // Dictionary options
  buildDictionary: boolean
  dictionarySize: number

  // Use structural delta
  useStructuralDelta: boolean
}

class DbPackfileGenerator extends PackfileGenerator {
  private dictionary: SharedDictionary | null = null
  private pageClassifier: PageClassifier

  constructor(options: DbPackOptions)

  // Override to use DB-optimized encoding
  protected encodeObject(obj: PackableObject): Uint8Array
}
```

**Deliverables:**
- `generation-db.ts` extending existing generator
- Automatic page type detection
- Dictionary section in pack format
- Backward-compatible pack output

---

## Compression Ratio Estimates

### Methodology

Estimates based on:
1. Analysis of SQLite, Parquet, DuckDB page structures
2. Typical workload characteristics
3. Similar systems (e.g., MySQL page compression, ZFS dedup)

### SQLite Pages (OLTP Workload)

| Component | Size | Redundancy | Compressed |
|-----------|------|------------|------------|
| Page header | 8-12B | 95% | 0.5B |
| Cell pointers | 200B avg | 70% | 60B |
| Free space | 500B avg | 100% | 0B (skip) |
| Cell content | 3.3KB | 40% | 2KB |
| **Total** | **4096B** | | **~2.1KB (2x)** |

With shared dictionary:

| Component | Standard | With Dict | Improvement |
|-----------|----------|-----------|-------------|
| Page header | 0.5B | 1 byte ref | 50% |
| Schema patterns | 500B | 20 byte refs | 96% |
| Row data | 1.5KB | 800B | 47% |
| **Total** | **~2KB** | **~800B (5x)** | **60%** |

With structural delta (page versions):

| Delta Type | Size | Notes |
|------------|------|-------|
| Single row update | 50-100B | Just changed cell |
| Multi-row update | 200-400B | Multiple cells |
| Page split | 2KB | Half page new |
| Full rewrite | 2KB | Same as snapshot |

**Combined (typical OLTP):** 15-25x compression

### Parquet Row Groups

| Component | Size | Redundancy | Compressed |
|-----------|------|------------|------------|
| Page headers | 256B | 100% | 1B ref |
| Rep/Def levels | 10KB avg | 80% | 2KB |
| Dictionary page | 50KB avg | 90% (shared) | 5KB |
| Data page | 940KB avg | 30% | 658KB |
| **Total** | **1MB** | | **~665KB (1.5x)** |

With shared dictionary + delta:

| Scenario | Compression |
|----------|-------------|
| Same schema, different data | 10-20x |
| Schema evolution (add column) | 5-10x |
| Complete schema change | 1.5-2x |

**Combined (analytics):** 20-40x for versioned tables

### DuckDB Blocks

| Component | Size | Redundancy | Compressed |
|-----------|------|------------|------------|
| Block header | 128B | 98% | 2B |
| Validity mask | 8KB avg | 70% | 2.4KB |
| Column data | 248KB avg | 40% | 149KB |
| **Total** | **256KB** | | **~152KB (1.7x)** |

With column-aware compression:

| Column Type | Standard | Optimized | Improvement |
|-------------|----------|-----------|-------------|
| Integer | 1.2x | 4-8x | Dictionary + RLE |
| String | 1.5x | 8-20x | Shared dictionary |
| Timestamp | 1.3x | 10-30x | Delta encoding |
| NULL-heavy | 1.1x | 50-100x | Sparse encoding |

**Combined (OLAP):** 18-30x compression

### Summary Table

| Workload | Current | Phase 1 (Chunking) | Phase 2 (Dictionary) | Phase 3 (Delta) | Final |
|----------|---------|-------------------|---------------------|-----------------|-------|
| SQLite OLTP | 2-3x | 3-4x | 6-8x | 15-25x | **20x** |
| Parquet Analytics | 3-5x | 4-6x | 10-15x | 20-40x | **30x** |
| DuckDB OLAP | 2-4x | 3-5x | 8-12x | 18-30x | **25x** |
| Mixed | 2.5x | 3.5x | 8x | 17x | **10x target** |

---

## Benchmarking Strategy

### Test Data Sets

```typescript
interface BenchmarkDataset {
  name: string
  description: string
  pageCount: number
  totalSize: number
  pageType: 'sqlite' | 'parquet' | 'duckdb'
  workloadType: 'oltp' | 'olap' | 'mixed'
}

const BENCHMARK_DATASETS: BenchmarkDataset[] = [
  {
    name: 'sqlite-tpcc',
    description: 'TPC-C benchmark on SQLite',
    pageCount: 10000,
    totalSize: 40 * 1024 * 1024,  // 40MB
    pageType: 'sqlite',
    workloadType: 'oltp'
  },
  {
    name: 'parquet-nyc-taxi',
    description: 'NYC Taxi dataset in Parquet',
    pageCount: 1000,
    totalSize: 1024 * 1024 * 1024,  // 1GB
    pageType: 'parquet',
    workloadType: 'olap'
  },
  {
    name: 'duckdb-lineitem',
    description: 'TPC-H lineitem table in DuckDB',
    pageCount: 5000,
    totalSize: 500 * 1024 * 1024,  // 500MB
    pageType: 'duckdb',
    workloadType: 'olap'
  },
  {
    name: 'mixed-production',
    description: 'Real production database snapshot',
    pageCount: 50000,
    totalSize: 2 * 1024 * 1024 * 1024,  // 2GB
    pageType: 'sqlite',
    workloadType: 'mixed'
  }
]
```

### Metrics to Collect

```typescript
interface BenchmarkResult {
  dataset: string

  // Compression metrics
  originalSize: number
  compressedSize: number
  compressionRatio: number

  // Time metrics (milliseconds)
  classificationTimeMs: number
  dictionaryBuildTimeMs: number
  compressionTimeMs: number
  decompressionTimeMs: number

  // Quality metrics
  dictionarySize: number
  dictionaryHitRate: number
  deltaChainDepth: number

  // Comparison
  standardGitRatio: number    // Git's standard delta compression
  zlibOnlyRatio: number       // zlib level 6 only
  improvementVsGit: number    // Our ratio / Git ratio
}
```

### Benchmark Test Cases

1. **Snapshot compression**
   - Compress 1000 random pages
   - Measure compression ratio and time
   - Compare with zlib-only and git-delta

2. **Incremental compression**
   - Start with 1000 base pages
   - Apply 100 transactions (page modifications)
   - Compress each version as delta from previous
   - Measure total storage vs storing all snapshots

3. **Query workload simulation**
   - Compress 10,000 pages
   - Random access 1,000 pages
   - Measure decompression time distribution

4. **Dictionary scaling**
   - Vary dictionary size: 64KB, 256KB, 1MB, 4MB
   - Measure compression ratio vs build time tradeoff

5. **Mixed workload**
   - Alternate between different page types
   - Measure classifier accuracy and overhead

### Expected Results

```
Benchmark: sqlite-tpcc (OLTP)
------------------------------
Original size:        40.0 MB
Standard Git delta:   16.0 MB (2.5x)
DB-optimized:          2.0 MB (20.0x)
Improvement:          8.0x better than Git

Classification:       0.8 ms per page
Dictionary build:     45 ms for 10K pages
Compression:          0.2 ms per page
Decompression:        0.1 ms per page
Dictionary hit rate:  87%
```

---

## Appendix A: Pack Format Extension

### Extended Pack Header

```
Standard Git Pack Header (12 bytes):
  Magic:        "PACK" (4 bytes)
  Version:      2 (4 bytes)
  Object count: N (4 bytes)

DB-Extended Pack Header (32 bytes):
  Magic:        "PACK" (4 bytes)
  Version:      3 (4 bytes)      # Version 3 indicates DB extension
  Object count: N (4 bytes)
  Flags:        F (4 bytes)      # DB_DICT_PRESENT, DB_STRUCTURAL_DELTA, etc.
  Dict offset:  O (8 bytes)      # Offset to dictionary section (0 if none)
  Dict size:    S (4 bytes)      # Dictionary section size
  Reserved:     (4 bytes)
```

### Flags Bitmap

```typescript
const PACK_FLAGS = {
  DB_DICT_PRESENT: 0x0001,       // Pack contains shared dictionary
  DB_STRUCTURAL_DELTA: 0x0002,   // Uses structural delta encoding
  DB_PAGE_CLASSIFIED: 0x0004,    // Pages have type classification
  DB_HIERARCHICAL_CHUNK: 0x0008, // Uses hierarchical chunking
  BACKWARD_COMPATIBLE: 0x8000    // Can be read by standard Git
}
```

### Dictionary Section Format

```
Dictionary Section:
  Magic:        "DBDC" (4 bytes)
  Version:      1 (4 bytes)
  Entry count:  N (4 bytes)
  Data size:    S (4 bytes)
  Hash buckets: H (4 bytes)
  Reserved:     (8 bytes)

  Entry table:  N * 8 bytes
    - Offset:   4 bytes (into data section)
    - Length:   2 bytes
    - Type:     1 byte
    - Flags:    1 byte

  Hash table:   H * 4 bytes
    - Entry index (0xFFFFFFFF = empty)

  Data section: S bytes
    - Concatenated pattern data
```

---

## Appendix B: Compatibility Considerations

### Backward Compatibility

1. **Pack version 3** is new; old clients will reject
2. Can generate **version 2** packs with reduced optimization
3. Dictionary can be stripped for standard Git compatibility

### Forward Compatibility

1. **Reserved fields** in headers for future extensions
2. **Flags bitmap** allows feature detection
3. **Version negotiation** in wire protocol

### Migration Path

```typescript
interface PackCompatibility {
  // Can be read by standard Git
  gitCompatible: boolean

  // Requires DB extension
  requiresDbExtension: boolean

  // Minimum reader version
  minReaderVersion: number
}

function determineCompatibility(options: DbPackOptions): PackCompatibility {
  if (!options.enableDbOptimization) {
    return { gitCompatible: true, requiresDbExtension: false, minReaderVersion: 2 }
  }

  if (options.buildDictionary || options.useStructuralDelta) {
    return { gitCompatible: false, requiresDbExtension: true, minReaderVersion: 3 }
  }

  // Hierarchical chunking only - still produces valid delta
  return { gitCompatible: true, requiresDbExtension: false, minReaderVersion: 2 }
}
```

---

## References

1. Git Pack Format: https://git-scm.com/docs/pack-format
2. SQLite File Format: https://www.sqlite.org/fileformat.html
3. Parquet Format: https://parquet.apache.org/docs/file-format/
4. DuckDB Storage: https://duckdb.org/internals/storage
5. Rabin Fingerprinting: https://en.wikipedia.org/wiki/Rabin_fingerprint
6. Zstandard Dictionary Compression: https://facebook.github.io/zstd/#small-data

---

*Spike pocs-1zjk completed. Design document ready for review.*
