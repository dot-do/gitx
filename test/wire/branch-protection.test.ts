import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  BranchProtectionRule,
  BranchProtectionConfig,
  ProtectionContext,
  matchBranchPattern,
  findMatchingRule,
  checkProtectionRule,
  createBranchProtectionHook,
  createBranchProtectionUpdateHook,
  createStandardProtectionConfig,
} from '../../src/wire/branch-protection'
import type { RefUpdateCommand } from '../../src/wire/receive-pack'
import { ZERO_SHA } from '../../src/wire/receive-pack'

// Sample SHA-1 hashes for testing
const SHA1_COMMIT_1 = 'a'.repeat(40)
const SHA1_COMMIT_2 = 'b'.repeat(40)

describe('Branch Protection', () => {
  // ==========================================================================
  // Pattern Matching
  // ==========================================================================
  describe('matchBranchPattern', () => {
    it('should match exact ref names', () => {
      expect(matchBranchPattern('refs/heads/main', 'refs/heads/main')).toBe(true)
      expect(matchBranchPattern('refs/heads/feature', 'refs/heads/main')).toBe(false)
    })

    it('should match single wildcard (*) for single path segment', () => {
      expect(matchBranchPattern('refs/heads/main', 'refs/heads/*')).toBe(true)
      expect(matchBranchPattern('refs/heads/feature', 'refs/heads/*')).toBe(true)
      expect(matchBranchPattern('refs/heads/feature/sub', 'refs/heads/*')).toBe(false)
    })

    it('should match double wildcard (**) across path segments', () => {
      expect(matchBranchPattern('refs/heads/feature', 'refs/heads/**')).toBe(true)
      expect(matchBranchPattern('refs/heads/feature/sub', 'refs/heads/**')).toBe(true)
      expect(matchBranchPattern('refs/heads/feature/sub/deep', 'refs/heads/**')).toBe(true)
    })

    it('should match partial wildcards', () => {
      expect(matchBranchPattern('refs/heads/release-1.0', 'refs/heads/release-*')).toBe(true)
      expect(matchBranchPattern('refs/heads/release-2.0', 'refs/heads/release-*')).toBe(true)
      expect(matchBranchPattern('refs/heads/feature-test', 'refs/heads/release-*')).toBe(false)
    })

    it('should match question mark for single character', () => {
      expect(matchBranchPattern('refs/heads/v1', 'refs/heads/v?')).toBe(true)
      expect(matchBranchPattern('refs/heads/v2', 'refs/heads/v?')).toBe(true)
      expect(matchBranchPattern('refs/heads/v10', 'refs/heads/v?')).toBe(false)
    })

    it('should handle release branch patterns', () => {
      expect(matchBranchPattern('refs/heads/release/1.0', 'refs/heads/release/*')).toBe(true)
      expect(matchBranchPattern('refs/heads/release/1.0.1', 'refs/heads/release/*')).toBe(true)
      expect(matchBranchPattern('refs/heads/release/1.0/hotfix', 'refs/heads/release/**')).toBe(true)
    })

    it('should escape regex special characters', () => {
      expect(matchBranchPattern('refs/heads/test.branch', 'refs/heads/test.branch')).toBe(true)
      expect(matchBranchPattern('refs/heads/testXbranch', 'refs/heads/test.branch')).toBe(false)
    })

    it('should handle tags', () => {
      expect(matchBranchPattern('refs/tags/v1.0.0', 'refs/tags/*')).toBe(true)
      expect(matchBranchPattern('refs/tags/v1.0.0', 'refs/tags/v*')).toBe(true)
    })
  })

  // ==========================================================================
  // Rule Matching
  // ==========================================================================
  describe('findMatchingRule', () => {
    it('should return undefined when no rules match', () => {
      const rules: BranchProtectionRule[] = [
        { pattern: 'refs/heads/main', blockForcePush: true },
      ]

      expect(findMatchingRule('refs/heads/feature', rules)).toBeUndefined()
    })

    it('should return matching rule', () => {
      const rules: BranchProtectionRule[] = [
        { pattern: 'refs/heads/main', blockForcePush: true },
        { pattern: 'refs/heads/develop', blockDeletion: true },
      ]

      const result = findMatchingRule('refs/heads/main', rules)
      expect(result?.pattern).toBe('refs/heads/main')
      expect(result?.blockForcePush).toBe(true)
    })

    it('should prefer exact matches over wildcards', () => {
      const rules: BranchProtectionRule[] = [
        { pattern: 'refs/heads/*', blockForcePush: false },
        { pattern: 'refs/heads/main', blockForcePush: true },
      ]

      const result = findMatchingRule('refs/heads/main', rules)
      expect(result?.pattern).toBe('refs/heads/main')
      expect(result?.blockForcePush).toBe(true)
    })

    it('should prefer more specific patterns', () => {
      const rules: BranchProtectionRule[] = [
        { pattern: 'refs/heads/**', blockForcePush: false },
        { pattern: 'refs/heads/release/*', blockForcePush: true },
      ]

      const result = findMatchingRule('refs/heads/release/1.0', rules)
      expect(result?.pattern).toBe('refs/heads/release/*')
    })

    it('should handle multiple matching rules with priorities', () => {
      const rules: BranchProtectionRule[] = [
        { pattern: 'refs/heads/*', requiredReviews: 1 },
        { pattern: 'refs/heads/release-*', requiredReviews: 2 },
        { pattern: 'refs/heads/release-1.0', requiredReviews: 3 },
      ]

      const exactMatch = findMatchingRule('refs/heads/release-1.0', rules)
      expect(exactMatch?.requiredReviews).toBe(3)

      const wildcardMatch = findMatchingRule('refs/heads/release-2.0', rules)
      expect(wildcardMatch?.requiredReviews).toBe(2)

      const generalMatch = findMatchingRule('refs/heads/feature', rules)
      expect(generalMatch?.requiredReviews).toBe(1)
    })
  })

  // ==========================================================================
  // Protection Rule Checking
  // ==========================================================================
  describe('checkProtectionRule', () => {
    let config: BranchProtectionConfig

    beforeEach(() => {
      config = {
        rules: [
          {
            pattern: 'refs/heads/main',
            blockForcePush: true,
            blockDeletion: true,
            requiredReviews: 2,
            requireLinearHistory: true,
          },
          {
            pattern: 'refs/heads/release/*',
            blockForcePush: true,
            blockDeletion: true,
          },
          {
            pattern: 'refs/heads/locked',
            lockBranch: true,
          },
        ],
        enabled: true,
      }
    })

    describe('basic operations', () => {
      it('should allow push to unprotected branches', () => {
        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/feature',
          type: 'update',
        }

        const result = checkProtectionRule(command, config, {}, false)
        expect(result.allowed).toBe(true)
      })

      it('should allow normal push to protected branches', () => {
        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        }

        const context: ProtectionContext = {
          approvedReviews: 2,
          hasLinearHistory: true,
        }

        const result = checkProtectionRule(command, config, context, false)
        expect(result.allowed).toBe(true)
      })

      it('should allow creating new branches', () => {
        const command: RefUpdateCommand = {
          oldSha: ZERO_SHA,
          newSha: SHA1_COMMIT_1,
          refName: 'refs/heads/feature-new',
          type: 'create',
        }

        const result = checkProtectionRule(command, config, {}, false)
        expect(result.allowed).toBe(true)
      })
    })

    describe('force push protection', () => {
      it('should block force push on protected branches', () => {
        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        }

        const context: ProtectionContext = {
          approvedReviews: 2,
          hasLinearHistory: true,
        }

        const result = checkProtectionRule(command, config, context, true)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('Force push')
      })

      it('should allow force push on unprotected branches', () => {
        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/feature',
          type: 'update',
        }

        const result = checkProtectionRule(command, config, {}, true)
        expect(result.allowed).toBe(true)
      })

      it('should block force push on release branches', () => {
        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/release/1.0',
          type: 'update',
        }

        const result = checkProtectionRule(command, config, {}, true)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('Force push')
      })
    })

    describe('deletion protection', () => {
      it('should block deletion of protected branches', () => {
        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: ZERO_SHA,
          refName: 'refs/heads/main',
          type: 'delete',
        }

        const result = checkProtectionRule(command, config, {}, false)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('deletion')
      })

      it('should allow deletion of unprotected branches', () => {
        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: ZERO_SHA,
          refName: 'refs/heads/feature',
          type: 'delete',
        }

        const result = checkProtectionRule(command, config, {}, false)
        expect(result.allowed).toBe(true)
      })

      it('should block deletion of release branches', () => {
        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: ZERO_SHA,
          refName: 'refs/heads/release/1.0',
          type: 'delete',
        }

        const result = checkProtectionRule(command, config, {}, false)
        expect(result.allowed).toBe(false)
      })
    })

    describe('required reviews', () => {
      it('should block push without required reviews', () => {
        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        }

        const context: ProtectionContext = {
          approvedReviews: 1,
          hasLinearHistory: true,
        }

        const result = checkProtectionRule(command, config, context, false)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('review')
        expect(result.suggestion).toContain('1 more')
      })

      it('should allow push with sufficient reviews', () => {
        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        }

        const context: ProtectionContext = {
          approvedReviews: 3,
          hasLinearHistory: true,
        }

        const result = checkProtectionRule(command, config, context, false)
        expect(result.allowed).toBe(true)
      })

      it('should block push with zero reviews when required', () => {
        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        }

        const context: ProtectionContext = {
          hasLinearHistory: true,
        }

        const result = checkProtectionRule(command, config, context, false)
        expect(result.allowed).toBe(false)
      })
    })

    describe('linear history', () => {
      it('should block push with non-linear history', () => {
        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        }

        const context: ProtectionContext = {
          approvedReviews: 2,
          hasLinearHistory: false,
        }

        const result = checkProtectionRule(command, config, context, false)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('linear history')
        expect(result.suggestion).toContain('Rebase')
      })

      it('should allow push with linear history', () => {
        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        }

        const context: ProtectionContext = {
          approvedReviews: 2,
          hasLinearHistory: true,
        }

        const result = checkProtectionRule(command, config, context, false)
        expect(result.allowed).toBe(true)
      })
    })

    describe('locked branch', () => {
      it('should block all changes to locked branch', () => {
        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/locked',
          type: 'update',
        }

        const result = checkProtectionRule(command, config, {}, false)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('locked')
      })

      it('should block deletion of locked branch', () => {
        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: ZERO_SHA,
          refName: 'refs/heads/locked',
          type: 'delete',
        }

        const result = checkProtectionRule(command, config, {}, false)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('locked')
      })
    })

    describe('bypass conditions', () => {
      it('should allow admin bypass when enabled', () => {
        const configWithBypass: BranchProtectionConfig = {
          rules: [
            {
              pattern: 'refs/heads/main',
              blockForcePush: true,
              blockDeletion: true,
              allowAdminBypass: true,
            },
          ],
          enabled: true,
        }

        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        }

        const context: ProtectionContext = {
          isAdmin: true,
        }

        const result = checkProtectionRule(command, configWithBypass, context, true)
        expect(result.allowed).toBe(true)
      })

      it('should not allow admin bypass when disabled', () => {
        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        }

        const context: ProtectionContext = {
          isAdmin: true,
          approvedReviews: 0,
        }

        const result = checkProtectionRule(command, config, context, true)
        expect(result.allowed).toBe(false)
      })

      it('should allow user bypass when configured', () => {
        const configWithBypass: BranchProtectionConfig = {
          rules: [
            {
              pattern: 'refs/heads/main',
              blockForcePush: true,
              bypassUsers: ['admin-user'],
            },
          ],
          enabled: true,
        }

        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        }

        const context: ProtectionContext = {
          username: 'admin-user',
        }

        const result = checkProtectionRule(command, configWithBypass, context, true)
        expect(result.allowed).toBe(true)
      })

      it('should allow team bypass when configured', () => {
        const configWithBypass: BranchProtectionConfig = {
          rules: [
            {
              pattern: 'refs/heads/main',
              blockForcePush: true,
              bypassTeams: ['release-team'],
            },
          ],
          enabled: true,
        }

        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        }

        const context: ProtectionContext = {
          teams: ['release-team', 'dev-team'],
        }

        const result = checkProtectionRule(command, configWithBypass, context, true)
        expect(result.allowed).toBe(true)
      })
    })

    describe('disabled protection', () => {
      it('should allow all operations when protection is disabled', () => {
        const disabledConfig: BranchProtectionConfig = {
          rules: [
            {
              pattern: 'refs/heads/main',
              blockForcePush: true,
              blockDeletion: true,
            },
          ],
          enabled: false,
        }

        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        }

        const result = checkProtectionRule(command, disabledConfig, {}, true)
        expect(result.allowed).toBe(true)
      })
    })

    describe('additional protection rules', () => {
      it('should require signed commits when configured', () => {
        const signedConfig: BranchProtectionConfig = {
          rules: [
            {
              pattern: 'refs/heads/main',
              requireSignedCommits: true,
            },
          ],
          enabled: true,
        }

        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        }

        const result = checkProtectionRule(
          command,
          signedConfig,
          { commitsAreSigned: false },
          false
        )
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('signed')
      })

      it('should require status checks when configured', () => {
        const statusConfig: BranchProtectionConfig = {
          rules: [
            {
              pattern: 'refs/heads/main',
              requiredStatusChecks: ['ci/build', 'ci/test', 'ci/lint'],
            },
          ],
          enabled: true,
        }

        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        }

        const result = checkProtectionRule(
          command,
          statusConfig,
          { passedStatusChecks: ['ci/build', 'ci/test'] },
          false
        )
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('ci/lint')
      })

      it('should pass when all status checks pass', () => {
        const statusConfig: BranchProtectionConfig = {
          rules: [
            {
              pattern: 'refs/heads/main',
              requiredStatusChecks: ['ci/build', 'ci/test'],
            },
          ],
          enabled: true,
        }

        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        }

        const result = checkProtectionRule(
          command,
          statusConfig,
          { passedStatusChecks: ['ci/build', 'ci/test', 'ci/lint'] },
          false
        )
        expect(result.allowed).toBe(true)
      })

      it('should require branch to be up to date when configured', () => {
        const upToDateConfig: BranchProtectionConfig = {
          rules: [
            {
              pattern: 'refs/heads/main',
              requireUpToDate: true,
            },
          ],
          enabled: true,
        }

        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        }

        const result = checkProtectionRule(
          command,
          upToDateConfig,
          { isUpToDate: false },
          false
        )
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('up to date')
      })

      it('should require conversation resolution when configured', () => {
        const conversationConfig: BranchProtectionConfig = {
          rules: [
            {
              pattern: 'refs/heads/main',
              requireConversationResolution: true,
            },
          ],
          enabled: true,
        }

        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        }

        const result = checkProtectionRule(
          command,
          conversationConfig,
          { conversationsResolved: false },
          false
        )
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('conversation')
      })
    })

    describe('custom message', () => {
      it('should use custom message when configured', () => {
        const customConfig: BranchProtectionConfig = {
          rules: [
            {
              pattern: 'refs/heads/main',
              blockForcePush: true,
              customMessage: 'Contact admin@example.com for force push access',
            },
          ],
          enabled: true,
        }

        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        }

        const result = checkProtectionRule(command, customConfig, {}, true)
        expect(result.allowed).toBe(false)
        expect(result.reason).toBe('Contact admin@example.com for force push access')
      })
    })

    describe('default protection', () => {
      it('should apply default protection to unmatched branches', () => {
        const configWithDefault: BranchProtectionConfig = {
          rules: [
            { pattern: 'refs/heads/main', blockForcePush: true },
          ],
          defaultProtection: {
            blockDeletion: true,
          },
          enabled: true,
        }

        const command: RefUpdateCommand = {
          oldSha: SHA1_COMMIT_1,
          newSha: ZERO_SHA,
          refName: 'refs/heads/feature',
          type: 'delete',
        }

        const result = checkProtectionRule(command, configWithDefault, {}, false)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain('deletion')
      })
    })
  })

  // ==========================================================================
  // Hook Integration
  // ==========================================================================
  describe('createBranchProtectionHook', () => {
    it('should create a pre-receive hook function', () => {
      const config: BranchProtectionConfig = {
        rules: [{ pattern: 'refs/heads/main', blockForcePush: true }],
        enabled: true,
      }

      const hook = createBranchProtectionHook(config)
      expect(typeof hook).toBe('function')
    })

    it('should allow valid push operations', async () => {
      const config: BranchProtectionConfig = {
        rules: [{ pattern: 'refs/heads/main', blockDeletion: true }],
        enabled: true,
      }

      const hook = createBranchProtectionHook(config)
      const commands: RefUpdateCommand[] = [
        {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        },
      ]

      const result = await hook(commands, {})
      expect(result.success).toBe(true)
    })

    it('should block deletion with appropriate message', async () => {
      const config: BranchProtectionConfig = {
        rules: [{ pattern: 'refs/heads/main', blockDeletion: true }],
        enabled: true,
      }

      const hook = createBranchProtectionHook(config)
      const commands: RefUpdateCommand[] = [
        {
          oldSha: SHA1_COMMIT_1,
          newSha: ZERO_SHA,
          refName: 'refs/heads/main',
          type: 'delete',
        },
      ]

      const result = await hook(commands, {})
      expect(result.success).toBe(false)
      expect(result.message).toContain('Branch protection violation')
      expect(result.message).toContain('refs/heads/main')
    })

    it('should report multiple violations', async () => {
      const config: BranchProtectionConfig = {
        rules: [
          { pattern: 'refs/heads/main', blockDeletion: true },
          { pattern: 'refs/heads/develop', blockDeletion: true },
        ],
        enabled: true,
      }

      const hook = createBranchProtectionHook(config)
      const commands: RefUpdateCommand[] = [
        {
          oldSha: SHA1_COMMIT_1,
          newSha: ZERO_SHA,
          refName: 'refs/heads/main',
          type: 'delete',
        },
        {
          oldSha: SHA1_COMMIT_1,
          newSha: ZERO_SHA,
          refName: 'refs/heads/develop',
          type: 'delete',
        },
      ]

      const result = await hook(commands, {})
      expect(result.success).toBe(false)
      expect(result.message).toContain('refs/heads/main')
      expect(result.message).toContain('refs/heads/develop')
    })

    it('should use context provider for advanced checks', async () => {
      const config: BranchProtectionConfig = {
        rules: [{ pattern: 'refs/heads/main', requiredReviews: 2 }],
        enabled: true,
      }

      const contextProvider = vi.fn().mockResolvedValue({ approvedReviews: 1 })
      const hook = createBranchProtectionHook(config, contextProvider)

      const commands: RefUpdateCommand[] = [
        {
          oldSha: SHA1_COMMIT_1,
          newSha: SHA1_COMMIT_2,
          refName: 'refs/heads/main',
          type: 'update',
        },
      ]

      const result = await hook(commands, {})
      expect(result.success).toBe(false)
      expect(contextProvider).toHaveBeenCalled()
    })
  })

  describe('createBranchProtectionUpdateHook', () => {
    it('should create an update hook function', () => {
      const config: BranchProtectionConfig = {
        rules: [{ pattern: 'refs/heads/main', blockForcePush: true }],
        enabled: true,
      }

      const isAncestor = vi.fn().mockResolvedValue(true)
      const hook = createBranchProtectionUpdateHook(config, isAncestor)
      expect(typeof hook).toBe('function')
    })

    it('should allow fast-forward updates', async () => {
      const config: BranchProtectionConfig = {
        rules: [{ pattern: 'refs/heads/main', blockForcePush: true }],
        enabled: true,
      }

      const isAncestor = vi.fn().mockResolvedValue(true)
      const hook = createBranchProtectionUpdateHook(config, isAncestor)

      const result = await hook('refs/heads/main', SHA1_COMMIT_1, SHA1_COMMIT_2, {})
      expect(result.success).toBe(true)
    })

    it('should block non-fast-forward updates on protected branches', async () => {
      const config: BranchProtectionConfig = {
        rules: [{ pattern: 'refs/heads/main', blockForcePush: true }],
        enabled: true,
      }

      const isAncestor = vi.fn().mockResolvedValue(false)
      const hook = createBranchProtectionUpdateHook(config, isAncestor)

      const result = await hook('refs/heads/main', SHA1_COMMIT_1, SHA1_COMMIT_2, {})
      expect(result.success).toBe(false)
      expect(result.message).toContain('Force push')
    })

    it('should allow non-fast-forward on unprotected branches', async () => {
      const config: BranchProtectionConfig = {
        rules: [{ pattern: 'refs/heads/main', blockForcePush: true }],
        enabled: true,
      }

      const isAncestor = vi.fn().mockResolvedValue(false)
      const hook = createBranchProtectionUpdateHook(config, isAncestor)

      const result = await hook('refs/heads/feature', SHA1_COMMIT_1, SHA1_COMMIT_2, {})
      expect(result.success).toBe(true)
    })

    it('should handle branch creation', async () => {
      const config: BranchProtectionConfig = {
        rules: [{ pattern: 'refs/heads/*', blockDeletion: true }],
        enabled: true,
      }

      const isAncestor = vi.fn()
      const hook = createBranchProtectionUpdateHook(config, isAncestor)

      const result = await hook('refs/heads/new-branch', ZERO_SHA, SHA1_COMMIT_1, {})
      expect(result.success).toBe(true)
      expect(isAncestor).not.toHaveBeenCalled()
    })

    it('should handle branch deletion', async () => {
      const config: BranchProtectionConfig = {
        rules: [{ pattern: 'refs/heads/main', blockDeletion: true }],
        enabled: true,
      }

      const isAncestor = vi.fn()
      const hook = createBranchProtectionUpdateHook(config, isAncestor)

      const result = await hook('refs/heads/main', SHA1_COMMIT_1, ZERO_SHA, {})
      expect(result.success).toBe(false)
      expect(result.message).toContain('deletion')
    })
  })

  // ==========================================================================
  // Standard Configuration
  // ==========================================================================
  describe('createStandardProtectionConfig', () => {
    it('should create config protecting main branch by default', () => {
      const config = createStandardProtectionConfig({})

      expect(config.rules.some((r) => r.pattern === 'refs/heads/main')).toBe(true)
      expect(config.rules.some((r) => r.pattern === 'refs/heads/master')).toBe(true)
    })

    it('should protect release branches by default', () => {
      const config = createStandardProtectionConfig({})

      expect(config.rules.some((r) => r.pattern.includes('release'))).toBe(true)
    })

    it('should set required reviews when specified', () => {
      const config = createStandardProtectionConfig({
        requiredReviewsForMain: 3,
      })

      const mainRule = config.rules.find((r) => r.pattern === 'refs/heads/main')
      expect(mainRule?.requiredReviews).toBe(3)
    })

    it('should set linear history when specified', () => {
      const config = createStandardProtectionConfig({
        requireLinearHistoryForMain: true,
      })

      const mainRule = config.rules.find((r) => r.pattern === 'refs/heads/main')
      expect(mainRule?.requireLinearHistory).toBe(true)
    })

    it('should allow admin bypass when specified', () => {
      const config = createStandardProtectionConfig({
        allowAdminBypass: true,
      })

      for (const rule of config.rules) {
        expect(rule.allowAdminBypass).toBe(true)
      }
    })

    it('should use custom main branch name', () => {
      const config = createStandardProtectionConfig({
        mainBranchName: 'trunk',
      })

      expect(config.rules.some((r) => r.pattern === 'refs/heads/trunk')).toBe(true)
      expect(config.rules.some((r) => r.pattern === 'refs/heads/main')).toBe(false)
    })

    it('should skip main protection when disabled', () => {
      const config = createStandardProtectionConfig({
        protectMain: false,
      })

      expect(config.rules.some((r) => r.pattern === 'refs/heads/main')).toBe(false)
    })

    it('should skip release protection when disabled', () => {
      const config = createStandardProtectionConfig({
        protectReleases: false,
      })

      expect(config.rules.some((r) => r.pattern.includes('release'))).toBe(false)
    })

    it('should enable protection by default', () => {
      const config = createStandardProtectionConfig({})
      expect(config.enabled).toBe(true)
    })
  })

  // ==========================================================================
  // Error Messages
  // ==========================================================================
  describe('Error messages', () => {
    it('should provide clear force push error', () => {
      const config: BranchProtectionConfig = {
        rules: [{ pattern: 'refs/heads/main', blockForcePush: true }],
        enabled: true,
      }

      const command: RefUpdateCommand = {
        oldSha: SHA1_COMMIT_1,
        newSha: SHA1_COMMIT_2,
        refName: 'refs/heads/main',
        type: 'update',
      }

      const result = checkProtectionRule(command, config, {}, true)
      expect(result.reason).toMatch(/force push/i)
    })

    it('should provide clear deletion error', () => {
      const config: BranchProtectionConfig = {
        rules: [{ pattern: 'refs/heads/main', blockDeletion: true }],
        enabled: true,
      }

      const command: RefUpdateCommand = {
        oldSha: SHA1_COMMIT_1,
        newSha: ZERO_SHA,
        refName: 'refs/heads/main',
        type: 'delete',
      }

      const result = checkProtectionRule(command, config, {}, false)
      expect(result.reason).toMatch(/deletion/i)
    })

    it('should provide suggestion for review requirement', () => {
      const config: BranchProtectionConfig = {
        rules: [{ pattern: 'refs/heads/main', requiredReviews: 2 }],
        enabled: true,
      }

      const command: RefUpdateCommand = {
        oldSha: SHA1_COMMIT_1,
        newSha: SHA1_COMMIT_2,
        refName: 'refs/heads/main',
        type: 'update',
      }

      const result = checkProtectionRule(command, config, { approvedReviews: 0 }, false)
      expect(result.suggestion).toBeDefined()
      expect(result.suggestion).toContain('2')
    })

    it('should include violated rule in result', () => {
      const config: BranchProtectionConfig = {
        rules: [{ pattern: 'refs/heads/main', blockForcePush: true }],
        enabled: true,
      }

      const command: RefUpdateCommand = {
        oldSha: SHA1_COMMIT_1,
        newSha: SHA1_COMMIT_2,
        refName: 'refs/heads/main',
        type: 'update',
      }

      const result = checkProtectionRule(command, config, {}, true)
      expect(result.violatedRule).toBeDefined()
      expect(result.violatedRule?.pattern).toBe('refs/heads/main')
    })
  })
})
