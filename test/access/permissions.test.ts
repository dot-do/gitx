import { describe, it, expect } from 'vitest'
import {
  hasPermission,
  getRequiredPermission,
  checkAccess,
  comparePermissions,
  getHighestPermission,
  isPermissionExpired,
  isReadOperation,
  isWriteOperation,
  isAdminOperation,
  isValidPermission,
  isValidPermissionLevel,
  isValidOperation,
  isValidVisibility,
  getAllowedOperations,
  getPermissionDescription,
} from '../../src/access/permissions'
import type {
  Permission,
  PermissionLevel,
  RepositoryOperation,
  UserPermission,
} from '../../src/access/permissions'

// ============================================================================
// hasPermission
// ============================================================================

describe('hasPermission', () => {
  describe('permission hierarchy (admin > write > read > none)', () => {
    it('should allow admin to satisfy any permission requirement', () => {
      expect(hasPermission('admin', 'read')).toBe(true)
      expect(hasPermission('admin', 'write')).toBe(true)
      expect(hasPermission('admin', 'admin')).toBe(true)
    })

    it('should allow write to satisfy read and write but not admin', () => {
      expect(hasPermission('write', 'read')).toBe(true)
      expect(hasPermission('write', 'write')).toBe(true)
      expect(hasPermission('write', 'admin')).toBe(false)
    })

    it('should allow read to satisfy only read', () => {
      expect(hasPermission('read', 'read')).toBe(true)
      expect(hasPermission('read', 'write')).toBe(false)
      expect(hasPermission('read', 'admin')).toBe(false)
    })

    it('should deny none for all permission requirements', () => {
      expect(hasPermission('none', 'read')).toBe(false)
      expect(hasPermission('none', 'write')).toBe(false)
      expect(hasPermission('none', 'admin')).toBe(false)
    })
  })
})

// ============================================================================
// getRequiredPermission
// ============================================================================

describe('getRequiredPermission', () => {
  it('should return read for read operations', () => {
    const readOps: RepositoryOperation[] = [
      'clone', 'fetch', 'read_refs', 'read_objects', 'list_branches', 'list_tags',
    ]
    for (const op of readOps) {
      expect(getRequiredPermission(op)).toBe('read')
    }
  })

  it('should return write for write operations', () => {
    const writeOps: RepositoryOperation[] = [
      'push', 'create_branch', 'delete_branch', 'create_tag', 'delete_tag', 'force_push',
    ]
    for (const op of writeOps) {
      expect(getRequiredPermission(op)).toBe('write')
    }
  })

  it('should return admin for admin operations', () => {
    const adminOps: RepositoryOperation[] = [
      'manage_permissions', 'delete_repo', 'update_settings', 'manage_hooks', 'manage_protected_branches',
    ]
    for (const op of adminOps) {
      expect(getRequiredPermission(op)).toBe('admin')
    }
  })
})

// ============================================================================
// checkAccess
// ============================================================================

describe('checkAccess', () => {
  it('should allow read user to clone', () => {
    const result = checkAccess('read', 'clone')
    expect(result.allowed).toBe(true)
    expect(result.requiredPermission).toBe('read')
    expect(result.actualPermission).toBe('read')
  })

  it('should deny read user from pushing', () => {
    const result = checkAccess('read', 'push')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Insufficient permission')
    expect(result.reason).toContain('write')
    expect(result.reason).toContain('read')
    expect(result.requiredPermission).toBe('write')
    expect(result.actualPermission).toBe('read')
  })

  it('should allow admin to perform any operation', () => {
    const allOps: RepositoryOperation[] = [
      'clone', 'fetch', 'read_refs', 'read_objects', 'list_branches', 'list_tags',
      'push', 'create_branch', 'delete_branch', 'create_tag', 'delete_tag', 'force_push',
      'manage_permissions', 'delete_repo', 'update_settings', 'manage_hooks', 'manage_protected_branches',
    ]
    for (const op of allOps) {
      expect(checkAccess('admin', op).allowed).toBe(true)
    }
  })

  it('should deny none user from any operation', () => {
    expect(checkAccess('none', 'clone').allowed).toBe(false)
    expect(checkAccess('none', 'push').allowed).toBe(false)
    expect(checkAccess('none', 'manage_permissions').allowed).toBe(false)
  })

  it('should include reason when denied', () => {
    const result = checkAccess('none', 'clone')
    expect(result.reason).toBeDefined()
    expect(typeof result.reason).toBe('string')
  })

  it('should not include reason when allowed', () => {
    const result = checkAccess('admin', 'clone')
    expect(result.reason).toBeUndefined()
  })
})

// ============================================================================
// comparePermissions
// ============================================================================

describe('comparePermissions', () => {
  it('should return positive when a > b', () => {
    expect(comparePermissions('admin', 'write')).toBeGreaterThan(0)
    expect(comparePermissions('write', 'read')).toBeGreaterThan(0)
    expect(comparePermissions('read', 'none')).toBeGreaterThan(0)
    expect(comparePermissions('admin', 'none')).toBeGreaterThan(0)
  })

  it('should return negative when a < b', () => {
    expect(comparePermissions('write', 'admin')).toBeLessThan(0)
    expect(comparePermissions('read', 'write')).toBeLessThan(0)
    expect(comparePermissions('none', 'read')).toBeLessThan(0)
  })

  it('should return zero when equal', () => {
    expect(comparePermissions('admin', 'admin')).toBe(0)
    expect(comparePermissions('write', 'write')).toBe(0)
    expect(comparePermissions('read', 'read')).toBe(0)
    expect(comparePermissions('none', 'none')).toBe(0)
  })
})

// ============================================================================
// getHighestPermission
// ============================================================================

describe('getHighestPermission', () => {
  it('should return none for empty array', () => {
    expect(getHighestPermission([])).toBe('none')
  })

  it('should return the single permission when only one is provided', () => {
    expect(getHighestPermission(['read'])).toBe('read')
    expect(getHighestPermission(['write'])).toBe('write')
    expect(getHighestPermission(['admin'])).toBe('admin')
    expect(getHighestPermission(['none'])).toBe('none')
  })

  it('should return the highest among multiple permissions', () => {
    expect(getHighestPermission(['read', 'write', 'read'])).toBe('write')
    expect(getHighestPermission(['read', 'admin', 'write'])).toBe('admin')
    expect(getHighestPermission(['none', 'read'])).toBe('read')
  })

  it('should handle duplicates correctly', () => {
    expect(getHighestPermission(['write', 'write', 'write'])).toBe('write')
  })

  it('should handle all none values', () => {
    expect(getHighestPermission(['none', 'none', 'none'])).toBe('none')
  })
})

// ============================================================================
// isPermissionExpired
// ============================================================================

describe('isPermissionExpired', () => {
  it('should return false when expiresAt is not set', () => {
    const perm: UserPermission = {
      userId: 'user-1',
      repoId: 'org/repo',
      permission: 'write',
    }
    expect(isPermissionExpired(perm)).toBe(false)
  })

  it('should return true when expiresAt is in the past', () => {
    const perm: UserPermission = {
      userId: 'user-1',
      repoId: 'org/repo',
      permission: 'write',
      expiresAt: Date.now() - 1000,
    }
    expect(isPermissionExpired(perm)).toBe(true)
  })

  it('should return false when expiresAt is in the future', () => {
    const perm: UserPermission = {
      userId: 'user-1',
      repoId: 'org/repo',
      permission: 'write',
      expiresAt: Date.now() + 100000,
    }
    expect(isPermissionExpired(perm)).toBe(false)
  })

  it('should return true when expiresAt equals now', () => {
    const now = 1700000000000
    const perm: UserPermission = {
      userId: 'user-1',
      repoId: 'org/repo',
      permission: 'write',
      expiresAt: now,
    }
    expect(isPermissionExpired(perm, now)).toBe(true)
  })

  it('should use custom now parameter', () => {
    const perm: UserPermission = {
      userId: 'user-1',
      repoId: 'org/repo',
      permission: 'write',
      expiresAt: 1000,
    }
    expect(isPermissionExpired(perm, 999)).toBe(false)
    expect(isPermissionExpired(perm, 1000)).toBe(true)
    expect(isPermissionExpired(perm, 1001)).toBe(true)
  })
})

// ============================================================================
// Operation category checks
// ============================================================================

describe('isReadOperation', () => {
  it('should return true for read operations', () => {
    expect(isReadOperation('clone')).toBe(true)
    expect(isReadOperation('fetch')).toBe(true)
    expect(isReadOperation('read_refs')).toBe(true)
    expect(isReadOperation('read_objects')).toBe(true)
    expect(isReadOperation('list_branches')).toBe(true)
    expect(isReadOperation('list_tags')).toBe(true)
  })

  it('should return false for write and admin operations', () => {
    expect(isReadOperation('push')).toBe(false)
    expect(isReadOperation('manage_permissions')).toBe(false)
  })
})

describe('isWriteOperation', () => {
  it('should return true for write operations', () => {
    expect(isWriteOperation('push')).toBe(true)
    expect(isWriteOperation('create_branch')).toBe(true)
    expect(isWriteOperation('delete_branch')).toBe(true)
    expect(isWriteOperation('create_tag')).toBe(true)
    expect(isWriteOperation('delete_tag')).toBe(true)
    expect(isWriteOperation('force_push')).toBe(true)
  })

  it('should return false for read and admin operations', () => {
    expect(isWriteOperation('clone')).toBe(false)
    expect(isWriteOperation('manage_permissions')).toBe(false)
  })
})

describe('isAdminOperation', () => {
  it('should return true for admin operations', () => {
    expect(isAdminOperation('manage_permissions')).toBe(true)
    expect(isAdminOperation('delete_repo')).toBe(true)
    expect(isAdminOperation('update_settings')).toBe(true)
    expect(isAdminOperation('manage_hooks')).toBe(true)
    expect(isAdminOperation('manage_protected_branches')).toBe(true)
  })

  it('should return false for read and write operations', () => {
    expect(isAdminOperation('clone')).toBe(false)
    expect(isAdminOperation('push')).toBe(false)
  })
})

// ============================================================================
// Validation functions
// ============================================================================

describe('isValidPermission', () => {
  it('should accept valid permissions', () => {
    expect(isValidPermission('read')).toBe(true)
    expect(isValidPermission('write')).toBe(true)
    expect(isValidPermission('admin')).toBe(true)
  })

  it('should reject none (not a Permission, only a PermissionLevel)', () => {
    expect(isValidPermission('none')).toBe(false)
  })

  it('should reject invalid values', () => {
    expect(isValidPermission('superadmin')).toBe(false)
    expect(isValidPermission('')).toBe(false)
    expect(isValidPermission(null)).toBe(false)
    expect(isValidPermission(undefined)).toBe(false)
    expect(isValidPermission(42)).toBe(false)
    expect(isValidPermission({})).toBe(false)
  })
})

describe('isValidPermissionLevel', () => {
  it('should accept all valid permission levels including none', () => {
    expect(isValidPermissionLevel('none')).toBe(true)
    expect(isValidPermissionLevel('read')).toBe(true)
    expect(isValidPermissionLevel('write')).toBe(true)
    expect(isValidPermissionLevel('admin')).toBe(true)
  })

  it('should reject invalid values', () => {
    expect(isValidPermissionLevel('superadmin')).toBe(false)
    expect(isValidPermissionLevel('')).toBe(false)
    expect(isValidPermissionLevel(null)).toBe(false)
    expect(isValidPermissionLevel(123)).toBe(false)
  })
})

describe('isValidOperation', () => {
  it('should accept all known operations', () => {
    const ops: RepositoryOperation[] = [
      'clone', 'fetch', 'read_refs', 'read_objects', 'list_branches', 'list_tags',
      'push', 'create_branch', 'delete_branch', 'create_tag', 'delete_tag', 'force_push',
      'manage_permissions', 'delete_repo', 'update_settings', 'manage_hooks', 'manage_protected_branches',
    ]
    for (const op of ops) {
      expect(isValidOperation(op)).toBe(true)
    }
  })

  it('should reject unknown operations', () => {
    expect(isValidOperation('fly')).toBe(false)
    expect(isValidOperation('')).toBe(false)
    expect(isValidOperation(null)).toBe(false)
    expect(isValidOperation(42)).toBe(false)
  })
})

describe('isValidVisibility', () => {
  it('should accept valid visibilities', () => {
    expect(isValidVisibility('public')).toBe(true)
    expect(isValidVisibility('internal')).toBe(true)
    expect(isValidVisibility('private')).toBe(true)
  })

  it('should reject invalid values', () => {
    expect(isValidVisibility('secret')).toBe(false)
    expect(isValidVisibility('')).toBe(false)
    expect(isValidVisibility(null)).toBe(false)
  })
})

// ============================================================================
// getAllowedOperations
// ============================================================================

describe('getAllowedOperations', () => {
  it('should return no operations for none', () => {
    expect(getAllowedOperations('none')).toEqual([])
  })

  it('should return only read operations for read permission', () => {
    const ops = getAllowedOperations('read')
    expect(ops).toContain('clone')
    expect(ops).toContain('fetch')
    expect(ops).toContain('read_refs')
    expect(ops).not.toContain('push')
    expect(ops).not.toContain('manage_permissions')
  })

  it('should return read and write operations for write permission', () => {
    const ops = getAllowedOperations('write')
    expect(ops).toContain('clone')
    expect(ops).toContain('push')
    expect(ops).toContain('create_branch')
    expect(ops).not.toContain('manage_permissions')
    expect(ops).not.toContain('delete_repo')
  })

  it('should return all operations for admin permission', () => {
    const ops = getAllowedOperations('admin')
    expect(ops).toContain('clone')
    expect(ops).toContain('push')
    expect(ops).toContain('manage_permissions')
    expect(ops).toContain('delete_repo')
    expect(ops.length).toBe(17) // all operations
  })
})

// ============================================================================
// getPermissionDescription
// ============================================================================

describe('getPermissionDescription', () => {
  it('should return a description for each permission level', () => {
    const levels: PermissionLevel[] = ['none', 'read', 'write', 'admin']
    for (const level of levels) {
      const desc = getPermissionDescription(level)
      expect(typeof desc).toBe('string')
      expect(desc.length).toBeGreaterThan(0)
    }
  })

  it('should return distinct descriptions for each level', () => {
    const descriptions = new Set([
      getPermissionDescription('none'),
      getPermissionDescription('read'),
      getPermissionDescription('write'),
      getPermissionDescription('admin'),
    ])
    expect(descriptions.size).toBe(4)
  })
})
