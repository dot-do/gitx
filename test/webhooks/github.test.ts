import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitHubWebhookHandler } from '../../src/webhooks/github'
import { createGitHubSignature } from '../../src/webhooks/signature'
import type { WebhookEnv } from '../../src/webhooks/types'

// ============================================================================
// Constants
// ============================================================================

const TEST_SECRET = 'test-webhook-secret'

// ============================================================================
// Test Helpers
// ============================================================================

function createMockEnv(overrides: Partial<WebhookEnv> = {}): WebhookEnv {
  const mockStub = {
    fetch: vi.fn().mockResolvedValue(new Response('OK', { status: 200 })),
  }

  return {
    GITHUB_WEBHOOK_SECRET: TEST_SECRET,
    GITX: {
      idFromName: vi.fn().mockReturnValue('mock-do-id'),
      get: vi.fn().mockReturnValue(mockStub),
    } as unknown as DurableObjectNamespace,
    ...overrides,
  }
}

function getMockStub(env: WebhookEnv) {
  return (env.GITX.get as ReturnType<typeof vi.fn>).mock.results[0]?.value
}

async function createSignedRequest(
  payload: string,
  eventType: string,
  secret: string = TEST_SECRET,
  options: { method?: string; deliveryId?: string } = {}
): Promise<Request> {
  const { method = 'POST', deliveryId = 'test-delivery-123' } = options
  const signature = await createGitHubSignature(payload, secret)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-github-event': eventType,
    'x-hub-signature-256': signature,
    'x-github-delivery': deliveryId,
  }

  return new Request('https://example.com/webhooks/github', {
    method,
    headers,
    body: method !== 'GET' ? payload : undefined,
  })
}

// ============================================================================
// Sample Payloads
// ============================================================================

const PUSH_PAYLOAD = {
  ref: 'refs/heads/main',
  before: 'a'.repeat(40),
  after: 'b'.repeat(40),
  created: false,
  deleted: false,
  forced: false,
  base_ref: null,
  compare: 'https://github.com/owner/repo/compare/aaa...bbb',
  commits: [
    {
      id: 'b'.repeat(40),
      tree_id: 'c'.repeat(40),
      distinct: true,
      message: 'Update README',
      timestamp: '2024-01-15T10:30:00Z',
      url: 'https://github.com/owner/repo/commit/bbb',
      author: { name: 'Test User', email: 'test@example.com', username: 'testuser' },
      committer: { name: 'Test User', email: 'test@example.com', username: 'testuser' },
      added: [],
      removed: [],
      modified: ['README.md'],
    },
  ],
  head_commit: null,
  repository: {
    id: 12345,
    node_id: 'R_test',
    name: 'repo',
    full_name: 'owner/repo',
    private: false,
    owner: {
      login: 'owner',
      id: 1,
      node_id: 'U_test',
      avatar_url: 'https://avatars.githubusercontent.com/u/1',
      type: 'User' as const,
    },
    html_url: 'https://github.com/owner/repo',
    clone_url: 'https://github.com/owner/repo.git',
    git_url: 'git://github.com/owner/repo.git',
    ssh_url: 'git@github.com:owner/repo.git',
    default_branch: 'main',
  },
  pusher: { name: 'testuser', email: 'test@example.com' },
  sender: {
    login: 'testuser',
    id: 1,
    node_id: 'U_test',
    avatar_url: 'https://avatars.githubusercontent.com/u/1',
    type: 'User',
  },
}

const PING_PAYLOAD = {
  zen: 'Responsive is better than fast.',
  hook_id: 42,
  hook: {
    type: 'Repository',
    id: 42,
    name: 'web',
    active: true,
    events: ['push'],
    config: {
      content_type: 'json',
      url: 'https://example.com/webhooks/github',
      insecure_ssl: '0',
    },
  },
  repository: {
    id: 12345,
    node_id: 'R_test',
    name: 'repo',
    full_name: 'owner/repo',
    private: false,
    owner: {
      login: 'owner',
      id: 1,
      node_id: 'U_test',
      avatar_url: 'https://avatars.githubusercontent.com/u/1',
      type: 'User' as const,
    },
    html_url: 'https://github.com/owner/repo',
    clone_url: 'https://github.com/owner/repo.git',
    git_url: 'git://github.com/owner/repo.git',
    ssh_url: 'git@github.com:owner/repo.git',
    default_branch: 'main',
  },
  sender: { login: 'owner', id: 1 },
}

const CREATE_PAYLOAD = {
  ref: 'feature/new-branch',
  ref_type: 'branch' as const,
  master_branch: 'main',
  description: null,
  pusher_type: 'user',
  repository: PUSH_PAYLOAD.repository,
  sender: { login: 'testuser', id: 1 },
}

const DELETE_PAYLOAD = {
  ref: 'feature/old-branch',
  ref_type: 'branch' as const,
  pusher_type: 'user',
  repository: PUSH_PAYLOAD.repository,
  sender: { login: 'testuser', id: 1 },
}

// ============================================================================
// Signature Verification Tests
// ============================================================================

describe('GitHubWebhookHandler', () => {
  let env: WebhookEnv
  let handler: GitHubWebhookHandler

  beforeEach(() => {
    env = createMockEnv()
    handler = new GitHubWebhookHandler(env)
  })

  describe('signature verification', () => {
    it('should accept requests with valid HMAC-SHA256 signatures', async () => {
      const payload = JSON.stringify(PUSH_PAYLOAD)
      const request = await createSignedRequest(payload, 'push')

      const response = await handler.handle(request)
      const body = await response.json() as { success: boolean }

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
    })

    it('should reject requests with invalid signatures', async () => {
      const payload = JSON.stringify(PUSH_PAYLOAD)
      const request = new Request('https://example.com/webhooks/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-github-event': 'push',
          'x-hub-signature-256': 'sha256=' + 'deadbeef'.repeat(8),
          'x-github-delivery': 'test-delivery',
        },
        body: payload,
      })

      const response = await handler.handle(request)
      const body = await response.json() as { success: boolean; error: string }

      expect(response.status).toBe(401)
      expect(body.success).toBe(false)
      expect(body.error).toBe('Invalid signature')
    })

    it('should reject requests with tampered payload', async () => {
      const originalPayload = JSON.stringify(PUSH_PAYLOAD)
      const signature = await createGitHubSignature(originalPayload, TEST_SECRET)

      // Tamper with the payload after signing
      const tamperedPayload = JSON.stringify({ ...PUSH_PAYLOAD, ref: 'refs/heads/hacked' })

      const request = new Request('https://example.com/webhooks/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-github-event': 'push',
          'x-hub-signature-256': signature,
          'x-github-delivery': 'test-delivery',
        },
        body: tamperedPayload,
      })

      const response = await handler.handle(request)

      expect(response.status).toBe(401)
    })

    it('should reject requests with missing signature header', async () => {
      const payload = JSON.stringify(PUSH_PAYLOAD)
      const request = new Request('https://example.com/webhooks/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-github-event': 'push',
          'x-github-delivery': 'test-delivery',
          // No x-hub-signature-256 header
        },
        body: payload,
      })

      const response = await handler.handle(request)
      const body = await response.json() as { success: boolean; error: string }

      expect(response.status).toBe(401)
      expect(body.success).toBe(false)
      expect(body.error).toBe('Invalid signature')
    })

    it('should reject requests signed with wrong secret', async () => {
      const payload = JSON.stringify(PUSH_PAYLOAD)
      const request = await createSignedRequest(payload, 'push', 'wrong-secret')

      const response = await handler.handle(request)

      expect(response.status).toBe(401)
    })
  })

  // ============================================================================
  // HTTP Method Tests
  // ============================================================================

  describe('HTTP method handling', () => {
    it('should reject non-POST requests', async () => {
      const request = new Request('https://example.com/webhooks/github', {
        method: 'GET',
      })

      const response = await handler.handle(request)
      const body = await response.json() as { success: boolean; error: string }

      expect(response.status).toBe(405)
      expect(body.error).toBe('Method not allowed')
    })

    it('should reject PUT requests', async () => {
      const request = new Request('https://example.com/webhooks/github', {
        method: 'PUT',
        body: '{}',
      })

      const response = await handler.handle(request)

      expect(response.status).toBe(405)
    })

    it('should reject DELETE requests', async () => {
      const request = new Request('https://example.com/webhooks/github', {
        method: 'DELETE',
      })

      const response = await handler.handle(request)

      expect(response.status).toBe(405)
    })
  })

  // ============================================================================
  // Missing Header Tests
  // ============================================================================

  describe('missing headers', () => {
    it('should reject requests without x-github-event header', async () => {
      const payload = JSON.stringify(PUSH_PAYLOAD)
      const signature = await createGitHubSignature(payload, TEST_SECRET)

      const request = new Request('https://example.com/webhooks/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': signature,
          // No x-github-event header
        },
        body: payload,
      })

      const response = await handler.handle(request)
      const body = await response.json() as { success: boolean; error: string }

      expect(response.status).toBe(400)
      expect(body.error).toBe('Missing x-github-event header')
    })
  })

  // ============================================================================
  // Malformed Body Tests
  // ============================================================================

  describe('malformed body handling', () => {
    it('should reject malformed JSON body', async () => {
      const invalidJson = '{not valid json!!!'
      const request = await createSignedRequest(invalidJson, 'push')

      const response = await handler.handle(request)
      const body = await response.json() as { success: boolean; error: string }

      expect(response.status).toBe(400)
      expect(body.error).toBe('Invalid JSON payload')
    })

    it('should reject truncated JSON body', async () => {
      const truncatedJson = '{"ref":"refs/heads/main","before'
      const request = await createSignedRequest(truncatedJson, 'push')

      const response = await handler.handle(request)

      expect(response.status).toBe(400)
    })

    it('should handle empty body with valid signature', async () => {
      const emptyPayload = ''
      const request = await createSignedRequest(emptyPayload, 'push')

      const response = await handler.handle(request)
      const body = await response.json() as { success: boolean; error: string }

      // Empty string is not valid JSON, so it should be rejected
      expect(response.status).toBe(400)
      expect(body.error).toBe('Invalid JSON payload')
    })
  })

  // ============================================================================
  // Event Dispatch Tests
  // ============================================================================

  describe('push event handling', () => {
    it('should dispatch push event to Durable Object', async () => {
      const payload = JSON.stringify(PUSH_PAYLOAD)
      const request = await createSignedRequest(payload, 'push')

      const response = await handler.handle(request)
      const body = await response.json() as { success: boolean; message: string; event: string; repository: string; ref: string }

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.event).toBe('push')
      expect(body.repository).toBe('owner/repo')
      expect(body.ref).toBe('refs/heads/main')
      expect(body.message).toContain('1 commit(s)')
    })

    it('should use correct DO namespace for push events', async () => {
      const payload = JSON.stringify(PUSH_PAYLOAD)
      const request = await createSignedRequest(payload, 'push')

      await handler.handle(request)

      expect(env.GITX.idFromName).toHaveBeenCalledWith('github:owner/repo')
    })

    it('should pass delivery ID to DO', async () => {
      const payload = JSON.stringify(PUSH_PAYLOAD)
      const deliveryId = 'unique-delivery-456'
      const request = await createSignedRequest(payload, 'push', TEST_SECRET, { deliveryId })

      await handler.handle(request)

      const stub = getMockStub(env)
      const fetchCall = stub.fetch.mock.calls[0][0] as Request
      expect(fetchCall.headers.get('X-GitHub-Delivery')).toBe(deliveryId)
    })

    it('should return failure when DO sync fails', async () => {
      const failEnv = createMockEnv()
      const failStub = {
        fetch: vi.fn().mockResolvedValue(new Response('Sync error', { status: 500 })),
      }
      ;(failEnv.GITX.get as ReturnType<typeof vi.fn>).mockReturnValue(failStub)

      const failHandler = new GitHubWebhookHandler(failEnv)
      const payload = JSON.stringify(PUSH_PAYLOAD)
      const request = await createSignedRequest(payload, 'push')

      const response = await failHandler.handle(request)
      const body = await response.json() as { success: boolean; message: string }

      expect(response.status).toBe(500)
      expect(body.success).toBe(false)
      expect(body.message).toBe('Sync failed')
    })

    it('should handle DO fetch throwing an error', async () => {
      const errorEnv = createMockEnv()
      const errorStub = {
        fetch: vi.fn().mockRejectedValue(new Error('Network failure')),
      }
      ;(errorEnv.GITX.get as ReturnType<typeof vi.fn>).mockReturnValue(errorStub)

      const errorHandler = new GitHubWebhookHandler(errorEnv)
      const payload = JSON.stringify(PUSH_PAYLOAD)
      const request = await createSignedRequest(payload, 'push')

      const response = await errorHandler.handle(request)
      const body = await response.json() as { success: boolean; error: string }

      expect(response.status).toBe(500)
      expect(body.success).toBe(false)
      expect(body.error).toBe('Network failure')
    })
  })

  describe('ping event handling', () => {
    it('should respond to ping events', async () => {
      const payload = JSON.stringify(PING_PAYLOAD)
      const request = await createSignedRequest(payload, 'ping')

      const response = await handler.handle(request)
      const body = await response.json() as { success: boolean; message: string; event: string }

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.event).toBe('ping')
      expect(body.message).toContain('Pong!')
      expect(body.message).toContain('owner/repo')
    })

    it('should handle ping event without repository', async () => {
      const pingWithoutRepo = { ...PING_PAYLOAD, repository: undefined }
      const payload = JSON.stringify(pingWithoutRepo)
      const request = await createSignedRequest(payload, 'ping')

      const response = await handler.handle(request)
      const body = await response.json() as { success: boolean; message: string }

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.message).toContain('unknown')
    })
  })

  describe('create event handling', () => {
    it('should handle branch creation events', async () => {
      const payload = JSON.stringify(CREATE_PAYLOAD)
      const request = await createSignedRequest(payload, 'create')

      const response = await handler.handle(request)
      const body = await response.json() as { success: boolean; message: string; event: string; ref: string }

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.event).toBe('create')
      expect(body.ref).toBe('feature/new-branch')
      expect(body.message).toContain('branch')
      expect(body.message).toContain('created')
    })

    it('should handle tag creation events', async () => {
      const tagPayload = { ...CREATE_PAYLOAD, ref: 'v1.0.0', ref_type: 'tag' as const }
      const payload = JSON.stringify(tagPayload)
      const request = await createSignedRequest(payload, 'create')

      const response = await handler.handle(request)
      const body = await response.json() as { success: boolean; message: string }

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.message).toContain('tag')
    })

    it('should use correct DO namespace for create events', async () => {
      const payload = JSON.stringify(CREATE_PAYLOAD)
      const request = await createSignedRequest(payload, 'create')

      await handler.handle(request)

      expect(env.GITX.idFromName).toHaveBeenCalledWith('github:owner/repo')
    })

    it('should handle DO error during create event', async () => {
      const errorEnv = createMockEnv()
      const errorStub = {
        fetch: vi.fn().mockRejectedValue(new Error('DO unavailable')),
      }
      ;(errorEnv.GITX.get as ReturnType<typeof vi.fn>).mockReturnValue(errorStub)

      const errorHandler = new GitHubWebhookHandler(errorEnv)
      const payload = JSON.stringify(CREATE_PAYLOAD)
      const request = await createSignedRequest(payload, 'create')

      const response = await errorHandler.handle(request)
      const body = await response.json() as { success: boolean; error: string }

      expect(response.status).toBe(500)
      expect(body.success).toBe(false)
      expect(body.error).toBe('DO unavailable')
    })
  })

  describe('delete event handling', () => {
    it('should handle branch deletion events', async () => {
      const payload = JSON.stringify(DELETE_PAYLOAD)
      const request = await createSignedRequest(payload, 'delete')

      const response = await handler.handle(request)
      const body = await response.json() as { success: boolean; message: string; event: string; ref: string }

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.event).toBe('delete')
      expect(body.ref).toBe('feature/old-branch')
      expect(body.message).toContain('branch')
      expect(body.message).toContain('deleted')
    })

    it('should handle tag deletion events', async () => {
      const tagPayload = { ...DELETE_PAYLOAD, ref: 'v0.9.0', ref_type: 'tag' as const }
      const payload = JSON.stringify(tagPayload)
      const request = await createSignedRequest(payload, 'delete')

      const response = await handler.handle(request)
      const body = await response.json() as { success: boolean; message: string }

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.message).toContain('tag')
    })

    it('should handle DO error during delete event', async () => {
      const errorEnv = createMockEnv()
      const errorStub = {
        fetch: vi.fn().mockRejectedValue(new Error('Connection lost')),
      }
      ;(errorEnv.GITX.get as ReturnType<typeof vi.fn>).mockReturnValue(errorStub)

      const errorHandler = new GitHubWebhookHandler(errorEnv)
      const payload = JSON.stringify(DELETE_PAYLOAD)
      const request = await createSignedRequest(payload, 'delete')

      const response = await errorHandler.handle(request)
      const body = await response.json() as { success: boolean; error: string }

      expect(response.status).toBe(500)
      expect(body.success).toBe(false)
      expect(body.error).toBe('Connection lost')
    })
  })

  // ============================================================================
  // Unknown Event Type Tests
  // ============================================================================

  describe('unknown event type handling', () => {
    it('should gracefully handle unknown event types', async () => {
      const payload = JSON.stringify({ action: 'opened' })
      const request = await createSignedRequest(payload, 'pull_request')

      const response = await handler.handle(request)
      const body = await response.json() as { success: boolean; message: string; event: string }

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.message).toContain('Ignoring unsupported event')
      expect(body.message).toContain('pull_request')
      expect(body.event).toBe('pull_request')
    })

    it('should handle issues event type', async () => {
      const payload = JSON.stringify({ action: 'opened', issue: { number: 1 } })
      const request = await createSignedRequest(payload, 'issues')

      const response = await handler.handle(request)
      const body = await response.json() as { success: boolean; message: string }

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.message).toContain('issues')
    })

    it('should handle workflow_run event type', async () => {
      const payload = JSON.stringify({ action: 'completed' })
      const request = await createSignedRequest(payload, 'workflow_run')

      const response = await handler.handle(request)
      const body = await response.json() as { success: boolean }

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
    })
  })

  // ============================================================================
  // Response Format Tests
  // ============================================================================

  describe('response format', () => {
    it('should return JSON content type', async () => {
      const payload = JSON.stringify(PUSH_PAYLOAD)
      const request = await createSignedRequest(payload, 'push')

      const response = await handler.handle(request)

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })

    it('should return JSON content type for error responses', async () => {
      const request = new Request('https://example.com/webhooks/github', {
        method: 'GET',
      })

      const response = await handler.handle(request)

      expect(response.headers.get('Content-Type')).toBe('application/json')
    })
  })
})
