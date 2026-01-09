import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  withBash,
  hasBashCapability,
  BashModule,
  type WithBashOptions,
  type BashExecutor,
  type FsCapability,
  type BashStorage,
  type BashResult,
} from '../../src/do/withBash'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Simple base class for testing mixins.
 */
class BaseClass {
  name: string

  constructor(name: string) {
    this.name = name
  }

  greet(): string {
    return `Hello, ${this.name}!`
  }
}

/**
 * Base class with environment-like properties.
 */
class DOLikeClass {
  env: Record<string, unknown>
  state: { storage?: BashStorage }
  $?: { fs?: FsCapability }

  constructor(
    env: Record<string, unknown> = {},
    state: { storage?: BashStorage } = {},
    $?: { fs?: FsCapability }
  ) {
    this.env = env
    this.state = state
    this.$ = $
  }
}

/**
 * Create a mock executor for testing.
 */
function createMockExecutor(
  responses: Map<string, BashResult> = new Map()
): BashExecutor {
  return {
    execute: vi.fn(async (command: string): Promise<BashResult> => {
      const response = responses.get(command)
      if (response) return response
      return {
        command,
        stdout: `Executed: ${command}`,
        stderr: '',
        exitCode: 0,
      }
    }),
  }
}

/**
 * Create a mock filesystem capability.
 */
function createMockFs(): FsCapability {
  const files = new Map<string, string>()
  return {
    readFile: vi.fn(async (path: string) => files.get(path) ?? ''),
    writeFile: vi.fn(async (path: string, content: string | Buffer) => {
      files.set(path, content.toString())
    }),
    readDir: vi.fn(async () => []),
    exists: vi.fn(async (path: string) => files.has(path)),
    mkdir: vi.fn(async () => {}),
    rm: vi.fn(async () => {}),
  }
}

/**
 * Create a mock storage for testing.
 */
function createMockStorage(): BashStorage {
  const rows: unknown[] = []
  return {
    sql: {
      exec: vi.fn((_query: string, ..._params: unknown[]) => ({
        toArray: () => rows,
      })),
    },
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('withBash mixin', () => {
  describe('basic composition', () => {
    it('should extend a base class with bash capability', () => {
      const ExtendedClass = withBash(BaseClass)
      const instance = new ExtendedClass('Test')

      expect(instance).toBeInstanceOf(BaseClass)
      expect(instance.name).toBe('Test')
      expect(instance.greet()).toBe('Hello, Test!')
      expect(instance.bash).toBeInstanceOf(BashModule)
    })

    it('should work without options', () => {
      const ExtendedClass = withBash(BaseClass)
      const instance = new ExtendedClass('Test')

      expect(instance.bash).toBeInstanceOf(BashModule)
    })

    it('should preserve base class prototype chain', () => {
      class ChildClass extends BaseClass {
        age: number
        constructor(name: string, age: number) {
          super(name)
          this.age = age
        }
      }

      const ExtendedClass = withBash(ChildClass)
      const instance = new ExtendedClass('Test', 25)

      expect(instance).toBeInstanceOf(ChildClass)
      expect(instance).toBeInstanceOf(BaseClass)
      expect(instance.name).toBe('Test')
      expect(instance.age).toBe(25)
      expect(instance.bash).toBeInstanceOf(BashModule)
    })

    it('should allow multiple instances with independent bash modules', () => {
      const ExtendedClass = withBash(BaseClass)
      const instance1 = new ExtendedClass('One')
      const instance2 = new ExtendedClass('Two')

      expect(instance1.bash).not.toBe(instance2.bash)
      expect(instance1.bash).toBeInstanceOf(BashModule)
      expect(instance2.bash).toBeInstanceOf(BashModule)
    })
  })

  describe('lazy initialization', () => {
    it('should lazily create BashModule on first access', () => {
      let accessCount = 0
      const options: WithBashOptions = {
        getExecutor: () => {
          accessCount++
          return createMockExecutor()
        },
      }

      const ExtendedClass = withBash(BaseClass, options)
      const instance = new ExtendedClass('Test')

      // Factory should not be called yet
      expect(accessCount).toBe(0)

      // Access bash property
      const bash1 = instance.bash
      expect(accessCount).toBe(1)
      expect(bash1).toBeInstanceOf(BashModule)

      // Second access should return same instance, not call factory again
      const bash2 = instance.bash
      expect(accessCount).toBe(1)
      expect(bash2).toBe(bash1)
    })

    it('should resolve executor factory at first access', () => {
      const mockExecutor = createMockExecutor()
      const options: WithBashOptions = {
        getExecutor: vi.fn(() => mockExecutor),
      }

      const ExtendedClass = withBash(BaseClass, options)
      const instance = new ExtendedClass('Test')

      expect(options.getExecutor).not.toHaveBeenCalled()

      // Access bash
      instance.bash

      expect(options.getExecutor).toHaveBeenCalledTimes(1)
      expect(options.getExecutor).toHaveBeenCalledWith(instance)
    })

    it('should resolve fs factory at first access', () => {
      const mockFs = createMockFs()
      const options: WithBashOptions = {
        getFs: vi.fn(() => mockFs),
      }

      const ExtendedClass = withBash(BaseClass, options)
      const instance = new ExtendedClass('Test')

      expect(options.getFs).not.toHaveBeenCalled()

      // Access bash
      instance.bash

      expect(options.getFs).toHaveBeenCalledTimes(1)
      expect(options.getFs).toHaveBeenCalledWith(instance)
    })

    it('should resolve storage factory at first access', () => {
      const mockStorage = createMockStorage()
      const options: WithBashOptions = {
        getStorage: vi.fn(() => mockStorage),
      }

      const ExtendedClass = withBash(BaseClass, options)
      const instance = new ExtendedClass('Test')

      expect(options.getStorage).not.toHaveBeenCalled()

      // Access bash
      instance.bash

      expect(options.getStorage).toHaveBeenCalledTimes(1)
      expect(options.getStorage).toHaveBeenCalledWith(instance)
    })
  })

  describe('options configuration', () => {
    it('should pass cwd option to BashModule', () => {
      const ExtendedClass = withBash(BaseClass, { cwd: '/app' })
      const instance = new ExtendedClass('Test')

      const policy = instance.bash.getPolicy()
      expect(policy.defaultCwd).toBe('/app')
    })

    it('should pass defaultTimeout option to BashModule', () => {
      const ExtendedClass = withBash(BaseClass, { defaultTimeout: 60000 })
      const instance = new ExtendedClass('Test')

      const policy = instance.bash.getPolicy()
      expect(policy.defaultTimeout).toBe(60000)
    })

    it('should pass blockedCommands option to BashModule', () => {
      const ExtendedClass = withBash(BaseClass, {
        blockedCommands: ['rm', 'wget', 'curl'],
      })
      const instance = new ExtendedClass('Test')

      const blocked = instance.bash.getBlockedCommands()
      expect(blocked).toContain('rm')
      expect(blocked).toContain('wget')
      expect(blocked).toContain('curl')
    })

    it('should pass requireConfirmation option to BashModule', () => {
      const ExtendedClass = withBash(BaseClass, { requireConfirmation: false })
      const instance = new ExtendedClass('Test')

      const policy = instance.bash.getPolicy()
      expect(policy.requireConfirmation).toBe(false)
    })

    it('should pass useAST option to BashModule', () => {
      const ExtendedClass = withBash(BaseClass, { useAST: false })
      const instance = new ExtendedClass('Test')

      // Analyze a command - with useAST false, it should use regex
      const analysis = instance.bash.analyze('ls -la')
      expect(analysis.usedAST).toBe(false)
    })

    it('should pass policyName option to BashModule', () => {
      const ExtendedClass = withBash(BaseClass, { policyName: 'custom-policy' })
      const instance = new ExtendedClass('Test')

      const policy = instance.bash.getPolicy()
      expect(policy.name).toBe('custom-policy')
    })
  })

  describe('factory functions', () => {
    it('should access DO-like instance properties via getExecutor', () => {
      const mockExecutor = createMockExecutor()

      const options: WithBashOptions = {
        getExecutor: (instance) => {
          const doInstance = instance as DOLikeClass
          return doInstance.env.EXECUTOR as BashExecutor | undefined
        },
      }

      const ExtendedClass = withBash(DOLikeClass, options)
      const instance = new ExtendedClass({ EXECUTOR: mockExecutor })

      expect(instance.bash.hasExecutor).toBe(true)
    })

    it('should access DO-like instance $context via getFs', () => {
      const mockFs = createMockFs()

      const options: WithBashOptions = {
        getFs: (instance) => {
          const doInstance = instance as DOLikeClass
          return doInstance.$?.fs
        },
      }

      const ExtendedClass = withBash(DOLikeClass, options)
      const instance = new ExtendedClass({}, {}, { fs: mockFs })

      expect(instance.bash.hasFsCapability).toBe(true)
    })

    it('should access DO-like instance state via getStorage', () => {
      const mockStorage = createMockStorage()

      const options: WithBashOptions = {
        getStorage: (instance) => {
          const doInstance = instance as DOLikeClass
          return doInstance.state.storage
        },
      }

      const ExtendedClass = withBash(DOLikeClass, options)
      const instance = new ExtendedClass({}, { storage: mockStorage })

      expect(instance.bash.hasStorage()).toBe(true)
    })

    it('should handle undefined returns from factory functions', () => {
      const options: WithBashOptions = {
        getExecutor: () => undefined,
        getFs: () => undefined,
        getStorage: () => undefined,
      }

      const ExtendedClass = withBash(BaseClass, options)
      const instance = new ExtendedClass('Test')

      expect(instance.bash.hasExecutor).toBe(false)
      expect(instance.bash.hasFsCapability).toBe(false)
      expect(instance.bash.hasStorage()).toBe(false)
    })
  })

  describe('initializeBash method', () => {
    it('should be available on extended class instances', () => {
      const ExtendedClass = withBash(BaseClass)
      const instance = new ExtendedClass('Test')

      expect(typeof (instance as any).initializeBash).toBe('function')
    })

    it('should call BashModule.initialize when storage is available', async () => {
      const mockStorage = createMockStorage()
      const options: WithBashOptions = {
        getStorage: () => mockStorage,
      }

      const ExtendedClass = withBash(BaseClass, options)
      const instance = new ExtendedClass('Test')

      // Should not throw
      await (instance as any).initializeBash()
    })

    it('should be idempotent', async () => {
      const mockStorage = createMockStorage()
      let initCount = 0
      const options: WithBashOptions = {
        getStorage: () => {
          initCount++
          return mockStorage
        },
      }

      const ExtendedClass = withBash(BaseClass, options)
      const instance = new ExtendedClass('Test')

      await (instance as any).initializeBash()
      await (instance as any).initializeBash()
      await (instance as any).initializeBash()

      // getStorage is called once during first bash access, not on each initializeBash
      expect(initCount).toBe(1)
    })
  })

  describe('bash module functionality', () => {
    it('should analyze commands', () => {
      const ExtendedClass = withBash(BaseClass)
      const instance = new ExtendedClass('Test')

      const analysis = instance.bash.analyze('ls -la')
      expect(analysis.dangerous).toBe(false)
      expect(analysis.commands).toContain('ls')
    })

    it('should detect dangerous commands', () => {
      const ExtendedClass = withBash(BaseClass)
      const instance = new ExtendedClass('Test')

      const analysis = instance.bash.analyze('rm -rf /')
      expect(analysis.dangerous).toBe(true)
      expect(analysis.impact).toBe('critical')
    })

    it('should block configured commands', () => {
      const ExtendedClass = withBash(BaseClass, {
        blockedCommands: ['danger'],
      })
      const instance = new ExtendedClass('Test')

      const analysis = instance.bash.analyze('danger --flag')
      expect(analysis.dangerous).toBe(true)
      expect(analysis.reason).toContain('blocked')
    })

    it('should execute commands with configured executor', async () => {
      const mockExecutor = createMockExecutor(
        new Map([
          [
            'echo hello',
            {
              command: 'echo hello',
              stdout: 'hello\n',
              stderr: '',
              exitCode: 0,
            },
          ],
        ])
      )

      const ExtendedClass = withBash(BaseClass, {
        getExecutor: () => mockExecutor,
      })
      const instance = new ExtendedClass('Test')

      const result = await instance.bash.exec('echo', ['hello'])
      expect(result.stdout).toBe('hello\n')
      expect(result.exitCode).toBe(0)
    })

    it('should return error when no executor configured', async () => {
      const ExtendedClass = withBash(BaseClass)
      const instance = new ExtendedClass('Test')

      const result = await instance.bash.exec('ls', ['-la'])
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No executor configured')
    })

    it('should support dry-run mode', async () => {
      const ExtendedClass = withBash(BaseClass)
      const instance = new ExtendedClass('Test')

      const result = await instance.bash.exec('ls', ['-la'], {
        dryRun: true,
      })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[dry-run]')
    })

    it('should run scripts via run method', async () => {
      const mockExecutor = createMockExecutor()
      const ExtendedClass = withBash(BaseClass, {
        getExecutor: () => mockExecutor,
      })
      const instance = new ExtendedClass('Test')

      const script = `
        set -e
        echo "Building..."
        npm run build
      `

      const result = await instance.bash.run(script)
      expect(result.exitCode).toBe(0)
    })
  })

  describe('mixin chaining', () => {
    it('should work when chained with other mixins', () => {
      // Simulated withGit mixin
      function withGit<T extends new (...args: any[]) => any>(
        Base: T,
        options: { repo: string }
      ) {
        return class extends Base {
          git = { repo: options.repo }
        }
      }

      const ExtendedClass = withBash(withGit(BaseClass, { repo: 'org/repo' }))
      const instance = new ExtendedClass('Test')

      expect(instance.name).toBe('Test')
      expect((instance as any).git.repo).toBe('org/repo')
      expect(instance.bash).toBeInstanceOf(BashModule)
    })

    it('should work when applied before other mixins', () => {
      function withLogger<T extends new (...args: any[]) => any>(Base: T) {
        return class extends Base {
          logs: string[] = []
          log(msg: string) {
            this.logs.push(msg)
          }
        }
      }

      const ExtendedClass = withLogger(withBash(BaseClass))
      const instance = new ExtendedClass('Test')

      expect(instance.bash).toBeInstanceOf(BashModule)
      expect(instance.logs).toEqual([])
      instance.log('test')
      expect(instance.logs).toEqual(['test'])
    })
  })
})

describe('hasBashCapability', () => {
  it('should return true for instances with bash capability', () => {
    const ExtendedClass = withBash(BaseClass)
    const instance = new ExtendedClass('Test')

    expect(hasBashCapability(instance)).toBe(true)
  })

  it('should return false for plain objects', () => {
    expect(hasBashCapability({})).toBe(false)
  })

  it('should return false for null', () => {
    expect(hasBashCapability(null)).toBe(false)
  })

  it('should return false for undefined', () => {
    expect(hasBashCapability(undefined)).toBe(false)
  })

  it('should return false for objects with bash property that is not BashModule', () => {
    const obj = { bash: { exec: () => {} } }
    expect(hasBashCapability(obj)).toBe(false)
  })

  it('should return true for objects with actual BashModule instance', () => {
    const obj = { bash: new BashModule() }
    expect(hasBashCapability(obj)).toBe(true)
  })

  it('should work with type narrowing', () => {
    const ExtendedClass = withBash(BaseClass)
    const instance: unknown = new ExtendedClass('Test')

    if (hasBashCapability(instance)) {
      // TypeScript should recognize instance.bash exists
      expect(instance.bash.analyze('ls').dangerous).toBe(false)
    } else {
      // Should not reach here
      expect(true).toBe(false)
    }
  })
})

describe('edge cases', () => {
  it('should handle class with no constructor', () => {
    class NoConstructorClass {}

    const ExtendedClass = withBash(NoConstructorClass)
    const instance = new ExtendedClass()

    expect(instance.bash).toBeInstanceOf(BashModule)
  })

  it('should handle class with complex constructor', () => {
    class ComplexClass {
      a: string
      b: number
      c: boolean
      d: object

      constructor(a: string, b: number, c: boolean, d: object) {
        this.a = a
        this.b = b
        this.c = c
        this.d = d
      }
    }

    const ExtendedClass = withBash(ComplexClass)
    const instance = new ExtendedClass('test', 42, true, { key: 'value' })

    expect(instance.a).toBe('test')
    expect(instance.b).toBe(42)
    expect(instance.c).toBe(true)
    expect(instance.d).toEqual({ key: 'value' })
    expect(instance.bash).toBeInstanceOf(BashModule)
  })

  it('should handle async factory functions', async () => {
    // Note: Factory functions are synchronous, but we can test
    // that the values they return are used correctly
    const mockExecutor = createMockExecutor()
    let resolved = false

    const options: WithBashOptions = {
      getExecutor: () => {
        resolved = true
        return mockExecutor
      },
    }

    const ExtendedClass = withBash(BaseClass, options)
    const instance = new ExtendedClass('Test')

    expect(resolved).toBe(false)
    instance.bash // Trigger lazy init
    expect(resolved).toBe(true)
  })

  it('should handle empty options object', () => {
    const ExtendedClass = withBash(BaseClass, {})
    const instance = new ExtendedClass('Test')

    expect(instance.bash).toBeInstanceOf(BashModule)
    const policy = instance.bash.getPolicy()
    expect(policy.defaultCwd).toBe('/')
    expect(policy.defaultTimeout).toBe(30000)
    expect(policy.requireConfirmation).toBe(true)
  })

  it('should handle all options combined', () => {
    const mockExecutor = createMockExecutor()
    const mockFs = createMockFs()
    const mockStorage = createMockStorage()

    const options: WithBashOptions = {
      cwd: '/workspace',
      defaultTimeout: 120000,
      blockedCommands: ['danger1', 'danger2'],
      requireConfirmation: false,
      useAST: true,
      policyName: 'full-options-test',
      getExecutor: () => mockExecutor,
      getFs: () => mockFs,
      getStorage: () => mockStorage,
    }

    const ExtendedClass = withBash(BaseClass, options)
    const instance = new ExtendedClass('Test')

    const policy = instance.bash.getPolicy()
    expect(policy.name).toBe('full-options-test')
    expect(policy.defaultCwd).toBe('/workspace')
    expect(policy.defaultTimeout).toBe(120000)
    expect(policy.requireConfirmation).toBe(false)
    expect(policy.blockedCommands).toContain('danger1')
    expect(policy.blockedCommands).toContain('danger2')
    expect(instance.bash.hasExecutor).toBe(true)
    expect(instance.bash.hasFsCapability).toBe(true)
    expect(instance.bash.hasStorage()).toBe(true)
  })
})
