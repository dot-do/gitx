# gitx.do

**Git as a queryable data lake.** Full protocol. R2 Parquet storage. Edge-native.

[![npm version](https://img.shields.io/npm/v/gitx.do.svg)](https://www.npmjs.com/package/gitx.do)
[![Tests](https://img.shields.io/badge/tests-5%2C684%20passing-brightgreen.svg)](https://github.com/dot-do/gitx)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why gitx?

**AI agents need version control.** They generate code, iterate on files, need to track changes and roll back mistakes.

**gitx is Git reimplemented for Cloudflare Workers** with R2 Parquet as the primary storage backend. Every git object is a queryable row. Every repository is a data lake.

**Code as data.** Query your git history with DuckDB, Spark, or any Parquet-compatible tool:

```sql
SELECT sha, author_name, message
FROM read_parquet('r2://gitx-analytics/owner/repo/objects/*.parquet')
WHERE type = 'commit'
ORDER BY author_date DESC
LIMIT 10
```

## Architecture

```
Git Protocol (push/fetch/webhook)
       |
  GitX DO (thin coordinator)
  |- ref locking (SQLite: name->sha only)
  |- bloom filter cache (SHA existence)
  |- git protocol negotiation
       |
  hyparquet-writer -> R2 Parquet (VARIANT encoded)
  |- objects/*.parquet  (append-only)
  |- refs.parquet       (rewritten on ref update)
       |
  Queryable by anything (DuckDB, hyparquet, Iceberg)
```

### Parquet Schema

Every git object stored with VARIANT encoding:

| Column   | Type       | Description                           |
|----------|------------|---------------------------------------|
| sha      | BYTE_ARRAY | SHA-1 hash (bloom filter enabled)     |
| type     | BYTE_ARRAY | commit, tree, blob, tag               |
| size     | INT64      | Object size in bytes                  |
| path     | BYTE_ARRAY | File path (nullable)                  |
| storage  | BYTE_ARRAY | inline, r2, or lfs                    |
| data     | VARIANT    | Object content or R2 reference        |

### Three Storage Modes

| Mode     | When                  | Where                               |
|----------|-----------------------|-------------------------------------|
| `inline` | < 1MB (code, docs)    | VARIANT in Parquet                  |
| `r2`     | > 1MB, non-LFS       | Raw R2 object + VARIANT reference   |
| `lfs`    | Git LFS pointer       | Raw R2 object + LFS metadata        |

## Quick Start

```typescript
import git from 'gitx.do'

// Initialize a repo
await git.init('/my-project')

// Stage and commit
await git.add('/my-project', '.')
await git.commit('/my-project', 'Initial commit')

// Branch and merge
await git.branch('/my-project', 'feature')
await git.checkout('/my-project', 'feature')
await git.merge('/my-project', 'feature')
```

## Installation

```bash
npm install gitx.do
```

## Features

### Full Git Protocol

Complete implementation of Git internals - pack files, delta compression, smart HTTP:

```typescript
await git.hashObject('/repo', content, 'blob')
await git.pack('/repo', objects)
await git.updateRef('/repo', 'refs/heads/main', sha)
```

### R2 Parquet Storage

All git objects stored as queryable Parquet files on R2:

- **Append-only** writes for durability
- **VARIANT** encoding for semi-structured git data
- **Bloom filters** for fast SHA existence checks
- **Three storage modes** (inline/r2/lfs) for optimal cost

### Wire Protocol

Smart HTTP protocol for standard git clients:

```bash
git clone https://gitx.do/owner/repo.git
git push origin main
```

### Export & Analytics

Built-in Parquet export with VARIANT and compression:

```bash
curl -X POST https://gitx.do/export \
  -d '{"tables": ["commits", "refs"], "codec": "SNAPPY"}'
```

### Merge & Diff

Full three-way merge with conflict detection:

```typescript
const result = await git.merge('/repo', 'feature')
const diff = await git.diff('/repo', 'main', 'feature')
```

## Durable Object Integration

### As a Standalone DO

```typescript
import { GitDO } from 'gitx.do/do'
export { GitDO }

export default {
  async fetch(request, env) {
    const id = env.GIT.idFromName('repo-123')
    return env.GIT.get(id).fetch(request)
  }
}
```

### With dotdo Framework

```typescript
import { DO } from 'dotdo'
import { withGit } from 'gitx.do/do'

class MyAgent extends withGit(DO) {
  async work() {
    await this.$.git.add('.', 'src/')
    await this.$.git.commit('.', 'Update source files')
    return this.$.git.log('.')
  }
}
```

## Data Lake Integration

### DuckDB

```sql
-- Query commits directly from R2
SELECT sha, author_name, message, author_date
FROM read_parquet('r2://gitx-analytics/owner/repo/objects/*.parquet')
WHERE type = 'commit'
ORDER BY author_date DESC;

-- Count files by language
SELECT path, COUNT(*) as files
FROM read_parquet('r2://gitx-analytics/owner/repo/objects/*.parquet')
WHERE type = 'blob' AND path IS NOT NULL
GROUP BY path;
```

### Iceberg (planned)

Iceberg v2 metadata generation enables Spark, Trino, and other catalog-aware tools.

### Delta Lake (planned)

Branch/merge maps to Delta log fork/merge:
- `refs/heads/main` -> Delta log version N
- `refs/heads/feature` -> forked Delta log
- `git merge` -> three-way merge on Delta logs

## API Reference

### Repository Operations

| Method | Description |
|--------|-------------|
| `init(path)` | Initialize new repository |
| `clone(url, path)` | Clone remote repository |
| `status(path)` | Get working tree status |
| `log(path, options?)` | View commit history |

### Staging & Commits

| Method | Description |
|--------|-------------|
| `add(path, files)` | Stage files |
| `commit(path, message)` | Create commit |
| `reset(path, ref)` | Reset to commit |

### Branches & Merging

| Method | Description |
|--------|-------------|
| `branch(path, name)` | Create branch |
| `checkout(path, ref)` | Switch branches |
| `merge(path, branch)` | Merge branch |

### Low-Level

| Method | Description |
|--------|-------------|
| `hashObject(path, data, type)` | Create object |
| `catFile(path, sha, type)` | Read object |
| `updateRef(path, ref, sha)` | Update reference |

## Performance

- **5,684 tests** covering all operations
- **Full Git protocol** - clone, fetch, push
- **<10ms** for bloom filter lookups
- **Global edge** - 300+ Cloudflare locations
- **Zero cold starts** - Durable Objects

## License

MIT

## Links

- [GitHub](https://github.com/dot-do/gitx)
- [Documentation](https://gitx.do)
- [.do Platform](https://do.org.ai)
