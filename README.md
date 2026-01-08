# gitx.do

> Git. Edge-Native. AI-First.

GitHub charges $21/user/month for features Git gives you free. GitLab requires self-hosting a 10GB Docker image. Bitbucket exists for some reason. All of them treat your repository as their asset, your history as their leverage, your workflows as their lock-in.

**gitx.do** is Git reimplemented on Cloudflare Durable Objects. Your repositories run on infrastructure you control. Pack files, wire protocol, delta compression - all at the edge.

## AI-Native API

```typescript
import { gitx } from 'gitx.do'           // Full SDK
import { gitx } from 'gitx.do/tiny'      // Minimal client
import { gitx } from 'gitx.do/pack'      // Pack operations only
```

Natural language for git operations:

```typescript
import { gitx } from 'gitx.do'

// Talk to it like a colleague
const changes = await gitx`what changed today?`
const commits = await gitx`commits this week by sarah`
const diff = await gitx`show me the auth changes since monday`

// Chain like sentences
await gitx`analyze packfile`
  .verify()
  .optimize()

// Packs that manage themselves
await gitx`repack the repo`
  .deltify()       // delta compression
  .dedupe()        // remove duplicates
  .gc()            // garbage collect
```

## The Problem

Git hosting has become a tax on developers:

| What They Charge | The Reality |
|------------------|-------------|
| **Per-seat pricing** | $21/user/month (GitHub Enterprise) |
| **Actions minutes** | $0.008/minute, adds up fast |
| **Storage** | $0.25/GB after 1GB |
| **LFS bandwidth** | $0.0875/GB after 1GB |
| **Advanced security** | Extra $49/user/month |
| **Lock-in** | Years of workflows trapped |

### The Hosting Tax

Every major git host:
- Charges per seat for collaboration features
- Meters CI/CD by the minute
- Limits LFS bandwidth and storage
- Requires premium tiers for security features
- Makes migration painful by design

Your code is hostage to their pricing page.

### The Self-Hosting Trap

Self-host GitLab? Prepare for:
- 10GB+ Docker images
- PostgreSQL, Redis, Sidekiq, Gitaly
- Complex Kubernetes deployments
- Constant maintenance burden
- Still pay for enterprise features

The "free" alternative costs more in ops time.

## The Solution

**gitx.do** reimagines git hosting:

```
GitHub/GitLab                   gitx.do
-----------------------------------------------------------------
$21/user/month                  $0 - run your own
10GB Docker images              Deploy in minutes
Centralized servers             Edge-native, global
Actions lock-in                 Any CI system
LFS bandwidth charges           R2 storage (no egress fees)
Vendor lock-in                  Git protocol, open source
```

## One-Click Deploy

```bash
npx create-dotdo gitx
```

Git hosting. Running on infrastructure you control. Full protocol support from day one.

```typescript
import { GitX } from 'gitx.do'

export default GitX({
  name: 'my-repos',
  domain: 'git.mycompany.com',
})
```

## Features

### Repository Operations

```typescript
// Find anything
const log = await gitx`log for main this month`
const authors = await gitx`who contributed to src/auth`
const blame = await gitx`blame utils.ts lines 50-100`

// AI infers what you need
await gitx`my-repo`                    // returns repo info
await gitx`branches in my-repo`        // returns branch list
await gitx`my-repo commit activity`    // returns statistics
```

### Commits

```typescript
// History is one question
await gitx`commits today`
await gitx`what did sarah commit this week`
await gitx`breaking changes since v1.0`

// Commit search just works
await gitx`commits mentioning auth bug`
await gitx`commits touching package.json`
```

### Branches

```typescript
// Natural as talking
await gitx`create feature/auth from main`
await gitx`merge feature/auth into main`
await gitx`branches ahead of main`

// Bulk operations read naturally
await gitx`stale branches older than 90 days`
  .each(branch => branch.delete())
```

### Diffs

```typescript
// View changes naturally
await gitx`diff between main and feature`
await gitx`what changed in src since monday`
await gitx`show me the auth refactor`

// AI summarizes when you want
await gitx`summarize changes in this PR`
```

### Pack Files

```typescript
// Pack operations in plain language
await gitx`repack my-repo aggressively`
await gitx`verify pack integrity`
await gitx`optimize delta chains`

// AI handles the complexity
await gitx`gc and optimize storage`
```

### Wire Protocol

```typescript
// Full smart HTTP protocol
await gitx`serve fetch for client`
await gitx`accept push from remote`

// Protocol negotiation automatic
// Side-band, delta, multi-ack - all handled
```

## Tiered Storage

```typescript
// Storage tiers just work
await gitx`object abc123`              // automatic tier resolution
await gitx`promote cold objects`       // tier management
await gitx`archive objects older than 1 year`

// Query storage state
await gitx`storage stats for my-repo`
```

### Storage Architecture

| Tier | Storage | Use Case | Query Speed |
|------|---------|----------|-------------|
| **Hot** | SQLite | Recent commits, active branches | <10ms |
| **Warm** | R2 Packed | Full history, pack files | <100ms |
| **Cold** | R2 Archive | Ancient history, old packs | <1s |

## Pack File Engine

Full Git packfile v2/v3 support with delta compression:

```typescript
// Pack operations naturally
await gitx`create pack for branch main`
await gitx`unpack received packfile`
await gitx`verify all packs`

// Delta compression automatic
await gitx`optimize pack deltas`
  .rebase()         // recompute delta bases
  .prune()          // remove unused
```

### Pack Features

- Delta compression (OFS_DELTA, REF_DELTA)
- Multi-pack indexes (MIDX)
- Pack verification with CRC32
- Streaming pack generation
- Thin pack support for network transfer

## Wire Protocol

Full smart HTTP/SSH protocol implementation:

```typescript
// Serve git clients natively
await gitx`handle git fetch`
await gitx`accept git push`

// Protocol features automatic
// - Capability negotiation
// - Side-band progress
// - Multi-ack for efficiency
// - Shallow clone support
```

## AI-Native Git

### Semantic Search

```typescript
// Find commits by meaning, not just text
await gitx`commits that fixed security issues`
await gitx`when did we add rate limiting`
await gitx`changes related to the login bug`
```

### Code Review

```typescript
// AI-assisted review
await gitx`review changes in this PR`
await gitx`find potential bugs in diff`
await gitx`suggest improvements for commit`
```

### History Analysis

```typescript
// Understand your codebase
await gitx`who knows auth code best`
await gitx`files that change together`
await gitx`hotspots in the last quarter`
```

## Architecture

### Durable Object per Repository

```
RepositoryDO (metadata, refs, config)
  |
  +-- ObjectsDO (loose objects, pack index)
  |     |-- SQLite: Hot objects (recent)
  |     +-- R2: Packed objects (warm)
  |
  +-- RefsDO (branches, tags, HEAD)
  |     |-- SQLite: Current refs
  |
  +-- PacksDO (pack management, MIDX)
  |     |-- SQLite: Pack metadata
  |     +-- R2: Pack files
  |
  +-- LFSDO (large file storage)
        +-- R2: LFS objects (no egress fees)
```

### Why Durable Objects for Git

Git is already content-addressed. Durable Objects + SQLite + R2 is the perfect fit:

- **Objects** are immutable blobs - cache forever
- **Refs** are mutable pointers - strong consistency needed
- **Packs** are large files - R2 handles it
- **Global** - edge locations worldwide

## vs GitHub/GitLab

| Feature | GitHub/GitLab | gitx.do |
|---------|---------------|---------|
| **Pricing** | Per-seat, metered | ~$5/month base |
| **Hosting** | Their servers | Your Cloudflare account |
| **Protocol** | Full git | Full git |
| **LFS** | Bandwidth charges | R2 (no egress fees) |
| **CI/CD** | Actions lock-in | Any CI system |
| **Self-host** | Complex | One-click deploy |
| **AI** | Copilot ($19/mo extra) | Built-in |
| **Lock-in** | Workflows, Actions | Open source |

## Use Cases

### Private Git Hosting

Your repositories on infrastructure you control. Full git protocol. No per-seat fees.

### LFS Without Bandwidth Fees

R2 has no egress charges. Store large files without surprise bills.

```typescript
// LFS just works
await gitx`track *.psd with lfs`
await gitx`lfs storage usage`
```

### Git Analytics

```typescript
// Understand your repository
await gitx`contributor stats this quarter`
await gitx`code churn analysis`
await gitx`commit velocity trends`
```

### Multi-Repo Management

```typescript
// Manage all repos at once
await gitx`all repos`
  .each(repo => repo.gc())

await gitx`repos with stale branches`
  .each(repo => repo.prune())
```

## Deployment

### Cloudflare Workers

```bash
npx create-dotdo gitx
# Your private git hosting in minutes
```

### Mirror Existing Repos

```typescript
// Mirror from GitHub/GitLab
await gitx`mirror github.com/org/repo`
await gitx`sync mirror hourly`
```

## Roadmap

### Core Git
- [x] Object storage (blob, tree, commit, tag)
- [x] Pack files v2/v3
- [x] Delta compression
- [x] Smart HTTP protocol
- [x] Ref management
- [x] Multi-pack index
- [ ] Shallow clone
- [ ] Partial clone
- [ ] Commit graph

### Storage
- [x] Hot tier (SQLite)
- [x] Warm tier (R2)
- [x] Cold tier (archive)
- [x] Automatic promotion
- [ ] Pack gc
- [ ] Bitmap indexes

### AI
- [x] Natural language queries
- [x] Semantic commit search
- [ ] Code review assistant
- [ ] History analysis
- [ ] Merge conflict resolution

## Contributing

gitx.do is open source under the MIT license.

```bash
git clone https://github.com/dotdo/gitx.do
cd gitx.do
pnpm install
pnpm test
```

## License

MIT License - Git, liberated.

---

<p align="center">
  <strong>Git hosting without the tax.</strong>
  <br />
  Edge-native. AI-first. Yours.
  <br /><br />
  <a href="https://gitx.do">Website</a> |
  <a href="https://docs.gitx.do">Docs</a> |
  <a href="https://discord.gg/dotdo">Discord</a> |
  <a href="https://github.com/dotdo/gitx.do">GitHub</a>
</p>
