/**
 * @fileoverview Repository analytics and metrics dashboard.
 *
 * Provides Hono routes that serve HTML dashboards showing:
 * - Commit frequency over time
 * - Contributor statistics
 * - Language breakdown
 * - File change frequency
 * - Code churn (additions/deletions)
 *
 * Uses the existing ObjectStore and enrichment modules to gather data
 * from the Git object graph stored in the Durable Object.
 *
 * @module web/analytics
 */

import type { Hono } from 'hono'
import type { ObjectStore, CommitProvider } from '../types/storage'
import type { CommitObject, TreeEntry } from '../types/objects'
import { detectLanguage } from '../enrichment/language'

// ============================================================================
// Types
// ============================================================================

interface CommitFrequencyBucket {
  /** ISO date string (YYYY-MM-DD) */
  date: string
  count: number
}

interface ContributorStats {
  name: string
  email: string
  commits: number
  firstCommit: number
  lastCommit: number
}

interface LanguageBreakdown {
  language: string
  fileCount: number
  /** Percentage of total files */
  percentage: number
}

interface FileChangeStats {
  path: string
  changeCount: number
}

interface ChurnStats {
  /** ISO date string (YYYY-MM-DD) */
  date: string
  filesChanged: number
}

interface AnalyticsData {
  commitFrequency: CommitFrequencyBucket[]
  contributors: ContributorStats[]
  languages: LanguageBreakdown[]
  fileChanges: FileChangeStats[]
  churn: ChurnStats[]
  totalCommits: number
  totalContributors: number
}

// ============================================================================
// Data Collection
// ============================================================================

/**
 * Walk commit history from a starting SHA, collecting up to `maxCommits` commits.
 */
async function walkCommits(
  provider: CommitProvider,
  startSha: string,
  maxCommits: number = 500
): Promise<CommitObject[]> {
  const commits: CommitObject[] = []
  const visited = new Set<string>()
  const queue: string[] = [startSha]

  while (queue.length > 0 && commits.length < maxCommits) {
    const sha = queue.shift()!
    if (visited.has(sha)) continue
    visited.add(sha)

    const commit = await provider.getCommit(sha)
    if (!commit) continue

    commits.push(commit)

    for (const parent of commit.parents) {
      if (!visited.has(parent)) {
        queue.push(parent)
      }
    }
  }

  return commits
}

/**
 * Collect all file paths from a tree object recursively.
 */
async function collectTreePaths(
  store: ObjectStore,
  treeSha: string,
  prefix: string = ''
): Promise<string[]> {
  const tree = await store.getTree(treeSha)
  if (!tree) return []

  const paths: string[] = []
  for (const entry of tree.entries) {
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.mode === '040000') {
      const subPaths = await collectTreePaths(store, entry.sha, fullPath)
      paths.push(...subPaths)
    } else {
      paths.push(fullPath)
    }
  }
  return paths
}

/**
 * Gather analytics data from the object store.
 */
async function gatherAnalytics(
  store: ObjectStore,
  provider: CommitProvider
): Promise<AnalyticsData> {
  // Find HEAD or main branch
  const headSha =
    (await store.getRef('HEAD')) ??
    (await store.getRef('refs/heads/main')) ??
    (await store.getRef('refs/heads/master'))

  if (!headSha) {
    return {
      commitFrequency: [],
      contributors: [],
      languages: [],
      fileChanges: [],
      churn: [],
      totalCommits: 0,
      totalContributors: 0,
    }
  }

  // Walk commits
  const commits = await walkCommits(provider, headSha, 500)

  // --- Commit frequency ---
  const frequencyMap = new Map<string, number>()
  for (const c of commits) {
    const date = new Date(c.author.timestamp * 1000).toISOString().slice(0, 10)
    frequencyMap.set(date, (frequencyMap.get(date) ?? 0) + 1)
  }
  const commitFrequency = [...frequencyMap.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // --- Contributors ---
  const contribMap = new Map<string, ContributorStats>()
  for (const c of commits) {
    const key = c.author.email.toLowerCase()
    const existing = contribMap.get(key)
    if (existing) {
      existing.commits++
      existing.firstCommit = Math.min(existing.firstCommit, c.author.timestamp)
      existing.lastCommit = Math.max(existing.lastCommit, c.author.timestamp)
    } else {
      contribMap.set(key, {
        name: c.author.name,
        email: c.author.email,
        commits: 1,
        firstCommit: c.author.timestamp,
        lastCommit: c.author.timestamp,
      })
    }
  }
  const contributors = [...contribMap.values()].sort((a, b) => b.commits - a.commits)

  // --- Language breakdown (from HEAD tree) ---
  const headCommit = await provider.getCommit(headSha)
  let languages: LanguageBreakdown[] = []
  if (headCommit) {
    const filePaths = await collectTreePaths(store, headCommit.tree)
    const langMap = new Map<string, number>()
    for (const p of filePaths) {
      const lang = detectLanguage(p)
      if (lang) {
        langMap.set(lang, (langMap.get(lang) ?? 0) + 1)
      }
    }
    const total = [...langMap.values()].reduce((s, v) => s + v, 0) || 1
    languages = [...langMap.entries()]
      .map(([language, fileCount]) => ({
        language,
        fileCount,
        percentage: Math.round((fileCount / total) * 1000) / 10,
      }))
      .sort((a, b) => b.fileCount - a.fileCount)
  }

  // --- File change frequency (compare parent trees) ---
  const fileChangeMap = new Map<string, number>()
  const churnMap = new Map<string, number>()

  // Sample up to 100 commits for file-level analysis
  const sampleCommits = commits.slice(0, 100)
  for (const c of sampleCommits) {
    if (c.parents.length === 0) continue
    const parentCommit = await provider.getCommit(c.parents[0])
    if (!parentCommit) continue

    const parentTree = await store.getTree(parentCommit.tree)
    const currentTree = await store.getTree(c.tree)
    if (!parentTree || !currentTree) continue

    // Simple top-level diff: compare entry SHAs
    const parentEntries = new Map(parentTree.entries.map((e) => [e.name, e.sha]))
    let filesChanged = 0

    for (const entry of currentTree.entries) {
      const parentSha = parentEntries.get(entry.name)
      if (parentSha !== entry.sha) {
        fileChangeMap.set(entry.name, (fileChangeMap.get(entry.name) ?? 0) + 1)
        filesChanged++
      }
    }
    // Deleted entries
    for (const entry of parentTree.entries) {
      const exists = currentTree.entries.some((e) => e.name === entry.name)
      if (!exists) {
        fileChangeMap.set(entry.name, (fileChangeMap.get(entry.name) ?? 0) + 1)
        filesChanged++
      }
    }

    const date = new Date(c.author.timestamp * 1000).toISOString().slice(0, 10)
    churnMap.set(date, (churnMap.get(date) ?? 0) + filesChanged)
  }

  const fileChanges = [...fileChangeMap.entries()]
    .map(([path, changeCount]) => ({ path, changeCount }))
    .sort((a, b) => b.changeCount - a.changeCount)
    .slice(0, 50)

  const churn = [...churnMap.entries()]
    .map(([date, filesChanged]) => ({ date, filesChanged }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    commitFrequency,
    contributors,
    languages,
    fileChanges,
    churn,
    totalCommits: commits.length,
    totalContributors: contributors.length,
  }
}

// ============================================================================
// HTML Dashboard Rendering
// ============================================================================

function renderDashboard(data: AnalyticsData): string {
  const langRows = data.languages
    .slice(0, 20)
    .map(
      (l) => `<tr><td>${esc(l.language)}</td><td>${l.fileCount}</td><td>${l.percentage}%</td></tr>`
    )
    .join('\n')

  const contribRows = data.contributors
    .slice(0, 30)
    .map(
      (c) =>
        `<tr><td>${esc(c.name)}</td><td>${esc(c.email)}</td><td>${c.commits}</td><td>${fmtDate(c.lastCommit)}</td></tr>`
    )
    .join('\n')

  const fileRows = data.fileChanges
    .slice(0, 30)
    .map((f) => `<tr><td>${esc(f.path)}</td><td>${f.changeCount}</td></tr>`)
    .join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Repository Analytics</title>
<style>
  :root { --bg: #0d1117; --card: #161b22; --border: #30363d; --text: #e6edf3; --muted: #8b949e; --accent: #58a6ff; --green: #3fb950; --red: #f85149; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); padding: 1.5rem; line-height: 1.5; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  h2 { font-size: 1.1rem; margin-bottom: 0.75rem; color: var(--accent); }
  .summary { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
  .stat-card { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 1rem 1.5rem; min-width: 140px; }
  .stat-card .value { font-size: 2rem; font-weight: 700; color: var(--accent); }
  .stat-card .label { font-size: 0.85rem; color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem; margin-bottom: 1.5rem; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 1.25rem; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { text-align: left; padding: 0.4rem 0.75rem; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 600; }
  .bar-chart { display: flex; align-items: flex-end; gap: 2px; height: 120px; }
  .bar-chart .bar { background: var(--accent); border-radius: 2px 2px 0 0; min-width: 4px; flex: 1; position: relative; }
  .bar-chart .bar:hover::after { content: attr(data-label); position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); background: var(--card); border: 1px solid var(--border); padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; white-space: nowrap; }
  .lang-bar { display: flex; height: 12px; border-radius: 6px; overflow: hidden; margin-bottom: 0.75rem; }
  .lang-bar span { display: block; }
  footer { text-align: center; color: var(--muted); font-size: 0.8rem; margin-top: 2rem; }
</style>
</head>
<body>
<h1>Repository Analytics</h1>
<p style="color:var(--muted);margin-bottom:1.5rem">Analyzed ${data.totalCommits} commits from ${data.totalContributors} contributors</p>

<div class="summary">
  <div class="stat-card"><div class="value">${data.totalCommits}</div><div class="label">Commits</div></div>
  <div class="stat-card"><div class="value">${data.totalContributors}</div><div class="label">Contributors</div></div>
  <div class="stat-card"><div class="value">${data.languages.length}</div><div class="label">Languages</div></div>
  <div class="stat-card"><div class="value">${data.fileChanges.length}</div><div class="label">Changed Files</div></div>
</div>

<div class="grid">
  <div class="card">
    <h2>Commit Frequency</h2>
    ${renderBarChart(data.commitFrequency.map((b) => ({ label: b.date, value: b.count })))}
  </div>

  <div class="card">
    <h2>Code Churn (files changed/day)</h2>
    ${renderBarChart(data.churn.map((b) => ({ label: b.date, value: b.filesChanged })), 'var(--green)')}
  </div>
</div>

<div class="grid">
  <div class="card">
    <h2>Language Breakdown</h2>
    ${renderLangBar(data.languages)}
    <table>
      <thead><tr><th>Language</th><th>Files</th><th>Share</th></tr></thead>
      <tbody>${langRows}</tbody>
    </table>
  </div>

  <div class="card">
    <h2>Contributors</h2>
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Commits</th><th>Last Active</th></tr></thead>
      <tbody>${contribRows}</tbody>
    </table>
  </div>
</div>

<div class="card" style="margin-bottom:1.5rem">
  <h2>Most Changed Files</h2>
  <table>
    <thead><tr><th>File</th><th>Changes</th></tr></thead>
    <tbody>${fileRows}</tbody>
  </table>
</div>

<footer>GitX Analytics Dashboard</footer>
</body>
</html>`
}

// ============================================================================
// Chart Helpers
// ============================================================================

const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Rust: '#dea584',
  Go: '#00ADD8',
  Java: '#b07219',
  'C++': '#f34b7d',
  C: '#555555',
  'C#': '#178600',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Shell: '#89e051',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Markdown: '#083fa1',
}

function renderBarChart(
  items: Array<{ label: string; value: number }>,
  color: string = 'var(--accent)'
): string {
  if (items.length === 0) return '<p style="color:var(--muted)">No data</p>'
  const max = Math.max(...items.map((i) => i.value), 1)
  const bars = items
    .map((i) => {
      const pct = (i.value / max) * 100
      return `<div class="bar" style="height:${Math.max(pct, 2)}%;background:${color}" data-label="${esc(i.label)}: ${i.value}"></div>`
    })
    .join('')
  return `<div class="bar-chart">${bars}</div>`
}

function renderLangBar(languages: LanguageBreakdown[]): string {
  if (languages.length === 0) return ''
  const segments = languages
    .slice(0, 10)
    .map((l) => {
      const color = LANG_COLORS[l.language] ?? '#8b949e'
      return `<span style="width:${l.percentage}%;background:${color}" title="${esc(l.language)} ${l.percentage}%"></span>`
    })
    .join('')
  return `<div class="lang-bar">${segments}</div>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

// ============================================================================
// Route Setup
// ============================================================================

/**
 * Context for analytics route dependencies.
 */
export interface AnalyticsContext {
  getObjectStore(): ObjectStore & CommitProvider
}

/**
 * Setup analytics routes on a Hono router.
 *
 * Registers:
 * - GET /analytics - HTML dashboard
 * - GET /analytics/data - JSON API for raw analytics data
 *
 * @param router - Hono router instance
 * @param getContext - Function returning the analytics context (ObjectStore + CommitProvider)
 */
export function setupAnalyticsRoutes(
  router: Hono<{ Bindings: Record<string, unknown> }>,
  getContext: () => AnalyticsContext
): void {
  router.get('/analytics', async (c) => {
    try {
      const ctx = getContext()
      const store = ctx.getObjectStore()
      const data = await gatherAnalytics(store, store)
      const html = renderDashboard(data)
      return c.html(html)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return c.html(
        `<html><body style="background:#0d1117;color:#f85149;padding:2rem;font-family:sans-serif"><h1>Analytics Error</h1><pre>${esc(message)}</pre></body></html>`,
        500
      )
    }
  })

  router.get('/analytics/data', async (c) => {
    try {
      const ctx = getContext()
      const store = ctx.getObjectStore()
      const data = await gatherAnalytics(store, store)
      return c.json(data)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return c.json({ error: message }, 500)
    }
  })
}
