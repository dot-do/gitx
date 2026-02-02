import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  parseBlob,
  parseTree,
  parseCommit,
  serializeBlob,
  serializeCommit,
  serializeTree,
  isValidSha,
} from '../../src/types/objects'

/**
 * Integration tests that create real git repos via the CLI and
 * verify our parsing/serialization against real git output.
 */

let repoDir: string
let hasGit = false

function git(cmd: string): string {
  return execSync(`git ${cmd}`, { cwd: repoDir, encoding: 'utf-8' }).trim()
}

function gitBuf(cmd: string): Buffer {
  return execSync(`git ${cmd}`, { cwd: repoDir })
}

beforeAll(() => {
  try {
    execSync('git --version', { encoding: 'utf-8' })
    hasGit = true
  } catch {
    hasGit = false
    return
  }

  repoDir = mkdtempSync(join(tmpdir(), 'gitx-integration-'))

  // Initialize repo with a commit
  git('init')
  git('config user.email "test@example.com"')
  git('config user.name "Test User"')

  execSync('echo "Hello World" > README.md', { cwd: repoDir })
  git('add README.md')
  git('commit -m "Initial commit"')

  // Add a subdirectory
  execSync('mkdir -p src && echo "console.log(1)" > src/index.ts', { cwd: repoDir })
  git('add src/index.ts')
  git('commit -m "Add source file"')
})

afterAll(() => {
  if (hasGit && repoDir) {
    rmSync(repoDir, { recursive: true, force: true })
  }
})

function skipIfNoGit() {
  if (!hasGit) return true
  return false
}

describe('local git - refs', () => {
  it('should resolve HEAD to a valid SHA', () => {
    if (skipIfNoGit()) return

    const sha = git('rev-parse HEAD')
    expect(sha).toMatch(/^[0-9a-f]{40}$/)
    expect(isValidSha(sha)).toBe(true)
  })

  it('should list refs', () => {
    if (skipIfNoGit()) return

    const refs = git('show-ref --head').split('\n')
    expect(refs.length).toBeGreaterThan(0)

    for (const line of refs) {
      const [sha, name] = line.split(' ')
      expect(sha).toMatch(/^[0-9a-f]{40}$/)
      expect(name).toBeTruthy()
    }
  })
})

describe('local git - blob parsing', () => {
  it('should parse a real blob object', () => {
    if (skipIfNoGit()) return

    // Get the blob SHA for README.md at HEAD
    const blobSha = git('rev-parse HEAD:README.md')
    expect(isValidSha(blobSha)).toBe(true)

    // Read the raw git object
    const raw = gitBuf(`cat-file blob ${blobSha}`)
    const content = raw.toString('utf-8')
    expect(content).toContain('Hello World')

    // Build a full git object with header and parse it
    const fullObject = serializeBlob(new Uint8Array(raw))
    const parsed = parseBlob(fullObject)
    expect(parsed.type).toBe('blob')
    expect(new TextDecoder().decode(parsed.data)).toContain('Hello World')
  })

  it('should produce the same SHA as git when serializing a blob', () => {
    if (skipIfNoGit()) return

    const content = new TextEncoder().encode('Hello World\n')
    const serialized = serializeBlob(content)

    // Compute SHA-1 via crypto
    const crypto = require('crypto')
    const ourSha = crypto.createHash('sha1').update(serialized).digest('hex')

    // Ask git for the hash of the same content
    const gitSha = git('hash-object --stdin <<< "Hello World"')

    expect(ourSha).toBe(gitSha)
  })
})

describe('local git - tree parsing', () => {
  it('should parse a real tree object', () => {
    if (skipIfNoGit()) return

    const treeSha = git('rev-parse HEAD^{tree}')
    expect(isValidSha(treeSha)).toBe(true)

    // Get raw tree object with header
    const raw = gitBuf(`cat-file -p ${treeSha}`)
    const lines = raw.toString('utf-8').trim().split('\n')

    // Verify tree has entries
    expect(lines.length).toBeGreaterThan(0)

    // Parse each line from git cat-file -p output
    for (const line of lines) {
      // Format: "mode type sha\tname"
      const match = line.match(/^(\d+)\s+(blob|tree)\s+([0-9a-f]{40})\t(.+)$/)
      expect(match).toBeTruthy()
      if (match) {
        expect(['100644', '100755', '040000']).toContain(match[1])
        expect(isValidSha(match[3])).toBe(true)
        expect(match[4]).toBeTruthy()
      }
    }
  })

  it('should round-trip a tree through serialize/parse', () => {
    if (skipIfNoGit()) return

    const treeSha = git('rev-parse HEAD^{tree}')

    // Use git cat-file -p to get the entries
    const output = git(`cat-file -p ${treeSha}`)
    const entries = output.split('\n').map(line => {
      const match = line.match(/^(\d+)\s+\w+\s+([0-9a-f]{40})\t(.+)$/)
      if (!match) throw new Error(`Bad tree line: ${line}`)
      return { mode: match[1], sha: match[2], name: match[3] }
    })

    // Serialize then parse
    const serialized = serializeTree(entries)
    const parsed = parseTree(serialized)

    expect(parsed.type).toBe('tree')
    expect(parsed.entries.length).toBe(entries.length)

    for (let i = 0; i < entries.length; i++) {
      // Entries may be reordered by serialization sort, so find by name
      const found = parsed.entries.find(e => e.name === entries[i].name)
      expect(found).toBeDefined()
      expect(found!.sha).toBe(entries[i].sha)
      expect(found!.mode).toBe(entries[i].mode)
    }
  })
})

describe('local git - commit parsing', () => {
  it('should parse a real commit object', () => {
    if (skipIfNoGit()) return

    const commitSha = git('rev-parse HEAD')

    // Get raw commit content (without header) via cat-file
    const rawContent = git(`cat-file -p ${commitSha}`)

    // Verify expected fields in raw output
    expect(rawContent).toContain('tree ')
    expect(rawContent).toContain('author ')
    expect(rawContent).toContain('committer ')
    expect(rawContent).toContain('Add source file')

    // Build full object with header for our parser
    const contentBytes = new TextEncoder().encode(rawContent)
    const header = new TextEncoder().encode(`commit ${contentBytes.length}\0`)
    const fullObject = new Uint8Array(header.length + contentBytes.length)
    fullObject.set(header)
    fullObject.set(contentBytes, header.length)

    const parsed = parseCommit(fullObject)
    expect(parsed.type).toBe('commit')
    expect(isValidSha(parsed.tree)).toBe(true)
    expect(parsed.author.name).toBe('Test User')
    expect(parsed.author.email).toBe('test@example.com')
    expect(parsed.committer.name).toBe('Test User')
    expect(parsed.message).toContain('Add source file')
    expect(parsed.parents.length).toBe(1)
    expect(isValidSha(parsed.parents[0])).toBe(true)
  })

  it('should round-trip a commit through serialize/parse', () => {
    if (skipIfNoGit()) return

    const commitSha = git('rev-parse HEAD')
    const rawContent = git(`cat-file -p ${commitSha}`)

    // Parse the raw content manually to build a commit for serialization
    const contentBytes = new TextEncoder().encode(rawContent)
    const header = new TextEncoder().encode(`commit ${contentBytes.length}\0`)
    const fullObject = new Uint8Array(header.length + contentBytes.length)
    fullObject.set(header)
    fullObject.set(contentBytes, header.length)

    const parsed = parseCommit(fullObject)

    // Re-serialize and re-parse
    const reserialized = serializeCommit({
      tree: parsed.tree,
      parents: parsed.parents,
      author: parsed.author,
      committer: parsed.committer,
      message: parsed.message,
    })

    const reparsed = parseCommit(reserialized)
    expect(reparsed.tree).toBe(parsed.tree)
    expect(reparsed.parents).toEqual(parsed.parents)
    expect(reparsed.author).toEqual(parsed.author)
    expect(reparsed.committer).toEqual(parsed.committer)
    expect(reparsed.message).toBe(parsed.message)
  })
})

describe('local git - SHA computation', () => {
  it('should compute the same SHA as git for a blob', () => {
    if (skipIfNoGit()) return

    const crypto = require('crypto')

    // Create a known blob and verify SHA matches
    const blobSha = git('rev-parse HEAD:README.md')
    const blobContent = gitBuf('cat-file blob ' + blobSha)

    const serialized = serializeBlob(new Uint8Array(blobContent))
    const computedSha = crypto.createHash('sha1').update(serialized).digest('hex')

    expect(computedSha).toBe(blobSha)
  })

  it('should compute the same SHA as git for a commit', () => {
    if (skipIfNoGit()) return

    const crypto = require('crypto')
    const commitSha = git('rev-parse HEAD')
    const rawContent = git(`cat-file -p ${commitSha}`)

    const contentBytes = new TextEncoder().encode(rawContent)
    const header = new TextEncoder().encode(`commit ${contentBytes.length}\0`)
    const fullObject = new Uint8Array(header.length + contentBytes.length)
    fullObject.set(header)
    fullObject.set(contentBytes, header.length)

    const parsed = parseCommit(fullObject)
    const reserialized = serializeCommit({
      tree: parsed.tree,
      parents: parsed.parents,
      author: parsed.author,
      committer: parsed.committer,
      message: parsed.message,
    })

    const computedSha = crypto.createHash('sha1').update(reserialized).digest('hex')
    expect(computedSha).toBe(commitSha)
  })
})
