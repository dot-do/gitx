# GitX - CLAUDE.md

## Project Context

GitX is a complete Git protocol implementation for Cloudflare Workers, designed as code-as-data infrastructure for the .do platform.

## Architecture

### Storage: R2 Parquet + VARIANT (Primary)

```
Git Protocol (push/fetch/webhook)
       |
  GitX DO (thin coordinator)
  |- ref locking (SQLite: name->sha only)
  |- bloom filter cache (SQLite: sha existence)
  |- git protocol negotiation
       |
  hyparquet-writer -> R2 Parquet (VARIANT encoded)
  |- objects/*.parquet  (append-only)
  |- refs.parquet       (rewritten on ref update)
       |
  Queryable by anything (DuckDB, hyparquet, Iceberg)
```

### Parquet Schema

```
sha:       BYTE_ARRAY  (bloom filter for point lookups)
type:      BYTE_ARRAY  (shredded: commit|tree|blob|tag)
size:      INT64       (shredded)
path:      BYTE_ARRAY  (shredded: file path, nullable)
storage:   BYTE_ARRAY  (shredded: inline|r2|lfs)
data:      VARIANT     (entire git object - binary or structured)
```

### Three Storage Modes

| Mode     | When                  | Where data lives                    |
|----------|-----------------------|-------------------------------------|
| `inline` | < 1MB (code, docs)    | VARIANT in parquet                  |
| `r2`     | > 1MB, non-LFS       | Raw R2 object, VARIANT reference    |
| `lfs`    | Git LFS pointer       | Raw R2 object, LFS metadata in VARIANT |

### Key Modules

- `src/storage/variant-codec.ts` - Git object <-> VARIANT encoding
- `src/storage/bloom-cache.ts` - SQLite bloom filter for SHA existence checks
- `src/storage/parquet-store.ts` - R2 Parquet backend implementing StorageBackend
- `src/do/object-store.ts` - ObjectStore class (delegates to parquet-store or SQLite)
- `src/do/routes.ts` - HTTP route handlers including /export (Parquet)
- `src/do/schema.ts` - SQLite schema for refs + bloom filter
- `src/types/storage.ts` - Canonical ObjectStore/CommitProvider interfaces
- `src/types/objects.ts` - Git object types and serialization

### Dependencies

- `hyparquet` / `hyparquet-writer` - Parquet read/write
- `lz4js` - LZ4 compression for Parquet
- `pako` - gzip/deflate compression
- `hono` - HTTP routing in Durable Objects

### Build & Test

```bash
pnpm install
pnpm test              # Cloudflare Workers tests (vitest)
pnpm test:node         # Node.js tests
pnpm build             # TypeScript compilation
pnpm deploy            # Deploy to Cloudflare
```

### Coding Conventions

- TypeScript strict mode, ES2022 target
- Module-level TextEncoder/TextDecoder (avoid per-call allocation)
- SHA-1 hashes as 40-char lowercase hex strings
- Uint8Array for all binary data (not Buffer)
- Cloudflare Workers compatible (no Node.js APIs unless in vitest.node.config.ts)

### R2 Bucket Layout

```
gitx-objects/    (R2 binding)  - Large raw objects (>1MB)
gitx-packs/     (PACK_STORAGE) - Legacy pack files
gitx-analytics/ (ANALYTICS_BUCKET) - Parquet files for all git objects
  {owner}/{repo}/objects/{uuid}.parquet   - Git objects
  {owner}/{repo}/refs/{uuid}.parquet      - Git refs
  {owner}/{repo}/commits/{uuid}.parquet   - Commit analytics
```

### Delta Lake / Branching

Branch/merge maps directly to Delta log fork/merge:
- `refs/heads/main` -> Delta log version N
- `refs/heads/feature` -> Delta log version M (forked from N)
- `git merge` -> three-way merge on Delta logs
