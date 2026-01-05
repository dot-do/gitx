# gitx.do

Git on Cloudflare Durable Objects - A complete Git reimplementation for the edge.

## Features

- **Pack Files** - Full Git packfile v2/v3 support with delta compression
- **Wire Protocol** - Smart HTTP protocol implementation for fetch/push operations
- **MCP Tools** - Model Context Protocol integration for AI-assisted git operations
- **Tiered Storage** - Hot/warm/cold storage tiers with automatic promotion
  - Hot: Durable Object SQLite (low latency)
  - Warm: R2 object storage (packed objects)
  - Cold: Analytics/Parquet (cold storage)

## Installation

```bash
npm install gitx.do
```

## Quick Start

### Pack Index Operations

```typescript
import { parsePackIndex, createPackIndex, lookupObject } from 'gitx.do/pack'

// Parse an existing pack index
const index = parsePackIndex(indexData)
console.log(`Pack contains ${index.objectCount} objects`)

// Look up an object by SHA
const entry = lookupObject(index, 'abc123...')
if (entry) {
  console.log(`Object at offset ${entry.offset}`)
}

// Create a new pack index
const newIndex = createPackIndex({ packData })
```

### Smart HTTP Protocol

```typescript
import { handleInfoRefs, handleUploadPack, handleReceivePack } from 'gitx.do/wire/smart-http'

// Handle ref discovery
const response = await handleInfoRefs(request, repository, {
  sideBand64k: true,
  ofsDelta: true
})

// Handle fetch
const packResponse = await handleUploadPack(request, repository)

// Handle push
const pushResponse = await handleReceivePack(request, repository)
```

### MCP Tools

```typescript
import { gitTools, invokeTool, registerTool } from 'gitx.do/mcp/tools'

// List available git tools
console.log(gitTools.map(t => t.name))
// ['git_status', 'git_log', 'git_diff', 'git_commit', ...]

// Invoke a tool
const result = await invokeTool('git_status', { path: '/repo', short: true })

// Register a custom tool
registerTool({
  name: 'my_tool',
  description: 'Custom git operation',
  inputSchema: { type: 'object', properties: {} },
  handler: async (params) => ({ content: [{ type: 'text', text: 'Done' }] })
})
```

### Tiered Storage

```typescript
import { TieredReader } from 'gitx.do/tiered/read-path'

const reader = new TieredReader(hotBackend, warmBackend, coldBackend, {
  hot: { enabled: true, maxSize: 1024 * 1024 },
  warm: { enabled: true },
  cold: { enabled: true },
  promotionPolicy: 'aggressive'
})

// Read with automatic tier fallback and promotion
const result = await reader.read(sha)
console.log(`Found in ${result.tier} tier, latency: ${result.latencyMs}ms`)
```

### R2 Pack Storage

```typescript
import { R2PackStorage } from 'gitx.do/storage/r2-pack'

const storage = new R2PackStorage({ bucket, prefix: 'repos/my-repo/' })

// Upload a packfile
const result = await storage.uploadPackfile(packData, indexData)

// Download with verification
const pack = await storage.downloadPackfile(packId, { verify: true })

// Use multi-pack index for cross-pack lookups
await storage.rebuildMultiPackIndex()
const midx = await storage.getMultiPackIndex()
```

## API Overview

### Pack Module (`gitx.do/pack`)

- `parsePackIndex(data)` - Parse a pack index file
- `createPackIndex(options)` - Create a new pack index
- `lookupObject(index, sha)` - Find object by SHA in index
- `verifyPackIndex(data)` - Verify index integrity
- `calculateCRC32(data)` - Compute CRC32 checksum

### Wire Protocol (`gitx.do/wire`)

- `handleInfoRefs()` - Ref discovery endpoint
- `handleUploadPack()` - Fetch data transfer
- `handleReceivePack()` - Push data transfer
- `formatRefAdvertisement()` - Format ref list
- `parseCapabilities()` - Parse protocol capabilities

### MCP Tools (`gitx.do/mcp`)

- `gitTools` - Array of available git tool definitions
- `invokeTool(name, params)` - Execute a tool by name
- `registerTool(tool)` - Add a custom tool
- `validateToolInput(tool, params)` - Validate parameters

### Tiered Storage (`gitx.do/tiered`)

- `TieredReader` - Multi-tier read path with promotion
- `StoredObject` - Object representation
- `TieredStorageConfig` - Configuration options

### R2 Storage (`gitx.do/storage`)

- `R2PackStorage` - Packfile management for R2
- `uploadPackfile()` - Store pack and index
- `downloadPackfile()` - Retrieve with optional verification
- `createMultiPackIndex()` - Build cross-pack index

## License

MIT
