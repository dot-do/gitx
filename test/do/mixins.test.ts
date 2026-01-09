/**
 * @fileoverview Tests for DO Mixin Functions
 *
 * Tests the withGit and withBash mixin functions that compose
 * module functionality into Durable Object classes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  withBash,
  withGit,
  type WithBashCapability,
  type WithBashOptions,
  type WithGitCapability,
  type WithGitOptions,
  type Constructor,
} from '../../src/do/index'
import { BashModule } from '../../src/do/BashModule'
import { GitModule } from '../../src/do/GitModule'

// ============================================================================
// Mock Base Classes
// ============================================================================

/**
 * Simple base class to simulate a DO
 */
class BaseDO {
  public readonly id: string
  public readonly env: Record<string, unknown>

  constructor(id?: string, env?: Record<string, unknown>) {
    this.id = id ?? 'test-do'
    this.env = env ?? {}
  }

  async fetch(_request: Request): Promise<Response> {
    return new Response('OK')
  }
}

/**
 * Extended base class with additional functionality
 */
class ExtendedDO extends BaseDO {
  public readonly name: string

  constructor(id?: string, env?: Record<string, unknown>, name?: string) {
    super(id, env)
    this.name = name ?? 'ExtendedDO'
  }

  greet(): string {
    return `Hello from ${this.name}`
  }
}

// ============================================================================
// withBash Mixin Tests
// ============================================================================

describe('withBash mixin', () => {
  describe('basic functionality', () => {
    it('should add bash property to class', () => {
      const DOWithBash = withBash(BaseDO)
      const instance = new DOWithBash()

      expect(instance.bash).toBeDefined()
      expect(instance.bash).toBeInstanceOf(BashModule)
    })

    it('should preserve base class properties', () => {
      const DOWithBash = withBash(BaseDO)
      const instance = new DOWithBash('my-id', { key: 'value' })

      expect(instance.id).toBe('my-id')
      expect(instance.env).toEqual({ key: 'value' })
    })

    it('should preserve base class methods', async () => {
      const DOWithBash = withBash(BaseDO)
      const instance = new DOWithBash()

      const response = await instance.fetch(new Request('https://example.com'))
      expect(response).toBeInstanceOf(Response)
      expect(await response.text()).toBe('OK')
    })

    it('should work without options', () => {
      const DOWithBash = withBash(BaseDO)
      const instance = new DOWithBash()

      expect(instance.bash).toBeInstanceOf(BashModule)
      expect(instance.bash.name).toBe('bash')
    })
  })

  describe('with options', () => {
    it('should pass cwd option to BashModule', () => {
      const DOWithBash = withBash(BaseDO, { cwd: '/custom/path' })
      const instance = new DOWithBash()

      expect(instance.bash).toBeInstanceOf(BashModule)
      // We can verify by checking exec behavior with cwd
    })

    it('should pass defaultTimeout option to BashModule', () => {
      const DOWithBash = withBash(BaseDO, { defaultTimeout: 60000 })
      const instance = new DOWithBash()

      expect(instance.bash).toBeInstanceOf(BashModule)
    })

    it('should pass blockedCommands option to BashModule', () => {
      const DOWithBash = withBash(BaseDO, {
        blockedCommands: ['rm', 'wget', 'curl'],
      })
      const instance = new DOWithBash()

      expect(instance.bash.getBlockedCommands()).toContain('rm')
      expect(instance.bash.getBlockedCommands()).toContain('wget')
      expect(instance.bash.getBlockedCommands()).toContain('curl')
    })

    it('should pass requireConfirmation option to BashModule', () => {
      const DOWithBash = withBash(BaseDO, { requireConfirmation: false })
      const instance = new DOWithBash()

      expect(instance.bash).toBeInstanceOf(BashModule)
    })

    it('should handle all options together', () => {
      const DOWithBash = withBash(BaseDO, {
        cwd: '/app',
        defaultTimeout: 120000,
        blockedCommands: ['shutdown', 'reboot'],
        requireConfirmation: true,
      })
      const instance = new DOWithBash()

      expect(instance.bash).toBeInstanceOf(BashModule)
      expect(instance.bash.getBlockedCommands()).toContain('shutdown')
      expect(instance.bash.getBlockedCommands()).toContain('reboot')
    })
  })

  describe('inheritance chain', () => {
    it('should work with extended base classes', () => {
      const DOWithBash = withBash(ExtendedDO)
      const instance = new DOWithBash('test-id', {}, 'MyDO')

      expect(instance.bash).toBeInstanceOf(BashModule)
      expect(instance.name).toBe('MyDO')
      expect(instance.greet()).toBe('Hello from MyDO')
    })

    it('should maintain instanceof checks', () => {
      const DOWithBash = withBash(BaseDO)
      const instance = new DOWithBash()

      expect(instance).toBeInstanceOf(BaseDO)
    })

    it('should create new bash instance per DO instance', () => {
      const DOWithBash = withBash(BaseDO)
      const instance1 = new DOWithBash()
      const instance2 = new DOWithBash()

      expect(instance1.bash).not.toBe(instance2.bash)
    })
  })

  describe('bash module functionality', () => {
    it('should provide analyze functionality', () => {
      const DOWithBash = withBash(BaseDO)
      const instance = new DOWithBash()

      const analysis = instance.bash.analyze('ls -la')
      expect(analysis.dangerous).toBe(false)
      expect(analysis.commands).toContain('ls')
    })

    it('should provide isDangerous functionality', () => {
      const DOWithBash = withBash(BaseDO)
      const instance = new DOWithBash()

      const safe = instance.bash.isDangerous('ls -la')
      expect(safe.dangerous).toBe(false)

      const dangerous = instance.bash.isDangerous('rm -rf /')
      expect(dangerous.dangerous).toBe(true)
    })

    it('should provide block/unblock functionality', () => {
      const DOWithBash = withBash(BaseDO)
      const instance = new DOWithBash()

      instance.bash.block('danger-cmd')
      expect(instance.bash.getBlockedCommands()).toContain('danger-cmd')

      instance.bash.unblock('danger-cmd')
      expect(instance.bash.getBlockedCommands()).not.toContain('danger-cmd')
    })

    it('should provide lifecycle methods', async () => {
      const DOWithBash = withBash(BaseDO)
      const instance = new DOWithBash()

      await expect(instance.bash.initialize()).resolves.toBeUndefined()
      await expect(instance.bash.dispose()).resolves.toBeUndefined()
    })
  })

  describe('exec without executor', () => {
    it('should return error when no executor is configured', async () => {
      const DOWithBash = withBash(BaseDO)
      const instance = new DOWithBash()

      const result = await instance.bash.exec('ls')
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('No executor configured')
    })

    it('should support dry-run mode without executor', async () => {
      const DOWithBash = withBash(BaseDO)
      const instance = new DOWithBash()

      const result = await instance.bash.exec('ls', ['-la'], { dryRun: true })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[dry-run]')
    })
  })
})

// ============================================================================
// withGit Mixin Tests (for comparison)
// ============================================================================

describe('withGit mixin', () => {
  it('should add git property to class', () => {
    const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
    const instance = new DOWithGit()

    expect(instance.git).toBeDefined()
    expect(instance.git).toBeInstanceOf(GitModule)
  })

  it('should preserve base class properties', () => {
    const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
    const instance = new DOWithGit('my-id', { key: 'value' })

    expect(instance.id).toBe('my-id')
    expect(instance.env).toEqual({ key: 'value' })
  })

  it('should pass options to GitModule', () => {
    const DOWithGit = withGit(BaseDO, {
      repo: 'org/repo',
      branch: 'develop',
      path: 'packages/core',
    })
    const instance = new DOWithGit()

    expect(instance.git.binding.repo).toBe('org/repo')
    expect(instance.git.binding.branch).toBe('develop')
    expect(instance.git.binding.path).toBe('packages/core')
  })
})

// ============================================================================
// Composition Tests
// ============================================================================

describe('mixin composition', () => {
  it('should compose withBash and withGit together', () => {
    const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
    const DOWithBoth = withBash(DOWithGit, { cwd: '/app' })
    const instance = new DOWithBoth()

    expect(instance.git).toBeInstanceOf(GitModule)
    expect(instance.bash).toBeInstanceOf(BashModule)
    expect(instance.id).toBe('test-do')
  })

  it('should compose in reverse order', () => {
    const DOWithBash = withBash(BaseDO, { cwd: '/app' })
    const DOWithBoth = withGit(DOWithBash, { repo: 'org/repo' })
    const instance = new DOWithBoth()

    expect(instance.git).toBeInstanceOf(GitModule)
    expect(instance.bash).toBeInstanceOf(BashModule)
  })

  it('should preserve all base class functionality through composition', () => {
    const DOWithGit = withGit(ExtendedDO, { repo: 'org/repo' })
    const DOWithBoth = withBash(DOWithGit, { cwd: '/app' })
    const instance = new DOWithBoth('test-id', {}, 'ComposedDO')

    expect(instance.git).toBeInstanceOf(GitModule)
    expect(instance.bash).toBeInstanceOf(BashModule)
    expect(instance.name).toBe('ComposedDO')
    expect(instance.greet()).toBe('Hello from ComposedDO')
  })

  it('should allow multiple instances with independent modules', () => {
    const DOWithBoth = withBash(withGit(BaseDO, { repo: 'org/repo' }))
    const instance1 = new DOWithBoth()
    const instance2 = new DOWithBoth()

    // Each instance should have its own bash and git
    expect(instance1.bash).not.toBe(instance2.bash)
    expect(instance1.git).not.toBe(instance2.git)

    // Modifications to one shouldn't affect the other
    instance1.bash.block('custom-cmd')
    expect(instance1.bash.getBlockedCommands()).toContain('custom-cmd')
    expect(instance2.bash.getBlockedCommands()).not.toContain('custom-cmd')
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('type safety', () => {
  it('should correctly type WithBashCapability', () => {
    const DOWithBash = withBash(BaseDO)
    const instance: WithBashCapability = new DOWithBash()

    // TypeScript should recognize bash property
    expect(instance.bash).toBeDefined()
  })

  it('should correctly type WithGitCapability', () => {
    const DOWithGit = withGit(BaseDO, { repo: 'org/repo' })
    const instance: WithGitCapability = new DOWithGit()

    // TypeScript should recognize git property
    expect(instance.git).toBeDefined()
  })

  it('should correctly type composed classes', () => {
    const DOWithBoth = withBash(withGit(BaseDO, { repo: 'org/repo' }))
    const instance: WithBashCapability & WithGitCapability = new DOWithBoth()

    expect(instance.bash).toBeDefined()
    expect(instance.git).toBeDefined()
  })
})
