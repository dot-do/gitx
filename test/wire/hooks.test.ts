import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  HookRegistry,
  HookExecutor,
  HookConfig,
  HookOutput,
  createPreReceiveHook,
  createUpdateHook,
  createPostReceiveHook,
  createPostUpdateHook,
  createWebhook,
  WebhookPayload,
} from '../../src/wire/hooks'
import type { RefUpdateCommand, RefUpdateResult } from '../../src/wire/receive-pack'

// Sample SHA-1 hashes for testing
const SHA1_COMMIT_1 = 'a'.repeat(40)
const SHA1_COMMIT_2 = 'b'.repeat(40)
const ZERO_SHA = '0'.repeat(40)

describe('HookRegistry', () => {
  let registry: HookRegistry

  beforeEach(() => {
    registry = new HookRegistry()
  })

  describe('register', () => {
    it('should register a function hook', () => {
      const hook = createPreReceiveHook({
        id: 'test-hook',
        handler: async () => ({ success: true }),
      })

      registry.register(hook)

      expect(registry.getHook('test-hook')).toBeDefined()
    })

    it('should register a webhook', () => {
      const hook = createWebhook({
        id: 'test-webhook',
        point: 'post-receive',
        url: 'https://example.com/hook',
      })

      registry.register(hook)

      expect(registry.getHook('test-webhook')).toBeDefined()
    })

    it('should throw if hook id already exists', () => {
      const hook = createPreReceiveHook({
        id: 'test-hook',
        handler: async () => ({ success: true }),
      })

      registry.register(hook)

      expect(() => registry.register(hook)).toThrow("Hook with id 'test-hook' already registered")
    })

    it('should set default priority to 100', () => {
      const hook = createPreReceiveHook({
        id: 'test-hook',
        handler: async () => ({ success: true }),
      })

      registry.register(hook)

      expect(registry.getHook('test-hook')?.priority).toBe(100)
    })

    it('should set default timeout to 30000', () => {
      const hook = createPreReceiveHook({
        id: 'test-hook',
        handler: async () => ({ success: true }),
      })

      registry.register(hook)

      expect(registry.getHook('test-hook')?.timeout).toBe(30000)
    })

    it('should set default enabled to true', () => {
      const hook = createPreReceiveHook({
        id: 'test-hook',
        handler: async () => ({ success: true }),
      })

      registry.register(hook)

      expect(registry.getHook('test-hook')?.enabled).toBe(true)
    })
  })

  describe('unregister', () => {
    it('should remove a registered hook', () => {
      const hook = createPreReceiveHook({
        id: 'test-hook',
        handler: async () => ({ success: true }),
      })

      registry.register(hook)
      const result = registry.unregister('test-hook')

      expect(result).toBe(true)
      expect(registry.getHook('test-hook')).toBeUndefined()
    })

    it('should return false for non-existent hook', () => {
      const result = registry.unregister('non-existent')
      expect(result).toBe(false)
    })
  })

  describe('getHooksForPoint', () => {
    it('should return hooks for specified point', () => {
      registry.register(createPreReceiveHook({
        id: 'pre-1',
        handler: async () => ({ success: true }),
      }))
      registry.register(createPostReceiveHook({
        id: 'post-1',
        handler: async () => ({ success: true }),
      }))

      const preHooks = registry.getHooksForPoint('pre-receive')
      const postHooks = registry.getHooksForPoint('post-receive')

      expect(preHooks).toHaveLength(1)
      expect(preHooks[0].id).toBe('pre-1')
      expect(postHooks).toHaveLength(1)
      expect(postHooks[0].id).toBe('post-1')
    })

    it('should sort hooks by priority (lower first)', () => {
      registry.register(createPreReceiveHook({
        id: 'low-priority',
        priority: 200,
        handler: async () => ({ success: true }),
      }))
      registry.register(createPreReceiveHook({
        id: 'high-priority',
        priority: 10,
        handler: async () => ({ success: true }),
      }))
      registry.register(createPreReceiveHook({
        id: 'medium-priority',
        priority: 50,
        handler: async () => ({ success: true }),
      }))

      const hooks = registry.getHooksForPoint('pre-receive')

      expect(hooks[0].id).toBe('high-priority')
      expect(hooks[1].id).toBe('medium-priority')
      expect(hooks[2].id).toBe('low-priority')
    })

    it('should exclude disabled hooks', () => {
      registry.register(createPreReceiveHook({
        id: 'enabled-hook',
        handler: async () => ({ success: true }),
      }))
      registry.register(createPreReceiveHook({
        id: 'disabled-hook',
        enabled: false,
        handler: async () => ({ success: true }),
      }))

      const hooks = registry.getHooksForPoint('pre-receive')

      expect(hooks).toHaveLength(1)
      expect(hooks[0].id).toBe('enabled-hook')
    })
  })

  describe('setEnabled', () => {
    it('should enable a disabled hook', () => {
      registry.register(createPreReceiveHook({
        id: 'test-hook',
        enabled: false,
        handler: async () => ({ success: true }),
      }))

      registry.setEnabled('test-hook', true)

      expect(registry.getHook('test-hook')?.enabled).toBe(true)
    })

    it('should disable an enabled hook', () => {
      registry.register(createPreReceiveHook({
        id: 'test-hook',
        handler: async () => ({ success: true }),
      }))

      registry.setEnabled('test-hook', false)

      expect(registry.getHook('test-hook')?.enabled).toBe(false)
    })

    it('should return false for non-existent hook', () => {
      expect(registry.setEnabled('non-existent', true)).toBe(false)
    })
  })

  describe('getAllHooks', () => {
    it('should return all registered hooks', () => {
      registry.register(createPreReceiveHook({
        id: 'hook-1',
        handler: async () => ({ success: true }),
      }))
      registry.register(createPostReceiveHook({
        id: 'hook-2',
        handler: async () => ({ success: true }),
      }))

      const hooks = registry.getAllHooks()

      expect(hooks).toHaveLength(2)
    })
  })

  describe('clear', () => {
    it('should remove all hooks', () => {
      registry.register(createPreReceiveHook({
        id: 'hook-1',
        handler: async () => ({ success: true }),
      }))
      registry.register(createPostReceiveHook({
        id: 'hook-2',
        handler: async () => ({ success: true }),
      }))

      registry.clear()

      expect(registry.getAllHooks()).toHaveLength(0)
    })
  })
})

describe('HookExecutor', () => {
  let registry: HookRegistry
  let executor: HookExecutor

  beforeEach(() => {
    registry = new HookRegistry()
    executor = new HookExecutor(registry)
  })

  describe('executePreReceive', () => {
    it('should execute pre-receive hooks in priority order', async () => {
      const executionOrder: string[] = []

      registry.register(createPreReceiveHook({
        id: 'second',
        priority: 20,
        handler: async () => {
          executionOrder.push('second')
          return { success: true }
        },
      }))
      registry.register(createPreReceiveHook({
        id: 'first',
        priority: 10,
        handler: async () => {
          executionOrder.push('first')
          return { success: true }
        },
      }))

      const commands: RefUpdateCommand[] = [{
        oldSha: ZERO_SHA,
        newSha: SHA1_COMMIT_1,
        refName: 'refs/heads/main',
        type: 'create',
      }]

      await executor.executePreReceive(commands, {})

      expect(executionOrder).toEqual(['first', 'second'])
    })

    it('should stop on first failure in sync mode', async () => {
      const executionOrder: string[] = []

      registry.register(createPreReceiveHook({
        id: 'first',
        priority: 10,
        handler: async () => {
          executionOrder.push('first')
          return { success: false, message: 'Blocked' }
        },
      }))
      registry.register(createPreReceiveHook({
        id: 'second',
        priority: 20,
        handler: async () => {
          executionOrder.push('second')
          return { success: true }
        },
      }))

      const commands: RefUpdateCommand[] = [{
        oldSha: ZERO_SHA,
        newSha: SHA1_COMMIT_1,
        refName: 'refs/heads/main',
        type: 'create',
      }]

      const result = await executor.executePreReceive(commands, {}, { mode: 'sync' })

      expect(result.success).toBe(false)
      expect(executionOrder).toEqual(['first'])
    })

    it('should return success when all hooks pass', async () => {
      registry.register(createPreReceiveHook({
        id: 'hook-1',
        handler: async () => ({ success: true }),
      }))
      registry.register(createPreReceiveHook({
        id: 'hook-2',
        handler: async () => ({ success: true }),
      }))

      const commands: RefUpdateCommand[] = [{
        oldSha: ZERO_SHA,
        newSha: SHA1_COMMIT_1,
        refName: 'refs/heads/main',
        type: 'create',
      }]

      const result = await executor.executePreReceive(commands, {})

      expect(result.success).toBe(true)
    })

    it('should call onOutput callback for each hook', async () => {
      const outputs: HookOutput[] = []

      registry.register(createPreReceiveHook({
        id: 'hook-1',
        handler: async () => ({ success: true, message: 'OK' }),
      }))

      const commands: RefUpdateCommand[] = [{
        oldSha: ZERO_SHA,
        newSha: SHA1_COMMIT_1,
        refName: 'refs/heads/main',
        type: 'create',
      }]

      await executor.executePreReceive(commands, {}, {
        onOutput: (output) => outputs.push(output),
      })

      expect(outputs).toHaveLength(1)
      expect(outputs[0].hookId).toBe('hook-1')
      expect(outputs[0].success).toBe(true)
    })

    it('should handle hook timeout', async () => {
      registry.register(createPreReceiveHook({
        id: 'slow-hook',
        timeout: 50,
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 200))
          return { success: true }
        },
      }))

      const commands: RefUpdateCommand[] = [{
        oldSha: ZERO_SHA,
        newSha: SHA1_COMMIT_1,
        refName: 'refs/heads/main',
        type: 'create',
      }]

      const result = await executor.executePreReceive(commands, {})

      expect(result.success).toBe(false)
      expect(result.outputs[0].message).toContain('timeout')
    })

    it('should return success with no hooks registered', async () => {
      const commands: RefUpdateCommand[] = [{
        oldSha: ZERO_SHA,
        newSha: SHA1_COMMIT_1,
        refName: 'refs/heads/main',
        type: 'create',
      }]

      const result = await executor.executePreReceive(commands, {})

      expect(result.success).toBe(true)
      expect(result.outputs).toHaveLength(0)
    })

    it('should pass environment variables to hooks', async () => {
      let receivedEnv: Record<string, string> = {}

      registry.register(createPreReceiveHook({
        id: 'env-hook',
        handler: async (_, env) => {
          receivedEnv = env
          return { success: true }
        },
      }))

      const commands: RefUpdateCommand[] = [{
        oldSha: ZERO_SHA,
        newSha: SHA1_COMMIT_1,
        refName: 'refs/heads/main',
        type: 'create',
      }]

      await executor.executePreReceive(commands, {
        GIT_PUSH_OPTION_0: 'ci.skip',
        CUSTOM_VAR: 'value',
      })

      expect(receivedEnv.GIT_PUSH_OPTION_0).toBe('ci.skip')
      expect(receivedEnv.CUSTOM_VAR).toBe('value')
    })
  })

  describe('executeUpdate', () => {
    it('should execute update hook for each ref', async () => {
      const refs: string[] = []

      registry.register(createUpdateHook({
        id: 'update-hook',
        handler: async (refName) => {
          refs.push(refName)
          return { success: true }
        },
      }))

      const commands: RefUpdateCommand[] = [
        { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/branch1', type: 'create' },
        { oldSha: SHA1_COMMIT_1, newSha: SHA1_COMMIT_2, refName: 'refs/heads/branch2', type: 'update' },
      ]

      const result = await executor.executeUpdate(commands, {})

      expect(refs).toEqual(['refs/heads/branch1', 'refs/heads/branch2'])
      expect(result.results).toHaveLength(2)
      expect(result.results.every((r) => r.success)).toBe(true)
    })

    it('should mark ref as failed if hook rejects', async () => {
      registry.register(createUpdateHook({
        id: 'blocking-hook',
        handler: async (refName) => {
          if (refName.includes('blocked')) {
            return { success: false, message: 'Not allowed' }
          }
          return { success: true }
        },
      }))

      const commands: RefUpdateCommand[] = [
        { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/allowed', type: 'create' },
        { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_2, refName: 'refs/heads/blocked', type: 'create' },
      ]

      const result = await executor.executeUpdate(commands, {})

      expect(result.results[0].success).toBe(true)
      expect(result.results[1].success).toBe(false)
      expect(result.results[1].error).toContain('Not allowed')
    })

    it('should pass oldSha and newSha to handler', async () => {
      let receivedOld = ''
      let receivedNew = ''

      registry.register(createUpdateHook({
        id: 'update-hook',
        handler: async (_, oldSha, newSha) => {
          receivedOld = oldSha
          receivedNew = newSha
          return { success: true }
        },
      }))

      const commands: RefUpdateCommand[] = [{
        oldSha: SHA1_COMMIT_1,
        newSha: SHA1_COMMIT_2,
        refName: 'refs/heads/main',
        type: 'update',
      }]

      await executor.executeUpdate(commands, {})

      expect(receivedOld).toBe(SHA1_COMMIT_1)
      expect(receivedNew).toBe(SHA1_COMMIT_2)
    })
  })

  describe('executePostReceive', () => {
    it('should execute post-receive hooks after updates', async () => {
      let hookCalled = false

      registry.register(createPostReceiveHook({
        id: 'post-hook',
        handler: async () => {
          hookCalled = true
          return { success: true }
        },
      }))

      const commands: RefUpdateCommand[] = [{
        oldSha: ZERO_SHA,
        newSha: SHA1_COMMIT_1,
        refName: 'refs/heads/main',
        type: 'create',
      }]
      const results: RefUpdateResult[] = [{
        refName: 'refs/heads/main',
        success: true,
      }]

      const result = await executor.executePostReceive(commands, results, {})

      expect(hookCalled).toBe(true)
      expect(result.pushSuccess).toBe(true)
    })

    it('should not affect push success on hook failure', async () => {
      registry.register(createPostReceiveHook({
        id: 'failing-hook',
        handler: async () => ({ success: false, message: 'Failed' }),
      }))

      const commands: RefUpdateCommand[] = [{
        oldSha: ZERO_SHA,
        newSha: SHA1_COMMIT_1,
        refName: 'refs/heads/main',
        type: 'create',
      }]
      const results: RefUpdateResult[] = [{
        refName: 'refs/heads/main',
        success: true,
      }]

      const result = await executor.executePostReceive(commands, results, {})

      expect(result.pushSuccess).toBe(true)
      expect(result.hookSuccess).toBe(false)
    })

    it('should only include successful commands', async () => {
      let receivedCommands: RefUpdateCommand[] = []

      registry.register(createPostReceiveHook({
        id: 'post-hook',
        handler: async (cmds) => {
          receivedCommands = cmds
          return { success: true }
        },
      }))

      const commands: RefUpdateCommand[] = [
        { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_1, refName: 'refs/heads/success', type: 'create' },
        { oldSha: ZERO_SHA, newSha: SHA1_COMMIT_2, refName: 'refs/heads/failed', type: 'create' },
      ]
      const results: RefUpdateResult[] = [
        { refName: 'refs/heads/success', success: true },
        { refName: 'refs/heads/failed', success: false, error: 'Failed' },
      ]

      await executor.executePostReceive(commands, results, {})

      expect(receivedCommands).toHaveLength(1)
      expect(receivedCommands[0].refName).toBe('refs/heads/success')
    })
  })

  describe('executePostUpdate', () => {
    it('should execute with successfully updated ref names', async () => {
      let receivedRefs: string[] = []

      registry.register(createPostUpdateHook({
        id: 'post-update-hook',
        handler: async (refs) => {
          receivedRefs = refs
          return { success: true }
        },
      }))

      const results: RefUpdateResult[] = [
        { refName: 'refs/heads/branch1', success: true },
        { refName: 'refs/heads/branch2', success: false },
        { refName: 'refs/heads/branch3', success: true },
      ]

      await executor.executePostUpdate(results)

      expect(receivedRefs).toEqual(['refs/heads/branch1', 'refs/heads/branch3'])
    })

    it('should not call hook if no refs were updated', async () => {
      let hookCalled = false

      registry.register(createPostUpdateHook({
        id: 'post-update-hook',
        handler: async () => {
          hookCalled = true
          return { success: true }
        },
      }))

      const results: RefUpdateResult[] = [
        { refName: 'refs/heads/branch1', success: false },
      ]

      await executor.executePostUpdate(results)

      expect(hookCalled).toBe(false)
    })
  })

  describe('webhook execution', () => {
    it('should POST to webhook URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: 'OK' }),
      })

      registry.register(createWebhook({
        id: 'test-webhook',
        point: 'pre-receive',
        url: 'https://example.com/hook',
      }))

      const commands: RefUpdateCommand[] = [{
        oldSha: ZERO_SHA,
        newSha: SHA1_COMMIT_1,
        refName: 'refs/heads/main',
        type: 'create',
      }]

      const result = await executor.executePreReceive(commands, {}, {
        fetch: mockFetch as unknown as typeof fetch,
      })

      expect(mockFetch).toHaveBeenCalled()
      expect(result.success).toBe(true)
    })

    it('should include HMAC signature when secret is configured', async () => {
      let receivedHeaders: Record<string, string> = {}

      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        receivedHeaders = options.headers
        return { ok: true, json: async () => ({}) }
      })

      registry.register(createWebhook({
        id: 'signed-webhook',
        point: 'pre-receive',
        url: 'https://example.com/hook',
        secret: 'my-secret',
      }))

      const commands: RefUpdateCommand[] = [{
        oldSha: ZERO_SHA,
        newSha: SHA1_COMMIT_1,
        refName: 'refs/heads/main',
        type: 'create',
      }]

      await executor.executePreReceive(commands, {}, {
        fetch: mockFetch as unknown as typeof fetch,
      })

      expect(receivedHeaders['X-Webhook-Signature']).toMatch(/^sha256=[a-f0-9]+$/)
    })

    it('should include custom headers', async () => {
      let receivedHeaders: Record<string, string> = {}

      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        receivedHeaders = options.headers
        return { ok: true, json: async () => ({}) }
      })

      registry.register(createWebhook({
        id: 'custom-headers-webhook',
        point: 'pre-receive',
        url: 'https://example.com/hook',
        headers: {
          'X-Custom-Header': 'custom-value',
          Authorization: 'Bearer token',
        },
      }))

      const commands: RefUpdateCommand[] = [{
        oldSha: ZERO_SHA,
        newSha: SHA1_COMMIT_1,
        refName: 'refs/heads/main',
        type: 'create',
      }]

      await executor.executePreReceive(commands, {}, {
        fetch: mockFetch as unknown as typeof fetch,
      })

      expect(receivedHeaders['X-Custom-Header']).toBe('custom-value')
      expect(receivedHeaders['Authorization']).toBe('Bearer token')
    })

    it('should retry on 5xx errors', async () => {
      let attempts = 0

      const mockFetch = vi.fn().mockImplementation(async () => {
        attempts++
        if (attempts < 3) {
          return { ok: false, status: 500, statusText: 'Internal Server Error', text: async () => 'Error' }
        }
        return { ok: true, json: async () => ({}) }
      })

      registry.register(createWebhook({
        id: 'retry-webhook',
        point: 'pre-receive',
        url: 'https://example.com/hook',
        retry: { attempts: 3, delay: 10, backoff: 1 },
      }))

      const commands: RefUpdateCommand[] = [{
        oldSha: ZERO_SHA,
        newSha: SHA1_COMMIT_1,
        refName: 'refs/heads/main',
        type: 'create',
      }]

      const result = await executor.executePreReceive(commands, {}, {
        fetch: mockFetch as unknown as typeof fetch,
      })

      expect(attempts).toBe(3)
      expect(result.success).toBe(true)
    })

    it('should not retry on 4xx errors', async () => {
      let attempts = 0

      const mockFetch = vi.fn().mockImplementation(async () => {
        attempts++
        return { ok: false, status: 400, statusText: 'Bad Request', text: async () => 'Bad Request' }
      })

      registry.register(createWebhook({
        id: 'no-retry-webhook',
        point: 'pre-receive',
        url: 'https://example.com/hook',
        retry: { attempts: 3, delay: 10 },
      }))

      const commands: RefUpdateCommand[] = [{
        oldSha: ZERO_SHA,
        newSha: SHA1_COMMIT_1,
        refName: 'refs/heads/main',
        type: 'create',
      }]

      const result = await executor.executePreReceive(commands, {}, {
        fetch: mockFetch as unknown as typeof fetch,
      })

      expect(attempts).toBe(1)
      expect(result.success).toBe(false)
    })

    it('should include X-Hook-Point header', async () => {
      let receivedHeaders: Record<string, string> = {}

      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        receivedHeaders = options.headers
        return { ok: true, json: async () => ({}) }
      })

      registry.register(createWebhook({
        id: 'webhook',
        point: 'post-receive',
        url: 'https://example.com/hook',
      }))

      const commands: RefUpdateCommand[] = [{
        oldSha: ZERO_SHA,
        newSha: SHA1_COMMIT_1,
        refName: 'refs/heads/main',
        type: 'create',
      }]
      const results: RefUpdateResult[] = [{
        refName: 'refs/heads/main',
        success: true,
      }]

      await executor.executePostReceive(commands, results, {}, {
        fetch: mockFetch as unknown as typeof fetch,
      })

      expect(receivedHeaders['X-Hook-Point']).toBe('post-receive')
    })

    it('should send correct payload structure', async () => {
      let receivedPayload: WebhookPayload | null = null

      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        receivedPayload = JSON.parse(options.body)
        return { ok: true, json: async () => ({}) }
      })

      registry.register(createWebhook({
        id: 'webhook',
        point: 'pre-receive',
        url: 'https://example.com/hook',
      }))

      const commands: RefUpdateCommand[] = [{
        oldSha: ZERO_SHA,
        newSha: SHA1_COMMIT_1,
        refName: 'refs/heads/main',
        type: 'create',
      }]

      await executor.executePreReceive(commands, { MY_VAR: 'value' }, {
        fetch: mockFetch as unknown as typeof fetch,
        repoId: 'test-repo',
      })

      expect(receivedPayload).not.toBeNull()
      expect(receivedPayload!.hook).toBe('pre-receive')
      expect(receivedPayload!.timestamp).toBeDefined()
      expect(receivedPayload!.repository).toBe('test-repo')
      expect(receivedPayload!.commands).toHaveLength(1)
      expect(receivedPayload!.env).toEqual({ MY_VAR: 'value' })
    })
  })

  describe('async mode execution', () => {
    it('should run hooks in parallel in async mode', async () => {
      const startTimes: number[] = []
      const endTimes: number[] = []

      registry.register(createPreReceiveHook({
        id: 'hook-1',
        handler: async () => {
          startTimes.push(Date.now())
          await new Promise((resolve) => setTimeout(resolve, 50))
          endTimes.push(Date.now())
          return { success: true }
        },
      }))
      registry.register(createPreReceiveHook({
        id: 'hook-2',
        handler: async () => {
          startTimes.push(Date.now())
          await new Promise((resolve) => setTimeout(resolve, 50))
          endTimes.push(Date.now())
          return { success: true }
        },
      }))

      const commands: RefUpdateCommand[] = [{
        oldSha: ZERO_SHA,
        newSha: SHA1_COMMIT_1,
        refName: 'refs/heads/main',
        type: 'create',
      }]

      const start = Date.now()
      await executor.executePreReceive(commands, {}, { mode: 'async' })
      const totalTime = Date.now() - start

      // In parallel, both should start at roughly the same time
      // and total time should be ~50ms not ~100ms
      expect(Math.abs(startTimes[0] - startTimes[1])).toBeLessThan(20)
      expect(totalTime).toBeLessThan(100)
    })

    it('should collect all results in async mode even with failures', async () => {
      registry.register(createPreReceiveHook({
        id: 'hook-1',
        handler: async () => ({ success: true }),
      }))
      registry.register(createPreReceiveHook({
        id: 'hook-2',
        handler: async () => ({ success: false, message: 'Failed' }),
      }))

      const commands: RefUpdateCommand[] = [{
        oldSha: ZERO_SHA,
        newSha: SHA1_COMMIT_1,
        refName: 'refs/heads/main',
        type: 'create',
      }]

      const result = await executor.executePreReceive(commands, {}, { mode: 'async' })

      expect(result.outputs).toHaveLength(2)
      expect(result.success).toBe(false)
    })
  })
})

describe('Factory functions', () => {
  describe('createPreReceiveHook', () => {
    it('should create pre-receive hook config', () => {
      const hook = createPreReceiveHook({
        id: 'test',
        handler: async () => ({ success: true }),
      })

      expect(hook.type).toBe('function')
      expect(hook.point).toBe('pre-receive')
    })
  })

  describe('createUpdateHook', () => {
    it('should create update hook config', () => {
      const hook = createUpdateHook({
        id: 'test',
        handler: async () => ({ success: true }),
      })

      expect(hook.type).toBe('function')
      expect(hook.point).toBe('update')
    })
  })

  describe('createPostReceiveHook', () => {
    it('should create post-receive hook config', () => {
      const hook = createPostReceiveHook({
        id: 'test',
        handler: async () => ({ success: true }),
      })

      expect(hook.type).toBe('function')
      expect(hook.point).toBe('post-receive')
    })
  })

  describe('createPostUpdateHook', () => {
    it('should create post-update hook config', () => {
      const hook = createPostUpdateHook({
        id: 'test',
        handler: async () => ({ success: true }),
      })

      expect(hook.type).toBe('function')
      expect(hook.point).toBe('post-update')
    })
  })

  describe('createWebhook', () => {
    it('should create webhook config', () => {
      const hook = createWebhook({
        id: 'test',
        point: 'post-receive',
        url: 'https://example.com/hook',
      })

      expect(hook.type).toBe('webhook')
      expect(hook.point).toBe('post-receive')
      expect(hook.url).toBe('https://example.com/hook')
    })

    it('should include optional configuration', () => {
      const hook = createWebhook({
        id: 'test',
        point: 'pre-receive',
        url: 'https://example.com/hook',
        secret: 'secret',
        headers: { 'X-Custom': 'value' },
        retry: { attempts: 3, delay: 1000 },
      })

      expect(hook.secret).toBe('secret')
      expect(hook.headers).toEqual({ 'X-Custom': 'value' })
      expect(hook.retry?.attempts).toBe(3)
    })
  })
})
