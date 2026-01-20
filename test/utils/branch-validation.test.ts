/**
 * @fileoverview Tests for shared branch validation utilities
 *
 * These tests ensure the centralized validation functions work correctly
 * and provide consistent behavior across the codebase.
 */

import { describe, it, expect } from 'vitest'
import {
  validateBranchName,
  isValidBranchName,
  normalizeBranchName,
  getBranchRefName,
  getRemoteRefName,
  parseRemoteRef,
  MAX_BRANCH_NAME_LENGTH,
  BRANCH_REF_PREFIX,
  REMOTE_REF_PREFIX
} from '../../src/utils/branch-validation'

// ============================================================================
// validateBranchName Tests
// ============================================================================

describe('validateBranchName', () => {
  describe('Valid branch names', () => {
    it('should accept simple valid names', () => {
      expect(validateBranchName('main')).toEqual({ valid: true, normalized: 'main' })
      expect(validateBranchName('feature')).toEqual({ valid: true, normalized: 'feature' })
      expect(validateBranchName('my-branch')).toEqual({ valid: true, normalized: 'my-branch' })
    })

    it('should accept names with slashes', () => {
      expect(validateBranchName('feature/login')).toEqual({ valid: true, normalized: 'feature/login' })
      expect(validateBranchName('feature/user/signup')).toEqual({ valid: true, normalized: 'feature/user/signup' })
    })

    it('should accept names with underscores and numbers', () => {
      expect(validateBranchName('feature_123')).toEqual({ valid: true, normalized: 'feature_123' })
      expect(validateBranchName('v1.0.0')).toEqual({ valid: true, normalized: 'v1.0.0' })
    })

    it('should reject names starting with refs/', () => {
      // Branch names should not start with refs/ - use normalizeBranchName first if needed
      expect(validateBranchName('refs/heads/main').valid).toBe(false)
    })
  })

  describe('Invalid branch names', () => {
    it('should reject empty names', () => {
      const result = validateBranchName('')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('empty')
    })

    it('should reject names exceeding max length', () => {
      const longName = 'a'.repeat(MAX_BRANCH_NAME_LENGTH + 1)
      const result = validateBranchName(longName)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('maximum length')
    })

    it('should reject HEAD as branch name', () => {
      const result = validateBranchName('HEAD')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('HEAD')
    })

    it('should reject names starting with refs/', () => {
      const result = validateBranchName('refs/something')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('refs/')
      // Also reject refs/heads/ prefixed names
      expect(validateBranchName('refs/heads/main').valid).toBe(false)
    })

    it('should reject names starting with dash', () => {
      const result = validateBranchName('-invalid')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('dash')
    })

    it('should reject names with spaces', () => {
      const result = validateBranchName('my branch')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('spaces')
    })

    it('should reject names with double dots', () => {
      const result = validateBranchName('my..branch')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('double dots')
    })

    it('should reject names with consecutive slashes', () => {
      const result = validateBranchName('feature//login')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('consecutive slashes')
    })

    it('should reject names ending with .lock', () => {
      const result = validateBranchName('branch.lock')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('.lock')
    })

    it('should reject names ending with / or .', () => {
      expect(validateBranchName('feature/').valid).toBe(false)
      expect(validateBranchName('feature.').valid).toBe(false)
    })

    it('should reject @ as branch name', () => {
      const result = validateBranchName('@')
      expect(result.valid).toBe(false)
    })

    it('should reject names containing @{', () => {
      const result = validateBranchName('branch@{1}')
      expect(result.valid).toBe(false)
    })

    it('should reject names with control characters', () => {
      const result = validateBranchName('branch\x00name')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('control characters')
    })

    it('should reject names with invalid characters', () => {
      const invalidNames = ['branch~1', 'branch^2', 'branch:name', 'branch?name', 'branch*name', 'branch[name', 'branch]name', 'branch\\name']
      for (const name of invalidNames) {
        expect(validateBranchName(name).valid).toBe(false)
      }
    })

    it('should reject names with non-ASCII characters', () => {
      const result = validateBranchName('feature-\u{1F680}')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('ASCII')
    })
  })
})

// ============================================================================
// isValidBranchName Tests
// ============================================================================

describe('isValidBranchName', () => {
  it('should return true for valid names', () => {
    expect(isValidBranchName('main')).toBe(true)
    expect(isValidBranchName('feature/login')).toBe(true)
    expect(isValidBranchName('my-branch-123')).toBe(true)
  })

  it('should return false for invalid names', () => {
    expect(isValidBranchName('')).toBe(false)
    expect(isValidBranchName('-invalid')).toBe(false)
    expect(isValidBranchName('my..branch')).toBe(false)
    expect(isValidBranchName('branch.lock')).toBe(false)
  })
})

// ============================================================================
// normalizeBranchName Tests
// ============================================================================

describe('normalizeBranchName', () => {
  it('should strip refs/heads/ prefix', () => {
    expect(normalizeBranchName('refs/heads/main')).toBe('main')
    expect(normalizeBranchName('refs/heads/feature/login')).toBe('feature/login')
  })

  it('should preserve names without prefix', () => {
    expect(normalizeBranchName('main')).toBe('main')
    expect(normalizeBranchName('feature/login')).toBe('feature/login')
  })
})

// ============================================================================
// getBranchRefName Tests
// ============================================================================

describe('getBranchRefName', () => {
  it('should add refs/heads/ prefix to simple names', () => {
    expect(getBranchRefName('main')).toBe('refs/heads/main')
    expect(getBranchRefName('feature/login')).toBe('refs/heads/feature/login')
  })

  it('should preserve names already prefixed', () => {
    expect(getBranchRefName('refs/heads/main')).toBe('refs/heads/main')
  })
})

// ============================================================================
// getRemoteRefName Tests
// ============================================================================

describe('getRemoteRefName', () => {
  it('should build correct remote ref path', () => {
    expect(getRemoteRefName('origin', 'main')).toBe('refs/remotes/origin/main')
    expect(getRemoteRefName('upstream', 'develop')).toBe('refs/remotes/upstream/develop')
  })

  it('should handle branch names with slashes', () => {
    expect(getRemoteRefName('origin', 'feature/login')).toBe('refs/remotes/origin/feature/login')
  })
})

// ============================================================================
// parseRemoteRef Tests
// ============================================================================

describe('parseRemoteRef', () => {
  it('should parse full remote ref paths', () => {
    expect(parseRemoteRef('refs/remotes/origin/main')).toEqual({ remote: 'origin', branch: 'main' })
    expect(parseRemoteRef('refs/remotes/upstream/feature/login')).toEqual({ remote: 'upstream', branch: 'feature/login' })
  })

  it('should parse short form remote refs', () => {
    expect(parseRemoteRef('origin/main')).toEqual({ remote: 'origin', branch: 'main' })
    expect(parseRemoteRef('upstream/develop')).toEqual({ remote: 'upstream', branch: 'develop' })
  })

  it('should return null for invalid refs', () => {
    expect(parseRemoteRef('main')).toBeNull()
    expect(parseRemoteRef('noslash')).toBeNull()
  })
})

// ============================================================================
// Constants Tests
// ============================================================================

describe('Constants', () => {
  it('should export correct constants', () => {
    expect(MAX_BRANCH_NAME_LENGTH).toBe(255)
    expect(BRANCH_REF_PREFIX).toBe('refs/heads/')
    expect(REMOTE_REF_PREFIX).toBe('refs/remotes/')
  })
})
