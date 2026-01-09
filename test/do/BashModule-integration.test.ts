/**
 * @fileoverview Integration Tests for BashModule with DO Context
 *
 * These tests verify the comprehensive integration of BashModule with
 * dotdo's Durable Object framework, including:
 *
 * - DO context integration ($.bash pattern)
 * - Lifecycle management (initialization, lazy loading, disposal)
 * - withBash mixin composition patterns
 * - Error handling across integration points
 * - Multi-module integration scenarios
 *
 * @module test/do/BashModule-integration
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  BashModule,
  createBashModule,
  createCallableBashModule,
  isBashModule,
  type BashModuleOptions,
  type BashResult,
  type BashExecutor,
  type FsCapability,
  type ExecOptions,
  type SpawnHandle,
  type SpawnOptions,
  type BashStorage,
} from '../../src/do/BashModule'
import {
  withBash,
  hasBashCapability,
  type WithBashOptions,
} from '../../src/do/withBash'

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

  _getFiles(): Map<string, string | Buffer> {
    return new Map(this.files)
  }
}

/**
 * Mock BashExecutor for testing command execution
 */
class MockBashExecutor implements BashExecutor {
  public executedCommands: string[] = []
  public lastCommand: string | null = null
  public lastOptions: ExecOptions | undefined = undefined
  public mockResults: Map<string, BashResult> = new Map()
  public defaultResult: BashResult = {
    command: '',
    stdout: 'mock output',
    stderr: '',
    exitCode: 0,
  }
  public shouldThrow = false
  public throwError: Error | null = null

  async execute(command: string, options?: ExecOptions): Promise<BashResult> {
    this.executedCommands.push(command)
    this.lastCommand = command
    this.lastOptions = options

    if (this.shouldThrow) {
      throw this.throwError ?? new Error('Mock execution error')
    }

    const customResult = this.mockResults.get(command)
    if (customResult) {
      return { ...customResult, command }
    }

    return {
      ...this.defaultResult,
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
    this.executedCommands = []
    this.lastCommand = null
    this.lastOptions = undefined
    this.shouldThrow = false
    this.throwError = null
    this.mockResults.clear()
    this.defaultResult = {
      command: '',
      stdout: 'mock output',
      stderr: '',
      exitCode: 0,
    }
  }

  _setResult(command: string, result: Partial<BashResult>): void {
    this.mockResults.set(command, {
      command,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? 0,
      blocked: result.blocked,
      blockReason: result.blockReason,
    })
  }
}

/**
 * Mock BashStorage for testing database integration
 */
class MockBashStorage implements BashStorage {
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
// Mock DO Context ($.bash Pattern)
// ============================================================================

/**
 * Mock WorkflowContext $ for simulating dotdo's DO context
 */
interface MockWorkflowContext {
  bash?: BashModule
  fs?: FsCapability
  send: (event: string, data: unknown) => void
  do: <T>(action: string, data?: unknown) => Promise<T>
}

/**
 * Mock Durable Object class for testing integration
 */
class MockDurableObject {
  protected state: { storage?: BashStorage }
  protected env: Record<string, unknown>
  protected $: MockWorkflowContext

  constructor(
    state: { storage?: BashStorage } = {},
    env: Record<string, unknown> = {}
  ) {
    this.state = state
    this.env = env
    this.$ = {
      send: vi.fn(),
      do: vi.fn().mockResolvedValue(undefined),
    }
  }
}

// ============================================================================
// Integration Test Suites
// ============================================================================

describe('BashModule DO Context Integration', () => {
  let mockExecutor: MockBashExecutor
  let mockFs: MockFsCapability
  let mockStorage: MockBashStorage

  beforeEach(() => {
    mockExecutor = new MockBashExecutor()
    mockFs = new MockFsCapability()
    mockStorage = new MockBashStorage()
  })

  afterEach(() => {
    mockExecutor._reset()
    mockFs._clear()
    mockStorage._reset()
  })

  describe('$.bash Context Pattern', () => {
    it('should integrate BashModule as $.bash in DO context', () => {
      class TestDO extends MockDurableObject {
        constructor() {
          super()
          this.$.bash = new BashModule({
            executor: mockExecutor,
            fs: mockFs,
          })
        }

        async runCommand() {
          return this.$.bash!.exec('ls', ['-la'])
        }
      }

      const durable = new TestDO()
      expect(durable.$.bash).toBeInstanceOf(BashModule)
    })

    it('should execute commands through $.bash context', async () => {
      class TestDO extends MockDurableObject {
        constructor() {
          super()
          this.$.bash = new BashModule({
            executor: mockExecutor,
            fs: mockFs,
            cwd: '/workspace',
          })
        }

        async build() {
          return this.$.bash!.run(`
            set -e
            npm install
            npm run build
          `)
        }
      }

      const durable = new TestDO()
      const result = await durable.build()

      expect(result.exitCode).toBe(0)
      expect(mockExecutor.executedCommands.length).toBe(1)
    })

    it('should use $.fs for file system operations when configured', async () => {
      mockFs._setFile('/workspace/test.txt', 'test content')

      class TestDO extends MockDurableObject {
        constructor() {
          super()
          this.$.fs = mockFs
          this.$.bash = new BashModule({
            executor: mockExecutor,
            fs: this.$.fs,
            cwd: '/workspace',
          })
        }

        async checkFile() {
          return this.$.fs!.exists('/workspace/test.txt')
        }
      }

      const durable = new TestDO()
      expect(await durable.checkFile()).toBe(true)
      expect(durable.$.bash!.hasFsCapability).toBe(true)
    })

    it('should share context between $.bash and $.fs', async () => {
      class TestDO extends MockDurableObject {
        constructor() {
          super()
          this.$.fs = mockFs
          this.$.bash = new BashModule({
            executor: mockExecutor,
            fs: this.$.fs,
            cwd: '/app',
          })
        }

        async setupAndRun() {
          // Create directory using fs
          await this.$.fs!.mkdir('/app/src', { recursive: true })

          // Run command using bash
          const result = await this.$.bash!.exec('npm', ['init', '-y'])

          return result
        }
      }

      const durable = new TestDO()
      const result = await durable.setupAndRun()

      expect(result.exitCode).toBe(0)
      expect(await mockFs.exists('/app/src')).toBe(true)
    })
  })

  describe('Lifecycle Management', () => {
    it('should support lazy initialization of BashModule', () => {
      let initCount = 0

      class TestDO extends MockDurableObject {
        private _bash?: BashModule

        get bash(): BashModule {
          if (!this._bash) {
            initCount++
            this._bash = new BashModule({
              executor: mockExecutor,
            })
          }
          return this._bash
        }
      }

      const durable = new TestDO()
      expect(initCount).toBe(0)

      // First access initializes
      durable.bash
      expect(initCount).toBe(1)

      // Subsequent access returns same instance
      durable.bash
      expect(initCount).toBe(1)
    })

    it('should call initialize() to load database settings', async () => {
      // Pre-populate database with policy
      mockStorage.sql.exec(
        `INSERT INTO exec (name, blocked_commands, require_confirmation, default_timeout, default_cwd, allowed_patterns, denied_patterns, max_concurrent, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        'test-policy',
        JSON.stringify(['wget', 'curl']),
        0,
        60000,
        '/app',
        null,
        null,
        5,
        1,
        Date.now(),
        Date.now()
      )

      const bash = new BashModule({
        executor: mockExecutor,
        storage: mockStorage,
        policyName: 'test-policy',
      })

      // Before initialization, should use defaults
      expect(bash.getPolicy().blockedCommands).toEqual([])

      // Initialize loads from database
      await bash.initialize()

      const policy = bash.getPolicy()
      expect(policy.blockedCommands).toContain('wget')
      expect(policy.blockedCommands).toContain('curl')
      expect(policy.requireConfirmation).toBe(false)
      expect(policy.defaultTimeout).toBe(60000)
    })

    it('should persist policy changes to database', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
        storage: mockStorage,
        policyName: 'persist-test',
      })

      await bash.initialize()

      // Modify policy
      await bash.updatePolicy({
        blockedCommands: ['danger1', 'danger2'],
        requireConfirmation: true,
        defaultTimeout: 120000,
      })

      // Check database was updated
      const execTable = mockStorage._getExecTable() as Record<string, unknown>[]
      expect(execTable.length).toBe(1)

      const blockedCommands = JSON.parse(execTable[0].blocked_commands as string)
      expect(blockedCommands).toContain('danger1')
      expect(blockedCommands).toContain('danger2')
    })

    it('should handle dispose() gracefully', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
      })

      await bash.initialize()

      // Dispose should not throw
      await expect(bash.dispose()).resolves.toBeUndefined()
    })

    it('should be safe to initialize multiple times', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
        storage: mockStorage,
        policyName: 'multi-init',
      })

      await bash.initialize()
      await bash.initialize()
      await bash.initialize()

      // Should only create one policy in database
      const execTable = mockStorage._getExecTable()
      expect(execTable.length).toBe(1)
    })
  })

  describe('Command Execution Through DO Context', () => {
    it('should execute commands with proper cwd from DO context', async () => {
      class TestDO extends MockDurableObject {
        bash = new BashModule({
          executor: mockExecutor,
          cwd: '/workspace',
        })
      }

      const durable = new TestDO()
      await durable.bash.exec('ls', ['-la'])

      expect(mockExecutor.lastOptions?.cwd).toBe('/workspace')
    })

    it('should allow overriding cwd per command', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
        cwd: '/default',
      })

      await bash.exec('ls', [], { cwd: '/override' })

      expect(mockExecutor.lastOptions?.cwd).toBe('/override')
    })

    it('should handle command execution errors in DO context', async () => {
      mockExecutor.shouldThrow = true
      mockExecutor.throwError = new Error('Container connection lost')

      const bash = new BashModule({
        executor: mockExecutor,
      })

      const result = await bash.exec('ls')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Container connection lost')
    })

    it('should track multiple command executions', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
      })

      await bash.exec('cd', ['/app'])
      await bash.exec('npm', ['install'])
      await bash.exec('npm', ['run', 'build'])
      await bash.exec('npm', ['test'])

      expect(mockExecutor.executedCommands).toHaveLength(4)
      expect(mockExecutor.executedCommands).toEqual([
        'cd /app',
        'npm install',
        'npm run build',
        'npm test',
      ])
    })
  })

  describe('Safety Analysis in DO Context', () => {
    it('should block dangerous commands even in DO context', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
        requireConfirmation: true,
      })

      const result = await bash.exec('rm', ['-rf', '/'])

      expect(result.blocked).toBe(true)
      expect(result.exitCode).toBe(1)
      expect(mockExecutor.lastCommand).toBeNull() // Not executed
    })

    it('should allow confirmed dangerous commands', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
        requireConfirmation: true,
      })

      const result = await bash.exec('rm', ['-rf', '/tmp/cache'], { confirm: true })

      expect(result.blocked).toBeUndefined()
      expect(result.exitCode).toBe(0)
    })

    it('should always block critical commands regardless of confirmation', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
        requireConfirmation: false, // Even with confirmation disabled
      })

      const result = await bash.run('rm -rf /', { confirm: true })

      expect(result.blocked).toBe(true)
      expect(result.exitCode).toBe(1)
    })

    it('should use AST analysis by default', () => {
      const bash = new BashModule({
        executor: mockExecutor,
      })

      const analysis = bash.analyze('git status && npm install')

      expect(analysis.usedAST).toBe(true)
      expect(analysis.commands).toContain('git')
      expect(analysis.commands).toContain('npm')
    })

    it('should support regex analysis when AST is disabled', () => {
      const bash = new BashModule({
        executor: mockExecutor,
        useAST: false,
      })

      const analysis = bash.analyze('ls -la')

      expect(analysis.usedAST).toBe(false)
    })
  })

  describe('withBash Mixin Composition Patterns', () => {
    it('should compose with base DO class', () => {
      const BashDO = withBash(MockDurableObject, {
        cwd: '/app',
        blockedCommands: ['wget'],
        getExecutor: () => mockExecutor,
      })

      const durable = new BashDO()

      expect(durable.bash).toBeInstanceOf(BashModule)
      expect(durable.bash.getPolicy().defaultCwd).toBe('/app')
      expect(durable.bash.getBlockedCommands()).toContain('wget')
    })

    it('should lazily resolve executor from DO instance', () => {
      let executorResolved = false

      const BashDO = withBash(MockDurableObject, {
        getExecutor: (instance) => {
          executorResolved = true
          const durable = instance as MockDurableObject
          return (durable as unknown as { env: { EXECUTOR?: BashExecutor } }).env.EXECUTOR
        },
      })

      class TestDO extends BashDO {
        constructor() {
          super()
          ;(this as unknown as { env: { EXECUTOR: BashExecutor } }).env = { EXECUTOR: mockExecutor }
        }
      }

      const durable = new TestDO()

      expect(executorResolved).toBe(false)
      durable.bash // Access triggers lazy resolution
      expect(executorResolved).toBe(true)
    })

    it('should support chaining multiple mixins', () => {
      // Simple mock withGit mixin
      function withGit<T extends new (...args: unknown[]) => object>(
        Base: T,
        options: { repo: string }
      ) {
        return class extends Base {
          git = { repo: options.repo, sync: vi.fn() }
        }
      }

      const FullDO = withBash(
        withGit(MockDurableObject, { repo: 'org/repo' }),
        { cwd: '/workspace' }
      )

      const durable = new FullDO()

      expect(durable.bash).toBeInstanceOf(BashModule)
      expect((durable as { git: { repo: string } }).git.repo).toBe('org/repo')
    })

    it('should support initializeBash for async initialization', async () => {
      const BashDO = withBash(MockDurableObject, {
        getStorage: () => mockStorage,
        policyName: 'init-test',
      })

      const durable = new BashDO()

      // Initialize should not throw
      await (durable as { initializeBash: () => Promise<void> }).initializeBash()

      // Should have created policy in database
      expect(mockStorage._getExecTable().length).toBe(1)
    })

    it('should work with hasBashCapability type guard', () => {
      const BashDO = withBash(MockDurableObject)
      const durable = new BashDO()

      expect(hasBashCapability(durable)).toBe(true)

      const plainObject = {}
      expect(hasBashCapability(plainObject)).toBe(false)
    })
  })

  describe('Multi-Module Integration', () => {
    it('should integrate with FsModule for file-based operations', async () => {
      // Setup file system
      mockFs._setFile('/workspace/script.sh', '#!/bin/bash\necho "Hello"')

      const bash = new BashModule({
        executor: mockExecutor,
        fs: mockFs,
        cwd: '/workspace',
      })

      expect(bash.hasFsCapability).toBe(true)

      // Executor would read script from fs in real implementation
      const result = await bash.run('bash script.sh')
      expect(result.exitCode).toBe(0)
    })

    it('should share environment between modules', async () => {
      const sharedEnv = {
        NODE_ENV: 'production',
        PATH: '/usr/bin',
      }

      const bash = new BashModule({
        executor: mockExecutor,
        cwd: '/app',
      })

      await bash.exec('echo', ['$NODE_ENV'], { env: sharedEnv })

      expect(mockExecutor.lastOptions?.env).toEqual(sharedEnv)
    })
  })

  describe('Error Handling Integration', () => {
    it('should handle missing executor gracefully', async () => {
      const bash = new BashModule({
        fs: mockFs,
        cwd: '/app',
      })

      const result = await bash.exec('ls')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No executor configured')
    })

    it('should handle executor errors without crashing', async () => {
      mockExecutor.shouldThrow = true
      mockExecutor.throwError = new Error('Network timeout')

      const bash = new BashModule({
        executor: mockExecutor,
      })

      const result = await bash.exec('ls')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Network timeout')
    })

    it('should handle malformed commands gracefully', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
      })

      // Even malformed input should be handled
      const result = await bash.run('')

      expect(result.exitCode).toBe(0) // Empty command is valid
    })

    it('should continue working after errors', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
      })

      // First command fails
      mockExecutor.shouldThrow = true
      const result1 = await bash.exec('failing-command')
      expect(result1.exitCode).toBe(1)

      // Second command succeeds
      mockExecutor.shouldThrow = false
      const result2 = await bash.exec('working-command')
      expect(result2.exitCode).toBe(0)
    })
  })

  describe('Callable BashModule Integration', () => {
    it('should work as callable in DO context', async () => {
      const bash = createCallableBashModule({
        executor: mockExecutor,
        requireConfirmation: false,
      })

      class TestDO extends MockDurableObject {
        bash = bash
      }

      const durable = new TestDO()

      // Use as template literal
      const dir = '/tmp'
      const result = await durable.bash`ls -la ${dir}`

      expect(result.exitCode).toBe(0)
      expect(mockExecutor.lastCommand).toBe('ls -la /tmp')
    })

    it('should escape interpolated values safely', async () => {
      const bash = createCallableBashModule({
        executor: mockExecutor,
        requireConfirmation: false,
      })

      const userInput = 'file; rm -rf /'
      const result = await bash`cat ${userInput}`

      expect(result.exitCode).toBe(0)
      // User input should be escaped
      expect(mockExecutor.lastCommand).toBe("cat 'file; rm -rf /'")
    })

    it('should work with both template and method syntax', async () => {
      const bash = createCallableBashModule({
        executor: mockExecutor,
        requireConfirmation: false,
      })

      // Template syntax
      await bash`echo hello`

      // Method syntax
      await bash.exec('echo', ['world'])

      expect(mockExecutor.executedCommands).toHaveLength(2)
    })
  })

  describe('Concurrent Execution', () => {
    it('should handle concurrent command execution', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
      })

      // Execute multiple commands concurrently
      const results = await Promise.all([
        bash.exec('command1'),
        bash.exec('command2'),
        bash.exec('command3'),
        bash.exec('command4'),
        bash.exec('command5'),
      ])

      expect(results).toHaveLength(5)
      expect(results.every(r => r.exitCode === 0)).toBe(true)
      expect(mockExecutor.executedCommands).toHaveLength(5)
    })

    it('should maintain isolation between concurrent executions', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
      })

      mockExecutor._setResult('fast', { stdout: 'fast', exitCode: 0 })
      mockExecutor._setResult('slow', { stdout: 'slow', exitCode: 0 })

      const [fast, slow] = await Promise.all([
        bash.exec('fast'),
        bash.exec('slow'),
      ])

      expect(fast.stdout).toBe('fast')
      expect(slow.stdout).toBe('slow')
    })
  })

  describe('Session and Policy Management', () => {
    it('should persist blocked commands dynamically', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
        storage: mockStorage,
        policyName: 'dynamic-blocks',
      })

      await bash.initialize()

      // Dynamically block a command
      bash.block('new-danger')

      // Wait for async persistence
      await new Promise(resolve => setTimeout(resolve, 10))

      const execTable = mockStorage._getExecTable() as Record<string, unknown>[]
      const blockedCommands = JSON.parse(execTable[0].blocked_commands as string)
      expect(blockedCommands).toContain('new-danger')
    })

    it('should persist unblocked commands dynamically', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
        storage: mockStorage,
        policyName: 'dynamic-unblocks',
        blockedCommands: ['cmd1', 'cmd2', 'cmd3'],
      })

      await bash.initialize()

      // Unblock a command
      bash.unblock('cmd2')

      // Wait for async persistence
      await new Promise(resolve => setTimeout(resolve, 10))

      const execTable = mockStorage._getExecTable() as Record<string, unknown>[]
      const blockedCommands = JSON.parse(execTable[0].blocked_commands as string)
      expect(blockedCommands).not.toContain('cmd2')
      expect(blockedCommands).toContain('cmd1')
      expect(blockedCommands).toContain('cmd3')
    })

    it('should support enabling/disabling policy', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
        storage: mockStorage,
        policyName: 'enable-test',
      })

      await bash.initialize()
      expect(bash.isEnabled()).toBe(true)

      await bash.updatePolicy({ enabled: false })
      expect(bash.isEnabled()).toBe(false)
    })

    it('should support max concurrent setting', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
        storage: mockStorage,
        policyName: 'concurrent-test',
      })

      await bash.initialize()

      await bash.updatePolicy({ maxConcurrent: 10 })

      const policy = bash.getPolicy()
      expect(policy.maxConcurrent).toBe(10)
    })
  })
})

describe('BashModule Edge Cases', () => {
  let mockExecutor: MockBashExecutor

  beforeEach(() => {
    mockExecutor = new MockBashExecutor()
  })

  afterEach(() => {
    mockExecutor._reset()
  })

  describe('Empty and null handling', () => {
    it('should handle empty command', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
      })

      const result = await bash.exec('')
      expect(result).toBeDefined()
    })

    it('should handle empty args array', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
      })

      const result = await bash.exec('ls', [])
      expect(result.exitCode).toBe(0)
      expect(mockExecutor.lastCommand).toBe('ls')
    })

    it('should handle undefined args', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
      })

      const result = await bash.exec('pwd')
      expect(result.exitCode).toBe(0)
      expect(mockExecutor.lastCommand).toBe('pwd')
    })
  })

  describe('Special characters in commands', () => {
    it('should handle arguments with spaces', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
      })

      await bash.exec('echo', ['hello world'])
      expect(mockExecutor.lastCommand).toBe("echo 'hello world'")
    })

    it('should handle arguments with quotes', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
      })

      await bash.exec('echo', ["it's", 'a "test"'])
      expect(mockExecutor.lastCommand).toBe("echo 'it'\\''s' 'a \"test\"'")
    })

    it('should handle arguments with special shell characters', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
      })

      await bash.exec('echo', ['$HOME', '$(whoami)', '`date`'])

      // All should be escaped
      expect(mockExecutor.lastCommand).toContain("'$HOME'")
      expect(mockExecutor.lastCommand).toContain("'$(whoami)'")
      expect(mockExecutor.lastCommand).toContain("'`date`'")
    })
  })

  describe('Module name and identification', () => {
    it('should have correct module name', () => {
      const bash = new BashModule()
      expect(bash.name).toBe('bash')
    })

    it('should be identifiable via isBashModule', () => {
      const bash = new BashModule()

      expect(isBashModule(bash)).toBe(true)
      expect(isBashModule({})).toBe(false)
      expect(isBashModule(null)).toBe(false)
    })
  })

  describe('Dry-run mode', () => {
    it('should not execute in dry-run mode', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
      })

      const result = await bash.exec('dangerous-command', [], { dryRun: true })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[dry-run]')
      expect(mockExecutor.lastCommand).toBeNull()
    })

    it('should still block critical commands in dry-run mode', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
      })

      const result = await bash.run('rm -rf /', { dryRun: true })

      expect(result.blocked).toBe(true)
      expect(result.exitCode).toBe(1)
    })
  })

  describe('Timeout handling', () => {
    it('should pass timeout to executor', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
        defaultTimeout: 30000,
      })

      await bash.exec('slow-command', [], { timeout: 60000 })

      expect(mockExecutor.lastOptions?.timeout).toBe(60000)
    })

    it('should use default timeout when not specified', async () => {
      const bash = new BashModule({
        executor: mockExecutor,
        defaultTimeout: 45000,
      })

      await bash.exec('command')

      expect(mockExecutor.lastOptions?.timeout).toBe(45000)
    })
  })
})
