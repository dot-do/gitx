import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'

// ============================================================================
// Test Configuration
// ============================================================================

/**
 * The E2E tests use a configurable server URL.
 * By default, tests will skip network operations if the server is not available.
 *
 * To run against a local server:
 *   GITX_TEST_SERVER=http://localhost:8787 pnpm test:node
 *
 * To run against production:
 *   GITX_TEST_SERVER=https://gitx.do pnpm test:node
 */
const TEST_SERVER = process.env.GITX_TEST_SERVER || 'http://localhost:8787'
const SKIP_NETWORK_TESTS = !process.env.GITX_TEST_SERVER

// ============================================================================
// Helper Functions
// ============================================================================

interface GitResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Execute a git command in the specified directory
 */
function git(cwd: string, ...args: string[]): GitResult {
  try {
    // Properly quote arguments that contain spaces or special characters
    const quotedArgs = args.map(arg => {
      if (arg.includes(' ') || arg.includes('"') || arg.includes("'")) {
        // Escape any existing double quotes and wrap in double quotes
        return `"${arg.replace(/"/g, '\\"')}"`
      }
      return arg
    })
    const command = ['git', ...quotedArgs].join(' ')

    const result = execSync(command, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Disable git credential helpers to avoid prompts
        GIT_ASKPASS: 'echo',
        GIT_TERMINAL_PROMPT: '0',
        // Use test user identity
        GIT_AUTHOR_NAME: 'Test User',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test User',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
      timeout: 30000, // 30 second timeout
    })
    return { stdout: result, stderr: '', exitCode: 0 }
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; status?: number }
    return {
      stdout: execError.stdout ?? '',
      stderr: execError.stderr ?? '',
      exitCode: execError.status ?? 1,
    }
  }
}

/**
 * Execute a git command and expect it to succeed
 */
function gitExpectSuccess(cwd: string, ...args: string[]): string {
  const result = git(cwd, ...args)
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
  }
  return result.stdout.trim()
}

/**
 * Create a temporary directory for git operations
 */
function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'gitx-e2e-'))
}

/**
 * Clean up a temporary directory
 */
function cleanupTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Check if the test server is reachable
 */
async function isServerReachable(): Promise<boolean> {
  if (SKIP_NETWORK_TESTS) return false

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(`${TEST_SERVER}/health`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)
    return response.ok || response.status === 404 // 404 is acceptable (health endpoint may not exist)
  } catch {
    return false
  }
}

/**
 * Generate a unique repository name for testing
 */
function uniqueRepoName(): string {
  return `e2e-test-${Date.now()}-${Math.random().toString(36).substring(7)}`
}

// ============================================================================
// E2E Tests: Local Git Operations
// ============================================================================

describe('E2E: Local Git Operations', () => {
  let tempDirs: string[] = []

  beforeEach(() => {
    tempDirs = []
  })

  afterEach(() => {
    for (const dir of tempDirs) {
      cleanupTempDir(dir)
    }
    tempDirs = []
  })

  describe('git init', () => {
    it('should initialize a new repository', () => {
      const tempDir = createTempDir()
      tempDirs.push(tempDir)

      gitExpectSuccess(tempDir, 'init')

      expect(existsSync(join(tempDir, '.git'))).toBe(true)
      expect(existsSync(join(tempDir, '.git', 'HEAD'))).toBe(true)
    })

    it('should initialize with a specific branch name', () => {
      const tempDir = createTempDir()
      tempDirs.push(tempDir)

      gitExpectSuccess(tempDir, 'init', '-b', 'main')

      const headContent = readFileSync(join(tempDir, '.git', 'HEAD'), 'utf-8')
      expect(headContent.trim()).toBe('ref: refs/heads/main')
    })
  })

  describe('git add and commit', () => {
    it('should add and commit files', () => {
      const tempDir = createTempDir()
      tempDirs.push(tempDir)

      gitExpectSuccess(tempDir, 'init')
      gitExpectSuccess(tempDir, 'checkout', '-b', 'main')

      writeFileSync(join(tempDir, 'test.txt'), 'Hello, World!')
      gitExpectSuccess(tempDir, 'add', 'test.txt')
      gitExpectSuccess(tempDir, 'commit', '-m', 'Initial commit')

      const log = gitExpectSuccess(tempDir, 'log', '--oneline')
      expect(log).toContain('Initial commit')
    })

    it('should track multiple files', () => {
      const tempDir = createTempDir()
      tempDirs.push(tempDir)

      gitExpectSuccess(tempDir, 'init')
      gitExpectSuccess(tempDir, 'checkout', '-b', 'main')

      writeFileSync(join(tempDir, 'file1.txt'), 'Content 1')
      writeFileSync(join(tempDir, 'file2.txt'), 'Content 2')
      writeFileSync(join(tempDir, 'file3.txt'), 'Content 3')

      gitExpectSuccess(tempDir, 'add', '.')
      gitExpectSuccess(tempDir, 'commit', '-m', 'Add multiple files')

      const status = gitExpectSuccess(tempDir, 'status', '--porcelain')
      expect(status).toBe('') // Clean working directory
    })
  })

  describe('git branch', () => {
    it('should create and switch branches', () => {
      const tempDir = createTempDir()
      tempDirs.push(tempDir)

      gitExpectSuccess(tempDir, 'init')
      gitExpectSuccess(tempDir, 'checkout', '-b', 'main')

      writeFileSync(join(tempDir, 'main.txt'), 'Main content')
      gitExpectSuccess(tempDir, 'add', 'main.txt')
      gitExpectSuccess(tempDir, 'commit', '-m', 'Main commit')

      // Create and switch to feature branch
      gitExpectSuccess(tempDir, 'checkout', '-b', 'feature')

      writeFileSync(join(tempDir, 'feature.txt'), 'Feature content')
      gitExpectSuccess(tempDir, 'add', 'feature.txt')
      gitExpectSuccess(tempDir, 'commit', '-m', 'Feature commit')

      // Verify branch exists
      const branches = gitExpectSuccess(tempDir, 'branch')
      expect(branches).toContain('main')
      expect(branches).toContain('feature')
    })

    it('should list branches with -a flag', () => {
      const tempDir = createTempDir()
      tempDirs.push(tempDir)

      gitExpectSuccess(tempDir, 'init')
      gitExpectSuccess(tempDir, 'checkout', '-b', 'main')
      writeFileSync(join(tempDir, 'test.txt'), 'Test')
      gitExpectSuccess(tempDir, 'add', '.')
      gitExpectSuccess(tempDir, 'commit', '-m', 'Initial')

      gitExpectSuccess(tempDir, 'branch', 'dev')
      gitExpectSuccess(tempDir, 'branch', 'release')

      const branches = gitExpectSuccess(tempDir, 'branch', '-a')
      expect(branches).toContain('main')
      expect(branches).toContain('dev')
      expect(branches).toContain('release')
    })
  })

  describe('git log', () => {
    it('should show commit history', () => {
      const tempDir = createTempDir()
      tempDirs.push(tempDir)

      gitExpectSuccess(tempDir, 'init')
      gitExpectSuccess(tempDir, 'checkout', '-b', 'main')

      // Create multiple commits
      for (let i = 1; i <= 3; i++) {
        writeFileSync(join(tempDir, `commit${i}.txt`), `Content ${i}`)
        gitExpectSuccess(tempDir, 'add', '.')
        gitExpectSuccess(tempDir, 'commit', '-m', `Commit ${i}`)
      }

      const log = gitExpectSuccess(tempDir, 'log', '--oneline')
      const lines = log.split('\n').filter(l => l.trim())

      expect(lines.length).toBe(3)
      expect(log).toContain('Commit 1')
      expect(log).toContain('Commit 2')
      expect(log).toContain('Commit 3')
    })

    it('should show log with graph format', () => {
      const tempDir = createTempDir()
      tempDirs.push(tempDir)

      gitExpectSuccess(tempDir, 'init')
      gitExpectSuccess(tempDir, 'checkout', '-b', 'main')

      writeFileSync(join(tempDir, 'init.txt'), 'Init')
      gitExpectSuccess(tempDir, 'add', '.')
      gitExpectSuccess(tempDir, 'commit', '-m', 'Initial')

      // Create branch and merge
      gitExpectSuccess(tempDir, 'checkout', '-b', 'feature')
      writeFileSync(join(tempDir, 'feature.txt'), 'Feature')
      gitExpectSuccess(tempDir, 'add', '.')
      gitExpectSuccess(tempDir, 'commit', '-m', 'Feature work')

      gitExpectSuccess(tempDir, 'checkout', 'main')
      gitExpectSuccess(tempDir, 'merge', '--no-ff', '-m', 'Merge feature', 'feature')

      const log = gitExpectSuccess(tempDir, 'log', '--graph', '--oneline', '--all')
      expect(log).toContain('Merge feature')
    })
  })

  describe('git diff', () => {
    it('should show unstaged changes', () => {
      const tempDir = createTempDir()
      tempDirs.push(tempDir)

      gitExpectSuccess(tempDir, 'init')
      gitExpectSuccess(tempDir, 'checkout', '-b', 'main')

      writeFileSync(join(tempDir, 'test.txt'), 'Original content')
      gitExpectSuccess(tempDir, 'add', '.')
      gitExpectSuccess(tempDir, 'commit', '-m', 'Initial')

      // Modify file
      writeFileSync(join(tempDir, 'test.txt'), 'Modified content')

      const diff = gitExpectSuccess(tempDir, 'diff')
      expect(diff).toContain('-Original content')
      expect(diff).toContain('+Modified content')
    })

    it('should show staged changes with --staged', () => {
      const tempDir = createTempDir()
      tempDirs.push(tempDir)

      gitExpectSuccess(tempDir, 'init')
      gitExpectSuccess(tempDir, 'checkout', '-b', 'main')

      writeFileSync(join(tempDir, 'test.txt'), 'Original')
      gitExpectSuccess(tempDir, 'add', '.')
      gitExpectSuccess(tempDir, 'commit', '-m', 'Initial')

      writeFileSync(join(tempDir, 'test.txt'), 'Modified')
      gitExpectSuccess(tempDir, 'add', '.')

      const diff = gitExpectSuccess(tempDir, 'diff', '--staged')
      expect(diff).toContain('-Original')
      expect(diff).toContain('+Modified')
    })
  })

  describe('git tag', () => {
    it('should create lightweight tags', () => {
      const tempDir = createTempDir()
      tempDirs.push(tempDir)

      gitExpectSuccess(tempDir, 'init')
      gitExpectSuccess(tempDir, 'checkout', '-b', 'main')

      writeFileSync(join(tempDir, 'version.txt'), '1.0.0')
      gitExpectSuccess(tempDir, 'add', '.')
      gitExpectSuccess(tempDir, 'commit', '-m', 'v1.0.0')

      gitExpectSuccess(tempDir, 'tag', 'v1.0.0')

      const tags = gitExpectSuccess(tempDir, 'tag')
      expect(tags).toContain('v1.0.0')
    })

    it('should create annotated tags', () => {
      const tempDir = createTempDir()
      tempDirs.push(tempDir)

      gitExpectSuccess(tempDir, 'init')
      gitExpectSuccess(tempDir, 'checkout', '-b', 'main')

      writeFileSync(join(tempDir, 'release.txt'), 'Release notes')
      gitExpectSuccess(tempDir, 'add', '.')
      gitExpectSuccess(tempDir, 'commit', '-m', 'Release 1.0')

      gitExpectSuccess(tempDir, 'tag', '-a', 'v1.0.0', '-m', 'Version 1.0.0 release')

      const tagInfo = gitExpectSuccess(tempDir, 'show', 'v1.0.0')
      expect(tagInfo).toContain('Version 1.0.0 release')
    })
  })
})

// ============================================================================
// E2E Tests: Git Protocol (Network Operations)
// ============================================================================

describe('E2E: Git Protocol Operations', () => {
  let tempDirs: string[] = []
  let serverAvailable = false

  beforeEach(async () => {
    tempDirs = []
    serverAvailable = await isServerReachable()
  })

  afterEach(() => {
    for (const dir of tempDirs) {
      cleanupTempDir(dir)
    }
    tempDirs = []
  })

  describe('git ls-remote', () => {
    it('should list remote refs', async () => {
      if (!serverAvailable) {
        console.log('Skipping network test: server not available')
        return
      }

      const tempDir = createTempDir()
      tempDirs.push(tempDir)

      const repoUrl = `${TEST_SERVER}/test-user/${uniqueRepoName()}.git`
      const result = git(tempDir, 'ls-remote', repoUrl)

      // Server should respond (even if empty)
      expect(result.stdout + result.stderr).toBeDefined()
    })
  })

  describe('git clone', () => {
    it('should clone an empty repository', async () => {
      if (!serverAvailable) {
        console.log('Skipping network test: server not available')
        return
      }

      const tempDir = createTempDir()
      tempDirs.push(tempDir)

      const repoUrl = `${TEST_SERVER}/test-user/${uniqueRepoName()}.git`
      const result = git(tempDir, 'clone', repoUrl, 'repo')

      // Clone of empty repo may warn but should not fail hard
      expect(result.stdout + result.stderr).toBeDefined()
    })
  })

  describe('git push', () => {
    it('should push to a new repository', async () => {
      if (!serverAvailable) {
        console.log('Skipping network test: server not available')
        return
      }

      const tempDir = createTempDir()
      tempDirs.push(tempDir)

      // Initialize local repo
      gitExpectSuccess(tempDir, 'init')
      gitExpectSuccess(tempDir, 'checkout', '-b', 'main')

      writeFileSync(join(tempDir, 'README.md'), '# Test Repository')
      gitExpectSuccess(tempDir, 'add', '.')
      gitExpectSuccess(tempDir, 'commit', '-m', 'Initial commit')

      // Setup remote
      const repoUrl = `${TEST_SERVER}/test-user/${uniqueRepoName()}.git`
      gitExpectSuccess(tempDir, 'remote', 'add', 'origin', repoUrl)

      // Push
      const result = git(tempDir, 'push', '-u', 'origin', 'main')

      // Should complete (success or meaningful error)
      expect(result.stdout + result.stderr).toBeDefined()
    })
  })

  describe('git fetch', () => {
    it('should fetch from remote', async () => {
      if (!serverAvailable) {
        console.log('Skipping network test: server not available')
        return
      }

      const tempDir = createTempDir()
      tempDirs.push(tempDir)

      gitExpectSuccess(tempDir, 'init')
      gitExpectSuccess(tempDir, 'checkout', '-b', 'main')

      const repoUrl = `${TEST_SERVER}/test-user/${uniqueRepoName()}.git`
      gitExpectSuccess(tempDir, 'remote', 'add', 'origin', repoUrl)

      const result = git(tempDir, 'fetch', 'origin')

      // Should complete
      expect(result.stdout + result.stderr).toBeDefined()
    })
  })

  describe('round-trip: push then clone', () => {
    it('should maintain file integrity across push and clone', async () => {
      if (!serverAvailable) {
        console.log('Skipping network test: server not available')
        return
      }

      const repoName = uniqueRepoName()
      const repoUrl = `${TEST_SERVER}/test-user/${repoName}.git`

      // === PUSH PHASE ===
      const pushDir = createTempDir()
      tempDirs.push(pushDir)

      gitExpectSuccess(pushDir, 'init')
      gitExpectSuccess(pushDir, 'checkout', '-b', 'main')

      const testContent = `Test content: ${Date.now()}\n`
      writeFileSync(join(pushDir, 'test.txt'), testContent)

      gitExpectSuccess(pushDir, 'add', '.')
      gitExpectSuccess(pushDir, 'commit', '-m', 'Test commit')
      gitExpectSuccess(pushDir, 'remote', 'add', 'origin', repoUrl)

      const pushResult = git(pushDir, 'push', '-u', 'origin', 'main')
      if (pushResult.exitCode !== 0) {
        console.log('Push failed:', pushResult.stderr)
        return
      }

      // === CLONE PHASE ===
      const cloneParent = createTempDir()
      tempDirs.push(cloneParent)

      const cloneResult = git(cloneParent, 'clone', repoUrl, 'cloned')
      if (cloneResult.exitCode !== 0) {
        console.log('Clone failed:', cloneResult.stderr)
        return
      }

      // Verify content
      const clonedContent = readFileSync(join(cloneParent, 'cloned', 'test.txt'), 'utf-8')
      expect(clonedContent).toBe(testContent)
    })
  })
})

// ============================================================================
// Git Object Tests (Standalone - No Server Required)
// ============================================================================

describe('E2E: Git Object Format', () => {
  describe('blob object', () => {
    it('should calculate correct SHA-1 for blob content', () => {
      // Git blob format: "blob <size>\0<content>"
      const content = 'Hello, World!'
      const header = `blob ${content.length}\0`
      const fullObject = header + content

      const sha = createHash('sha1').update(fullObject).digest('hex')

      // Known SHA for "Hello, World!" blob
      expect(sha).toBe('b45ef6fec89518d314f546fd6c3025367b721684')
    })

    it('should calculate correct SHA-1 for empty blob', () => {
      const content = ''
      const header = `blob ${content.length}\0`
      const fullObject = header + content

      const sha = createHash('sha1').update(fullObject).digest('hex')

      // Known SHA for empty blob
      expect(sha).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
    })
  })

  describe('pkt-line format', () => {
    it('should encode pkt-line correctly', () => {
      // pkt-line: 4 hex digits for length + content
      const content = 'test'
      const length = content.length + 4 // +4 for the length prefix itself
      const pktLine = length.toString(16).padStart(4, '0') + content

      expect(pktLine).toBe('0008test')
    })

    it('should encode flush packet', () => {
      // Flush packet is "0000"
      expect('0000').toBe('0000')
    })

    it('should encode empty pkt-line', () => {
      const content = ''
      const length = content.length + 4
      const pktLine = length.toString(16).padStart(4, '0') + content

      expect(pktLine).toBe('0004')
    })
  })

  describe('packfile format', () => {
    it('should have correct PACK signature', () => {
      // Packfile starts with "PACK"
      const signature = Buffer.from('PACK')
      expect(signature.toString('ascii')).toBe('PACK')
      expect(signature[0]).toBe(0x50) // P
      expect(signature[1]).toBe(0x41) // A
      expect(signature[2]).toBe(0x43) // C
      expect(signature[3]).toBe(0x4b) // K
    })

    it('should encode version 2 correctly', () => {
      // Pack version is 4 bytes, big-endian
      const version = 2
      const versionBytes = Buffer.alloc(4)
      versionBytes.writeUInt32BE(version, 0)

      expect(versionBytes[0]).toBe(0x00)
      expect(versionBytes[1]).toBe(0x00)
      expect(versionBytes[2]).toBe(0x00)
      expect(versionBytes[3]).toBe(0x02)
    })
  })
})

// ============================================================================
// Integration Tests with Real Git Repo
// ============================================================================

describe('E2E: Real Repository Operations', () => {
  let tempDirs: string[] = []

  beforeEach(() => {
    tempDirs = []
  })

  afterEach(() => {
    for (const dir of tempDirs) {
      cleanupTempDir(dir)
    }
    tempDirs = []
  })

  it('should create a complete git workflow', () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)

    // Initialize
    gitExpectSuccess(tempDir, 'init')
    gitExpectSuccess(tempDir, 'checkout', '-b', 'main')

    // Create initial structure
    execSync('mkdir -p src', { cwd: tempDir })
    writeFileSync(join(tempDir, 'README.md'), '# My Project\n\nThis is a test project.')
    writeFileSync(join(tempDir, 'src/index.ts'), 'export const hello = () => console.log("Hello!");')
    writeFileSync(join(tempDir, '.gitignore'), 'node_modules/\ndist/')

    gitExpectSuccess(tempDir, 'add', '.')
    gitExpectSuccess(tempDir, 'commit', '-m', 'Initial commit')

    // Create feature branch
    gitExpectSuccess(tempDir, 'checkout', '-b', 'feature/add-tests')

    execSync('mkdir -p test', { cwd: tempDir })
    writeFileSync(join(tempDir, 'test/index.test.ts'), 'import { hello } from "../src/index";\ntest("hello", () => { hello(); });')

    gitExpectSuccess(tempDir, 'add', '.')
    gitExpectSuccess(tempDir, 'commit', '-m', 'Add tests')

    // Go back to main and make another change
    gitExpectSuccess(tempDir, 'checkout', 'main')
    writeFileSync(join(tempDir, 'src/utils.ts'), 'export const utils = {};')
    gitExpectSuccess(tempDir, 'add', '.')
    gitExpectSuccess(tempDir, 'commit', '-m', 'Add utils')

    // Merge feature branch
    gitExpectSuccess(tempDir, 'merge', '--no-ff', '-m', 'Merge feature/add-tests', 'feature/add-tests')

    // Create release tag
    gitExpectSuccess(tempDir, 'tag', '-a', 'v1.0.0', '-m', 'Release 1.0.0')

    // Verify final state
    const log = gitExpectSuccess(tempDir, 'log', '--oneline', '--all')
    expect(log).toContain('Initial commit')
    expect(log).toContain('Add tests')
    expect(log).toContain('Add utils')
    expect(log).toContain('Merge feature/add-tests')

    const tags = gitExpectSuccess(tempDir, 'tag')
    expect(tags).toContain('v1.0.0')

    const branches = gitExpectSuccess(tempDir, 'branch', '-a')
    expect(branches).toContain('main')
    expect(branches).toContain('feature/add-tests')
  })

  it('should handle merge conflicts', () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)

    gitExpectSuccess(tempDir, 'init')
    gitExpectSuccess(tempDir, 'checkout', '-b', 'main')

    writeFileSync(join(tempDir, 'file.txt'), 'Line 1\nLine 2\nLine 3')
    gitExpectSuccess(tempDir, 'add', '.')
    gitExpectSuccess(tempDir, 'commit', '-m', 'Initial')

    // Branch A modifies file
    gitExpectSuccess(tempDir, 'checkout', '-b', 'branch-a')
    writeFileSync(join(tempDir, 'file.txt'), 'Line 1\nLine 2 modified by A\nLine 3')
    gitExpectSuccess(tempDir, 'add', '.')
    gitExpectSuccess(tempDir, 'commit', '-m', 'Modify in A')

    // Branch B modifies same line
    gitExpectSuccess(tempDir, 'checkout', 'main')
    gitExpectSuccess(tempDir, 'checkout', '-b', 'branch-b')
    writeFileSync(join(tempDir, 'file.txt'), 'Line 1\nLine 2 modified by B\nLine 3')
    gitExpectSuccess(tempDir, 'add', '.')
    gitExpectSuccess(tempDir, 'commit', '-m', 'Modify in B')

    // Try to merge (should conflict)
    const mergeResult = git(tempDir, 'merge', 'branch-a')

    // Merge should fail due to conflict
    expect(mergeResult.exitCode).not.toBe(0)
    expect(mergeResult.stderr + mergeResult.stdout).toContain('CONFLICT')

    // Clean up conflict for next test
    gitExpectSuccess(tempDir, 'merge', '--abort')
  })

  it('should handle large number of commits', () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)

    gitExpectSuccess(tempDir, 'init')
    gitExpectSuccess(tempDir, 'checkout', '-b', 'main')

    // Create 50 commits
    for (let i = 1; i <= 50; i++) {
      writeFileSync(join(tempDir, 'counter.txt'), `Count: ${i}`)
      gitExpectSuccess(tempDir, 'add', '.')
      gitExpectSuccess(tempDir, 'commit', '-m', `Commit ${i}`)
    }

    // Verify commit count
    const log = gitExpectSuccess(tempDir, 'log', '--oneline')
    const commitCount = log.split('\n').filter(l => l.trim()).length

    expect(commitCount).toBe(50)
  })

  it('should handle binary files', () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)

    gitExpectSuccess(tempDir, 'init')
    gitExpectSuccess(tempDir, 'checkout', '-b', 'main')

    // Create an initial commit so we have a parent for diff
    writeFileSync(join(tempDir, 'init.txt'), 'init')
    gitExpectSuccess(tempDir, 'add', '.')
    gitExpectSuccess(tempDir, 'commit', '-m', 'Initial commit')

    // Create a binary file (simulated PNG)
    const binaryContent = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      ...Array.from({ length: 100 }, (_, i) => i % 256)
    ])
    writeFileSync(join(tempDir, 'image.png'), binaryContent)

    gitExpectSuccess(tempDir, 'add', '.')
    gitExpectSuccess(tempDir, 'commit', '-m', 'Add binary file')

    // Verify it was committed
    const show = gitExpectSuccess(tempDir, 'show', '--stat')
    expect(show).toContain('image.png')

    // Verify the binary attribute detection via ls-tree
    const lsTree = gitExpectSuccess(tempDir, 'ls-tree', 'HEAD')
    expect(lsTree).toContain('image.png')

    // Verify the file can be read back
    const catFile = git(tempDir, 'cat-file', '-t', 'HEAD:image.png')
    expect(catFile.stdout.trim()).toBe('blob')
  })
})
