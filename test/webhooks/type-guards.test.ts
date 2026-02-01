/**
 * @fileoverview Tests for Webhook Type Guards
 *
 * Tests runtime validation for GitHub webhook event types and payload shapes.
 *
 * @module test/webhooks/type-guards.test
 */

import { describe, it, expect } from 'vitest'
import {
  isGitHubEventType,
  isPushEventPayload,
  isPingEventPayload,
  isCreateEventPayload,
  isDeleteEventPayload,
} from '../../src/webhooks/types'

// ============================================================================
// Test Fixtures
// ============================================================================

const validRepository = {
  id: 1,
  node_id: 'abc',
  name: 'repo',
  full_name: 'owner/repo',
  private: false,
  owner: {
    login: 'owner',
    id: 1,
    node_id: 'abc',
    avatar_url: 'https://example.com/avatar.png',
    type: 'User' as const,
  },
  html_url: 'https://github.com/owner/repo',
  clone_url: 'https://github.com/owner/repo.git',
  git_url: 'git://github.com/owner/repo.git',
  ssh_url: 'git@github.com:owner/repo.git',
  default_branch: 'main',
}

// ============================================================================
// isGitHubEventType
// ============================================================================

describe('isGitHubEventType', () => {
  it('accepts all valid event types', () => {
    expect(isGitHubEventType('push')).toBe(true)
    expect(isGitHubEventType('ping')).toBe(true)
    expect(isGitHubEventType('create')).toBe(true)
    expect(isGitHubEventType('delete')).toBe(true)
  })

  it('rejects unknown event types', () => {
    expect(isGitHubEventType('pull_request')).toBe(false)
    expect(isGitHubEventType('issues')).toBe(false)
    expect(isGitHubEventType('release')).toBe(false)
    expect(isGitHubEventType('')).toBe(false)
    expect(isGitHubEventType('PUSH')).toBe(false)
  })
})

// ============================================================================
// isPushEventPayload
// ============================================================================

describe('isPushEventPayload', () => {
  const validPush = {
    ref: 'refs/heads/main',
    before: 'abc123',
    after: 'def456',
    created: false,
    deleted: false,
    forced: false,
    base_ref: null,
    compare: 'https://github.com/owner/repo/compare/abc123...def456',
    commits: [],
    head_commit: null,
    repository: validRepository,
    pusher: { name: 'user', email: 'user@example.com' },
    sender: { login: 'user', id: 1, node_id: 'abc', avatar_url: 'url', type: 'User' },
  }

  it('accepts a valid push payload', () => {
    expect(isPushEventPayload(validPush)).toBe(true)
  })

  it('rejects null', () => {
    expect(isPushEventPayload(null)).toBe(false)
  })

  it('rejects missing ref', () => {
    const { ref, ...rest } = validPush
    expect(isPushEventPayload(rest)).toBe(false)
  })

  it('rejects missing before', () => {
    const { before, ...rest } = validPush
    expect(isPushEventPayload(rest)).toBe(false)
  })

  it('rejects missing after', () => {
    const { after, ...rest } = validPush
    expect(isPushEventPayload(rest)).toBe(false)
  })

  it('rejects missing commits', () => {
    const { commits, ...rest } = validPush
    expect(isPushEventPayload(rest)).toBe(false)
  })

  it('rejects non-array commits', () => {
    expect(isPushEventPayload({ ...validPush, commits: 'not-array' })).toBe(false)
  })

  it('rejects missing repository', () => {
    const { repository, ...rest } = validPush
    expect(isPushEventPayload(rest)).toBe(false)
  })

  it('rejects repository without full_name', () => {
    expect(
      isPushEventPayload({
        ...validPush,
        repository: { ...validRepository, full_name: undefined },
      })
    ).toBe(false)
  })

  it('rejects repository without clone_url', () => {
    expect(
      isPushEventPayload({
        ...validPush,
        repository: { ...validRepository, clone_url: undefined },
      })
    ).toBe(false)
  })
})

// ============================================================================
// isPingEventPayload
// ============================================================================

describe('isPingEventPayload', () => {
  const validPing = {
    zen: 'Keep it logically awesome.',
    hook_id: 12345,
    hook: {
      type: 'Repository',
      id: 1,
      name: 'web',
      active: true,
      events: ['push'],
      config: { content_type: 'json', url: 'https://example.com', insecure_ssl: '0' },
    },
    repository: validRepository,
    sender: { login: 'user', id: 1 },
  }

  it('accepts a valid ping payload', () => {
    expect(isPingEventPayload(validPing)).toBe(true)
  })

  it('accepts ping without optional repository', () => {
    const { repository, ...rest } = validPing
    expect(isPingEventPayload(rest)).toBe(true)
  })

  it('rejects null', () => {
    expect(isPingEventPayload(null)).toBe(false)
  })

  it('rejects missing zen', () => {
    const { zen, ...rest } = validPing
    expect(isPingEventPayload(rest)).toBe(false)
  })

  it('rejects missing hook_id', () => {
    const { hook_id, ...rest } = validPing
    expect(isPingEventPayload(rest)).toBe(false)
  })

  it('rejects non-number hook_id', () => {
    expect(isPingEventPayload({ ...validPing, hook_id: 'abc' })).toBe(false)
  })
})

// ============================================================================
// isCreateEventPayload
// ============================================================================

describe('isCreateEventPayload', () => {
  const validCreate = {
    ref: 'feature-branch',
    ref_type: 'branch' as const,
    master_branch: 'main',
    description: null,
    pusher_type: 'user',
    repository: validRepository,
    sender: { login: 'user', id: 1 },
  }

  it('accepts a valid create payload with branch', () => {
    expect(isCreateEventPayload(validCreate)).toBe(true)
  })

  it('accepts a valid create payload with tag', () => {
    expect(isCreateEventPayload({ ...validCreate, ref_type: 'tag' })).toBe(true)
  })

  it('rejects missing ref', () => {
    const { ref, ...rest } = validCreate
    expect(isCreateEventPayload(rest)).toBe(false)
  })

  it('rejects invalid ref_type', () => {
    expect(isCreateEventPayload({ ...validCreate, ref_type: 'commit' })).toBe(false)
  })

  it('rejects missing repository', () => {
    const { repository, ...rest } = validCreate
    expect(isCreateEventPayload(rest)).toBe(false)
  })

  it('rejects null', () => {
    expect(isCreateEventPayload(null)).toBe(false)
  })
})

// ============================================================================
// isDeleteEventPayload
// ============================================================================

describe('isDeleteEventPayload', () => {
  const validDelete = {
    ref: 'feature-branch',
    ref_type: 'branch' as const,
    pusher_type: 'user',
    repository: validRepository,
    sender: { login: 'user', id: 1 },
  }

  it('accepts a valid delete payload with branch', () => {
    expect(isDeleteEventPayload(validDelete)).toBe(true)
  })

  it('accepts a valid delete payload with tag', () => {
    expect(isDeleteEventPayload({ ...validDelete, ref_type: 'tag' })).toBe(true)
  })

  it('rejects missing ref', () => {
    const { ref, ...rest } = validDelete
    expect(isDeleteEventPayload(rest)).toBe(false)
  })

  it('rejects invalid ref_type', () => {
    expect(isDeleteEventPayload({ ...validDelete, ref_type: 'release' })).toBe(false)
  })

  it('rejects missing repository', () => {
    const { repository, ...rest } = validDelete
    expect(isDeleteEventPayload(rest)).toBe(false)
  })

  it('rejects null', () => {
    expect(isDeleteEventPayload(null)).toBe(false)
  })
})
