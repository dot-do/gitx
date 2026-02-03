# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Send-pack protocol** for pushing to remote repositories with Basic auth, report-status, side-band, and atomic push support
- **HTTP clone** from GitHub and other Git hosts
- **Shallow clone** support for faster repository fetching
- **Sparse checkout** for working with partial repository contents
- **Worktrees** support for multiple working directories
- **Branch protection** rules with linear history enforcement
- **LFS routes** for Git Large File Storage integration
- **Pull request workflows** with merge and diff operations
- **Web UI** with analytics dashboard
- **GitHub webhook sync** pipeline for repository mirroring
- **Background tier migration** using Durable Object alarms
- **RefLog** for tracking reference history
- **Multi-index packs** for improved pack file handling
- **Bundle storage** format with schema and migration support
- **Chunk compaction** for storage optimization
- **Access control** with strict type checking
- **Property tests** using fast-check for protocol validation
- **E2E test infrastructure** with dedicated vitest config
- **Streaming wire protocol** for efficient data transfer
- **WAL durability** improvements with garbage collection
- **Rate limiting** for API endpoints
- **Unified error hierarchy** extending WireError base class
- **Metrics collection** for storage operations

### Changed

- **Monorepo flattened** to match fsx.do pattern (packages/core -> core/)
- **R2 Parquet + VARIANT** is now the primary storage backend
- **Barrel exports** reorganized to reduce src/index.ts from 1471 to 239 lines
- **TextEncoder/TextDecoder** hoisted to module level for performance
- **Test infrastructure** split into 4 shards to prevent OOM in Workers pool
- **miniflare** moved from dependencies to devDependencies
- **ParquetStore** wired as primary backend with auto-flush

### Fixed

- **Timing attack** vulnerability in constantTimeCompare auth function
- **SQL injection** protection for dynamic table names
- **DoS protection** with configurable limits for packfile unpacking (100K objects, 1GB total, 100MB single)
- **Transaction rollback** error swallowing - original errors now preserved
- **O(n^2) delta resolution** fixed to O(n) using queue-based approach with Map dependency tracking
- **ParquetStore O(n) buffer lookup** optimized to O(1) using Map index
- **hasObject** optimized from full object read to lightweight existence check (SELECT 1)
- **Single object Parquet lookup** now uses parquetQuery with predicate pushdown
- **TypeScript strict mode** - all 269 errors resolved (noUncheckedIndexedAccess, exactOptionalPropertyTypes)
- **Pack format** writeLargeOffset BigInt precision for 64-bit values
- **Side-band demultiplexing** to use Uint8Array directly
- **Barrel export collisions** resolved with proper aliasing
- **SHA validation** and CLI typing improvements
- **Case sensitivity** in branch protection linear history check

### Security

- Add constantTimeCompare for authentication to prevent timing attacks
- Add SQL injection protection for dynamic table names
- Add configurable DoS limits for pack unpacking to prevent memory exhaustion
- Add branch protection with configurable rules
- Add webhook signature verification

### Performance

- Optimize ParquetStore single object lookup using parquetQuery with predicate pushdown
- Optimize hasObject to use SELECT 1 instead of full object read
- Add bufferIndex Map for O(1) buffer lookups in pack generation
- Fix O(n^2) delta resolution to O(n) with queue-based algorithm
- Hoist TextEncoder/TextDecoder to module level (~35 files)
- Add SQL IN batching with 999 parameter limit

## [0.1.0] - 2026-01-09

### Added

- Full Git implementation on Cloudflare Durable Objects
- Complete Git object model (blobs, trees, commits, tags)
- Branch and reference management
- Merge and diff algorithms
- MCP (Model Context Protocol) tools for AI agent Git access
- CLI commands for Git operations
- R2-backed object storage for Git objects
- Built on fsx.do virtual filesystem layer
- Comprehensive test suite with 5,684 passing tests
- Support for Node.js 18+ environments
- Cloudflare Workers deployment support

[Unreleased]: https://github.com/dot-do/gitx/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dot-do/gitx/releases/tag/v0.1.0
