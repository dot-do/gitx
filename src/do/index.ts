/**
 * @fileoverview gitx.do/do Entry Point
 *
 * This is the entry point for integrating gitx with dotdo's Durable Objects.
 * It exports the GitModule class and related utilities for use in DOs.
 *
 * @module gitx.do/do
 *
 * @example
 * ```typescript
 * // Import for DO integration
 * import { GitModule, createGitModule, withGit } from 'gitx.do/do'
 *
 * // Create a GitModule in your DO
 * class MyDO extends DO {
 *   git = new GitModule({
 *     repo: 'org/repo',
 *     branch: 'main',
 *     r2: this.env.R2_BUCKET
 *   })
 *
 *   async syncRepository() {
 *     await this.git.sync()
 *   }
 * }
 *
 * // Or use the withGit mixin
 * class MyDO extends withGit(DO, { repo: 'org/repo' }) {
 *   // this.git is automatically available
 * }
 * ```
 */

// ============================================================================
// GitModule Imports and Exports
// ============================================================================

import {
  GitModule,
  createGitModule,
  isGitModule,
  type GitModuleOptions,
  type GitBinding,
  type GitStatus,
  type SyncResult,
  type PushResult,
  type FsCapability,
  type R2BucketLike,
  type R2ObjectLike,
  type R2ObjectsLike,
} from './GitModule'

export {
  GitModule,
  createGitModule,
  isGitModule,
  type GitModuleOptions,
  type GitBinding,
  type GitStatus,
  type SyncResult,
  type PushResult,
  type FsCapability,
  type R2BucketLike,
  type R2ObjectLike,
  type R2ObjectsLike,
}

// ============================================================================
// BashModule Imports and Exports
// ============================================================================

import {
  BashModule,
  createBashModule,
  isBashModule,
  type BashModuleOptions,
  type BashResult,
  type ExecOptions,
  type SpawnOptions,
  type SpawnHandle,
  type BashExecutor,
  type SafetyAnalysis,
  type FsCapability as BashFsCapability,
  type BashStorage,
  type ExecRow,
  type ExecPolicy,
} from './BashModule'

export {
  BashModule,
  createBashModule,
  isBashModule,
  type BashModuleOptions,
  type BashResult,
  type ExecOptions,
  type SpawnOptions,
  type SpawnHandle,
  type BashExecutor,
  type SafetyAnalysis,
  type BashFsCapability,
  type BashStorage,
  type ExecRow,
  type ExecPolicy,
}

// ============================================================================
// Bash AST Parser Imports and Exports
// ============================================================================

import {
  parseBashCommand,
  analyzeASTSafety,
  parseAndAnalyze,
  type ASTNodeType,
  type ListOperator,
  type RedirectType,
  type ASTNode,
  type WordNode,
  type RedirectNode,
  type AssignmentNode,
  type CommandNode,
  type PipelineNode,
  type ListNode,
  type SubshellNode,
  type FunctionNode,
  type ImpactLevel,
  type ASTSafetyAnalysis,
  type SafetyIssue,
} from './bash-ast'

export {
  parseBashCommand,
  analyzeASTSafety,
  parseAndAnalyze,
  type ASTNodeType,
  type ListOperator,
  type RedirectType,
  type ASTNode,
  type WordNode,
  type RedirectNode,
  type AssignmentNode,
  type CommandNode,
  type PipelineNode,
  type ListNode,
  type SubshellNode,
  type FunctionNode,
  type ImpactLevel,
  type ASTSafetyAnalysis,
  type SafetyIssue,
}

// ============================================================================
// withBash Mixin Imports and Exports
// ============================================================================

import {
  withBash,
  hasBashCapability,
  type WithBashCapability,
  type WithBashOptions,
  type Constructor,
} from './withBash'

export {
  withBash,
  hasBashCapability,
  type WithBashCapability,
  type WithBashOptions,
  type Constructor,
}

// ============================================================================
// withGit Mixin Imports and Exports
// ============================================================================

import {
  withGit,
  hasGitCapability,
  type WithGitCapability,
  type WithGitOptions,
  type WithGitContext,
} from './withGit'

export {
  withGit,
  hasGitCapability,
  type WithGitCapability,
  type WithGitOptions,
  type WithGitContext,
}
