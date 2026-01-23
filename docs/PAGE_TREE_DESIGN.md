# GitX Page-Level Tree Format Design

## Overview

This document describes a Git tree format optimized for database page storage. The design enables efficient versioning of database pages using Git's content-addressable storage model, with support for sparse trees that only store changed pages.

---

## Problem Statement

Traditional Git trees represent file system directories. When versioning database pages, we need:

1. **Sparse representation** - Only store changed pages, not entire database state
2. **Efficient diffing** - Quickly identify which pages changed between versions
3. **Page numbering scheme** - Map database pages to Git objects
4. **Compatibility** - Work with standard Git tree format and tooling

### Use Cases

- **Database snapshots** - Version entire database state at a point in time
- **Incremental backups** - Store only changed pages since last backup
- **Time travel queries** - Access historical database state efficiently
- **Branch/merge** - Support database branching workflows
- **Change tracking** - Audit trail of page-level modifications

---

## Design Goals

| Goal | Description |
|------|-------------|
| **Sparse trees** | Store only changed pages; unchanged pages inherit from parent |
| **Content-addressed** | Pages identified by SHA-1/SHA-256 hash of content |
| **Standard format** | Compatible with Git tree wire format |
| **Efficient diff** | O(n) where n = changed pages, not total pages |
| **Range queries** | Support efficient queries like "pages 1000-2000" |
| **Large databases** | Scale to millions of pages |

---

## Directory Structure

### Canonical Page Path Format

```
/db/{table}/{page-NNNNNNNN}
```

Where:
- `db/` - Root directory for database objects
- `{table}` - Table or segment identifier (alphanumeric, max 64 chars)
- `page-NNNNNNNN` - Zero-padded 8-digit page number (supports up to 99,999,999 pages per table)

### Examples

```
/db/users/page-00000001        # Users table, page 1
/db/users/page-00000002        # Users table, page 2
/db/orders/page-00001234       # Orders table, page 1234
/db/_metadata/page-00000000    # System metadata page
/db/_wal/page-00000001         # Write-ahead log page 1
```

### Extended Format for Large Tables

For tables exceeding 100 million pages, use partitioned directories:

```
/db/{table}/p{NNNN}/{page-NNNNNNNN}
```

Where `p{NNNN}` is the partition (page_num / 10000):

```
/db/events/p0000/page-00000001    # Pages 0-9999
/db/events/p0001/page-00010000    # Pages 10000-19999
/db/events/p1000/page-10000000    # Pages 10000000-10009999
```

---

## Tree Format Specification

### Standard Git Tree Entry Format

Each tree entry follows the Git format:

```
{mode} {name}\0{20-byte-sha}
```

For page trees, we use:
- **Mode**: `100644` for regular page data
- **Name**: Page identifier (e.g., `page-00000001`)
- **SHA**: Content hash of the page blob

### Page Tree Structure

A commit points to a root tree, which contains table subtrees:

```
commit -> tree (root)
            |
            +-- db/ (tree, mode 040000)
                  |
                  +-- users/ (tree, mode 040000)
                  |     |
                  |     +-- page-00000001 (blob, mode 100644) -> {page content}
                  |     +-- page-00000002 (blob, mode 100644) -> {page content}
                  |     +-- page-00000003 (blob, mode 100644) -> {page content}
                  |
                  +-- orders/ (tree, mode 040000)
                  |     |
                  |     +-- page-00000001 (blob, mode 100644) -> {page content}
                  |
                  +-- _metadata/ (tree, mode 040000)
                        |
                        +-- page-00000000 (blob, mode 100644) -> {schema info}
```

### Metadata Tree

Special `_metadata` table stores database schema and configuration:

```
/db/_metadata/page-00000000    # Database header/schema
/db/_metadata/page-00000001    # Table definitions
/db/_metadata/page-00000002    # Index definitions
```

---

## Sparse Tree Representation

### Design Principle

A sparse tree only contains entries for pages that differ from the parent commit. To reconstruct full state, traverse the commit history.

### Sparse Tree Markers

Two approaches for representing sparse trees:

#### Approach A: Implicit Sparsity (Recommended)

Missing entries are implicitly inherited from parent. Tree only contains:
1. Modified pages (new SHA)
2. Deleted pages (special marker)
3. New pages (new entry)

**Deletion marker**: Mode `160000` (gitlink/submodule mode) with zero SHA indicates deletion:

```
160000 page-00000005\0{0000000000000000000000000000000000000000}
```

#### Approach B: Explicit Sparsity

Use a manifest file listing which pages are sparse:

```
/db/{table}/.sparse           # List of page ranges not in this tree
```

The `.sparse` file format:
```
# Inherited page ranges (not stored in this tree)
0-999
5000-9999
```

### Example: Sparse Tree After Single Page Change

Parent commit tree (full):
```
db/users/
  page-00000001 -> abc123...
  page-00000002 -> def456...
  page-00000003 -> ghi789...
```

Child commit tree (sparse, only page 2 changed):
```
db/users/
  page-00000002 -> xyz999...  # Only the changed page
```

To read page-00000001 from child:
1. Check child tree - not present
2. Check parent tree - found: abc123...
3. Return page content

---

## Page Blob Format

### Standard Page Blob

Page content stored as Git blob:

```
blob {size}\0{raw page bytes}
```

### Compressed Page Blob

For better storage efficiency, pages may be compressed:

```
blob {size}\0{compression-header}{compressed page bytes}
```

Compression header (4 bytes):
```
Byte 0:    Compression type (0x00=none, 0x01=zstd, 0x02=lz4)
Bytes 1-3: Uncompressed size (24-bit, up to 16MB pages)
```

### Page Header Extension (Optional)

For additional metadata, pages may include a header:

```
+----------------+-------------------+
| Magic (4B)     | "PAGE"            |
+----------------+-------------------+
| Version (2B)   | Format version    |
+----------------+-------------------+
| Flags (2B)     | Compression, etc. |
+----------------+-------------------+
| Table ID (8B)  | Table identifier  |
+----------------+-------------------+
| Page Num (8B)  | Page number       |
+----------------+-------------------+
| Checksum (4B)  | CRC32 of content  |
+----------------+-------------------+
| Reserved (4B)  | Future use        |
+----------------+-------------------+
| Page Data      | Actual content    |
+----------------+-------------------+
```

---

## Tree Diffing Algorithm

### Basic Diff Algorithm

Compare two trees to find changed pages:

```typescript
interface PageChange {
  table: string
  pageNum: number
  type: 'added' | 'modified' | 'deleted'
  oldSha: string | null
  newSha: string | null
}

async function diffPageTrees(
  store: ObjectStore,
  oldTreeSha: string | null,
  newTreeSha: string | null
): Promise<PageChange[]> {
  const changes: PageChange[] = []

  // Get table directories from both trees
  const oldTables = oldTreeSha ? await getTableEntries(store, oldTreeSha) : new Map()
  const newTables = newTreeSha ? await getTableEntries(store, newTreeSha) : new Map()

  // Find all table names
  const allTables = new Set([...oldTables.keys(), ...newTables.keys()])

  for (const table of allTables) {
    const oldTableSha = oldTables.get(table)
    const newTableSha = newTables.get(table)

    if (oldTableSha === newTableSha) {
      // Table unchanged, skip
      continue
    }

    // Diff pages within this table
    const tableChanges = await diffTablePages(store, table, oldTableSha, newTableSha)
    changes.push(...tableChanges)
  }

  return changes
}

async function diffTablePages(
  store: ObjectStore,
  table: string,
  oldTreeSha: string | null,
  newTreeSha: string | null
): Promise<PageChange[]> {
  const changes: PageChange[] = []

  const oldPages = oldTreeSha ? await getPageEntries(store, oldTreeSha) : new Map()
  const newPages = newTreeSha ? await getPageEntries(store, newTreeSha) : new Map()

  // Check for deleted and modified pages
  for (const [pageNum, oldSha] of oldPages) {
    const newSha = newPages.get(pageNum)
    if (newSha === undefined) {
      changes.push({ table, pageNum, type: 'deleted', oldSha, newSha: null })
    } else if (newSha !== oldSha) {
      changes.push({ table, pageNum, type: 'modified', oldSha, newSha })
    }
  }

  // Check for added pages
  for (const [pageNum, newSha] of newPages) {
    if (!oldPages.has(pageNum)) {
      changes.push({ table, pageNum, type: 'added', oldSha: null, newSha })
    }
  }

  return changes
}
```

### Optimized Sparse Diff

For sparse trees, we can optimize by only examining entries present in either tree:

```typescript
async function diffSparsePageTrees(
  store: ObjectStore,
  baseTreeSha: string,
  sparseTreeSha: string
): Promise<PageChange[]> {
  const changes: PageChange[] = []

  // Only iterate over entries in the sparse tree
  const sparseEntries = await walkSparseTree(store, sparseTreeSha)

  for (const entry of sparseEntries) {
    if (isDeleteMarker(entry)) {
      changes.push({
        table: entry.table,
        pageNum: entry.pageNum,
        type: 'deleted',
        oldSha: await lookupPage(store, baseTreeSha, entry.table, entry.pageNum),
        newSha: null
      })
    } else {
      const oldSha = await lookupPage(store, baseTreeSha, entry.table, entry.pageNum)
      if (oldSha === null) {
        changes.push({
          table: entry.table,
          pageNum: entry.pageNum,
          type: 'added',
          oldSha: null,
          newSha: entry.sha
        })
      } else {
        changes.push({
          table: entry.table,
          pageNum: entry.pageNum,
          type: 'modified',
          oldSha,
          newSha: entry.sha
        })
      }
    }
  }

  return changes
}
```

### Range-Based Diff

For diffing specific page ranges:

```typescript
interface PageRange {
  table: string
  startPage: number
  endPage: number
}

async function diffPageRange(
  store: ObjectStore,
  oldTreeSha: string,
  newTreeSha: string,
  range: PageRange
): Promise<PageChange[]> {
  const changes: PageChange[] = []

  for (let pageNum = range.startPage; pageNum <= range.endPage; pageNum++) {
    const pageName = `page-${pageNum.toString().padStart(8, '0')}`

    const oldSha = await lookupPageByPath(store, oldTreeSha, `db/${range.table}/${pageName}`)
    const newSha = await lookupPageByPath(store, newTreeSha, `db/${range.table}/${pageName}`)

    if (oldSha !== newSha) {
      changes.push({
        table: range.table,
        pageNum,
        type: oldSha === null ? 'added' : newSha === null ? 'deleted' : 'modified',
        oldSha,
        newSha
      })
    }
  }

  return changes
}
```

---

## Building Page Trees

### Single-Table Tree Builder

```typescript
interface PageEntry {
  pageNum: number
  sha: string  // SHA of page blob
}

async function buildTableTree(
  store: ObjectStore,
  table: string,
  pages: PageEntry[]
): Promise<string> {
  // Sort by page number for consistent ordering
  const sorted = [...pages].sort((a, b) => a.pageNum - b.pageNum)

  const entries: TreeEntry[] = sorted.map(page => ({
    mode: '100644',
    name: `page-${page.pageNum.toString().padStart(8, '0')}`,
    sha: page.sha
  }))

  return store.storeTree(entries)
}
```

### Sparse Tree Builder

```typescript
interface SparsePageChange {
  table: string
  pageNum: number
  sha: string | null  // null = delete
}

async function buildSparseTree(
  store: ObjectStore,
  baseTreeSha: string,
  changes: SparsePageChange[]
): Promise<string> {
  // Group changes by table
  const byTable = new Map<string, SparsePageChange[]>()
  for (const change of changes) {
    const list = byTable.get(change.table) || []
    list.push(change)
    byTable.set(change.table, list)
  }

  // Get existing db tree
  const dbTree = await getDbTree(store, baseTreeSha)
  const newDbEntries: TreeEntry[] = []

  for (const [table, tableChanges] of byTable) {
    const entries: TreeEntry[] = []

    for (const change of tableChanges) {
      if (change.sha === null) {
        // Deletion marker
        entries.push({
          mode: '160000',  // Gitlink mode for deletion marker
          name: `page-${change.pageNum.toString().padStart(8, '0')}`,
          sha: '0000000000000000000000000000000000000000'
        })
      } else {
        entries.push({
          mode: '100644',
          name: `page-${change.pageNum.toString().padStart(8, '0')}`,
          sha: change.sha
        })
      }
    }

    // Create sparse table tree
    const tableTreeSha = await store.storeTree(entries)
    newDbEntries.push({
      mode: '040000',
      name: table,
      sha: tableTreeSha
    })
  }

  // Create new db tree
  const newDbTreeSha = await store.storeTree(newDbEntries)

  // Create root tree with db directory
  return store.storeTree([{
    mode: '040000',
    name: 'db',
    sha: newDbTreeSha
  }])
}
```

---

## Reading Pages from Sparse Trees

### Materialize Algorithm

To read a page, traverse commit history until found:

```typescript
async function readPage(
  store: ObjectStore,
  commitSha: string,
  table: string,
  pageNum: number
): Promise<Uint8Array | null> {
  const pagePath = `db/${table}/page-${pageNum.toString().padStart(8, '0')}`

  let currentCommit = commitSha
  const visited = new Set<string>()

  while (currentCommit && !visited.has(currentCommit)) {
    visited.add(currentCommit)

    const commit = await store.getCommit(currentCommit)
    const entry = await lookupTreePath(store, commit.tree, pagePath)

    if (entry) {
      // Check for deletion marker
      if (entry.mode === '160000' && isZeroSha(entry.sha)) {
        return null  // Page was deleted
      }

      // Found the page
      return store.getBlob(entry.sha)
    }

    // Not in this tree, check parent
    currentCommit = commit.parents[0] || null
  }

  // Page never existed
  return null
}
```

### Caching Strategy

For efficient access, cache materialized tree state:

```typescript
class MaterializedPageCache {
  private cache: LRUCache<string, Map<string, string>>  // commitSha -> {pagePath -> blobSha}
  private store: ObjectStore

  async getPage(commitSha: string, table: string, pageNum: number): Promise<Uint8Array | null> {
    const cacheKey = `${table}/page-${pageNum.toString().padStart(8, '0')}`

    // Check cache
    let materialized = this.cache.get(commitSha)
    if (!materialized) {
      materialized = await this.materializeCommit(commitSha)
      this.cache.set(commitSha, materialized)
    }

    const blobSha = materialized.get(cacheKey)
    if (!blobSha) return null

    return this.store.getBlob(blobSha)
  }

  private async materializeCommit(commitSha: string): Promise<Map<string, string>> {
    const result = new Map<string, string>()

    // Start with parent's materialized state (if any)
    const commit = await this.store.getCommit(commitSha)
    if (commit.parents.length > 0) {
      const parentMaterialized = await this.materializeCommit(commit.parents[0])
      for (const [path, sha] of parentMaterialized) {
        result.set(path, sha)
      }
    }

    // Apply this commit's changes
    const changes = await walkTree(this.store, commit.tree)
    for (const entry of changes) {
      if (entry.mode === '160000' && isZeroSha(entry.sha)) {
        result.delete(entry.path)  // Deletion
      } else {
        result.set(entry.path, entry.sha)
      }
    }

    return result
  }
}
```

---

## Performance Considerations

### Tree Size Limits

| Scenario | Pages | Tree Entries | Tree Size |
|----------|-------|--------------|-----------|
| Small DB | 1,000 | 1,000 | ~50 KB |
| Medium DB | 100,000 | 100,000 | ~5 MB |
| Large DB | 10,000,000 | 10,000,000 | ~500 MB |

For large databases, use partitioned directories to keep individual trees manageable:

- Target: < 10,000 entries per tree
- Partition scheme: `p{NNNN}` subdirectories (10,000 pages each)

### Sparse Tree Efficiency

| Operation | Full Tree | Sparse Tree |
|-----------|-----------|-------------|
| Commit storage | O(total pages) | O(changed pages) |
| Diff | O(total pages) | O(changed pages) |
| Single page read | O(1) | O(commit depth) |
| Range query | O(range size) | O(range size * depth) |

### Indexing Recommendations

1. **Page index in SQLite**: Map `(commitSha, table, pageNum) -> blobSha` for O(1) lookups
2. **Table manifest**: Store page count and range per commit
3. **Change log**: Track which pages changed in each commit

---

## Examples

### Example 1: Initial Database Commit

Create initial commit with 3 pages in users table:

```typescript
// Store page blobs
const page1Sha = await store.storeBlob(page1Data)
const page2Sha = await store.storeBlob(page2Data)
const page3Sha = await store.storeBlob(page3Data)

// Build users table tree
const usersTreeSha = await store.storeTree([
  { mode: '100644', name: 'page-00000001', sha: page1Sha },
  { mode: '100644', name: 'page-00000002', sha: page2Sha },
  { mode: '100644', name: 'page-00000003', sha: page3Sha }
])

// Build db tree
const dbTreeSha = await store.storeTree([
  { mode: '040000', name: 'users', sha: usersTreeSha }
])

// Build root tree
const rootTreeSha = await store.storeTree([
  { mode: '040000', name: 'db', sha: dbTreeSha }
])

// Create commit
const commitSha = await store.storeCommit({
  tree: rootTreeSha,
  parents: [],
  message: 'Initial database state'
})
```

### Example 2: Update Single Page (Sparse)

Update page 2 in users table:

```typescript
// Store new page blob
const newPage2Sha = await store.storeBlob(newPage2Data)

// Build sparse users tree (only changed page)
const sparseUsersTreeSha = await store.storeTree([
  { mode: '100644', name: 'page-00000002', sha: newPage2Sha }
])

// Build sparse db tree
const sparseDbTreeSha = await store.storeTree([
  { mode: '040000', name: 'users', sha: sparseUsersTreeSha }
])

// Build sparse root tree
const sparseRootTreeSha = await store.storeTree([
  { mode: '040000', name: 'db', sha: sparseDbTreeSha }
])

// Create commit with parent
const commitSha = await store.storeCommit({
  tree: sparseRootTreeSha,
  parents: [parentCommitSha],
  message: 'Update users page 2'
})
```

### Example 3: Delete Page

Delete page 3 from users table:

```typescript
// Build sparse users tree with deletion marker
const sparseUsersTreeSha = await store.storeTree([
  {
    mode: '160000',  // Deletion marker mode
    name: 'page-00000003',
    sha: '0000000000000000000000000000000000000000'
  }
])

// Build tree hierarchy and commit...
```

### Example 4: Diff Two Commits

```typescript
const changes = await diffPageTrees(store, oldCommitTree, newCommitTree)

for (const change of changes) {
  console.log(`${change.type}: ${change.table}/page-${change.pageNum}`)
  if (change.type === 'modified') {
    console.log(`  ${change.oldSha} -> ${change.newSha}`)
  }
}

// Output:
// modified: users/page-2
//   abc123... -> xyz789...
// deleted: users/page-3
//   def456... -> null
// added: orders/page-1
//   null -> ghi999...
```

---

## Compatibility Notes

### Git Compatibility

The page tree format is fully compatible with standard Git:

1. Trees use standard `{mode} {name}\0{sha}` format
2. Blobs are standard Git blobs
3. Commits reference tree SHAs normally
4. Can be pushed/fetched using Git protocol

### Limitations

1. **File names**: Page names must not contain `/` or `\0`
2. **Mode values**: Using `160000` for deletion markers means we can't have actual submodules
3. **SHA format**: Supports both SHA-1 (40 chars) and SHA-256 (64 chars)

### Migration from Full Trees

To convert from full trees to sparse trees:

```typescript
async function convertToSparse(
  store: ObjectStore,
  commitSha: string
): Promise<string> {
  const commit = await store.getCommit(commitSha)

  if (commit.parents.length === 0) {
    // Root commit stays full
    return commitSha
  }

  // Compute diff from parent
  const parentCommit = await store.getCommit(commit.parents[0])
  const changes = await diffPageTrees(store, parentCommit.tree, commit.tree)

  // Build sparse tree from changes
  const sparseTreeSha = await buildSparseTree(store, parentCommit.tree, changes)

  // Create new commit with sparse tree
  return store.storeCommit({
    tree: sparseTreeSha,
    parents: commit.parents,
    author: commit.author,
    committer: commit.committer,
    message: commit.message
  })
}
```

---

## Future Enhancements

### Potential Extensions

1. **Page compression dictionary**: Shared compression context across pages
2. **Delta pages**: Store page diffs instead of full pages
3. **Bloom filter index**: Fast "page exists?" queries
4. **Merkle tree optimization**: Skip subtrees with unchanged hash
5. **Lazy materialization**: Materialize only accessed pages
6. **Page groups**: Bundle related pages in single blob

### Alternative Approaches Considered

1. **Single blob per table**: Too large for incremental updates
2. **Page as file name**: No structured naming, hard to query ranges
3. **Binary tree format**: Not compatible with Git tooling
4. **Footer-based index**: Doesn't support append-only updates

---

## References

- [Git Tree Objects](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects#_tree_objects)
- [Git Pack Format](https://git-scm.com/docs/pack-format)
- [GitX R2 Bundle Storage](./R2-BUNDLE-STORAGE.md)
- [SQLite Database File Format](https://www.sqlite.org/fileformat.html)
