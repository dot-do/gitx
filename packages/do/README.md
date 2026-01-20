# gitx.do

Git on Cloudflare Durable Objects - A complete git reimplementation for the edge.

This package provides Cloudflare Workers/Durable Objects integration for git. It depends on [@dotdo/gitx](../core) for the pure git implementation.

## Installation

```bash
npm install gitx.do
```

## Features

- **Durable Object Integration** - GitRepoDO for full repository management
- **R2 Storage** - Packfile storage with tiered hot/warm/cold system
- **MCP Integration** - Model Context Protocol for AI assistant integration
- **Wire Protocol** - Git Smart HTTP protocol handlers
- **Mixins** - withGit, withFs for adding git capabilities to any DO

## Usage

```typescript
import { GitRepoDO, GitModule, withGit } from 'gitx.do'

// Export GitRepoDO for full repository management
export { GitRepoDO }

// Or use mixins for custom DOs
class MyDO extends withGit(DurableObject) {
  async doSomething() {
    await this.git.clone('https://github.com/org/repo')
    const status = await this.git.status()
    console.log(status)
  }
}
```

## Architecture

```
gitx.do
├── do/           # Durable Object implementations
│   ├── GitRepoDO     # Full git repository DO
│   ├── GitModule     # Git capability module
│   ├── FsModule      # Filesystem capability
│   ├── withGit       # Git mixin
│   └── withFs        # Fs mixin
├── storage/      # Storage implementations
│   ├── r2-pack       # R2 packfile storage
│   ├── tiered        # Hot/warm/cold tiering
│   └── object-index  # Object location tracking
├── wire/         # Git wire protocol
│   ├── smart-http    # HTTP handlers
│   ├── pkt-line      # Packet line format
│   └── capabilities  # Protocol capabilities
└── mcp/          # MCP integration
    ├── tools         # MCP tool definitions
    └── adapter       # Protocol adapter
```

## Related

- [@dotdo/gitx](../core) - Pure git implementation (zero CF deps)
- [fsx.do](https://fsx.do) - Filesystem for Workers
- [bashx.do](https://bashx.do) - Shell execution for Workers

## License

MIT
