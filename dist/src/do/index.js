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
import { GitModule, createGitModule, isGitModule, } from './git-module';
export { GitModule, createGitModule, isGitModule, };
// ============================================================================
// withGit Mixin Imports and Exports
// ============================================================================
import { withGit, hasGitCapability, } from './with-git';
export { withGit, hasGitCapability, };
// ============================================================================
// withFs Mixin Imports and Exports
// ============================================================================
import { withFs, hasFsCapability, } from './with-fs';
export { withFs, hasFsCapability, };
// ============================================================================
// FsModule Imports and Exports
// ============================================================================
import { FsModule, createFsModule, isFsModule, 
// Constants
S_IFMT, S_IFREG, S_IFDIR, S_IFLNK, 
// Error classes
ENOENT, EEXIST, EISDIR, ENOTDIR, ENOTEMPTY, } from './fs-module';
export { FsModule, createFsModule, isFsModule, 
// Constants
S_IFMT, S_IFREG, S_IFDIR, S_IFLNK, 
// Error classes
ENOENT, EEXIST, EISDIR, ENOTDIR, ENOTEMPTY, };
// ============================================================================
// Container Executor Imports and Exports
// ============================================================================
import { CloudflareContainerExecutor, createContainerExecutor, createSandboxExecutor, createHttpExecutor, createWebSocketExecutor, isContainerExecutor, } from './container-executor';
export { CloudflareContainerExecutor, createContainerExecutor, createSandboxExecutor, createHttpExecutor, createWebSocketExecutor, isContainerExecutor, };
// ============================================================================
// TieredStorage Imports and Exports
// ============================================================================
import { TieredStorage, createTieredStorage, } from './tiered-storage';
export { TieredStorage, createTieredStorage, };
// ============================================================================
// GitRepoDO Imports and Exports
// ============================================================================
import { GitRepoDO, isGitRepoDO } from './git-repo-do';
export { GitRepoDO, isGitRepoDO };
// ============================================================================
// Schema and Database Imports and Exports
// ============================================================================
import { SchemaManager, SCHEMA_VERSION, SCHEMA_SQL, } from './schema';
export { SchemaManager, SCHEMA_VERSION, SCHEMA_SQL, };
// ============================================================================
// ObjectStore Imports and Exports
// ============================================================================
import { ObjectStore, } from './object-store';
export { ObjectStore, };
// ============================================================================
// WAL (Write-Ahead Log) Imports and Exports
// ============================================================================
import { WALManager, } from './wal';
export { WALManager, };
// ============================================================================
// Branch Protection Imports and Exports
// ============================================================================
import { BranchProtectionManager, checkBranchProtection, matchesProtectionPattern, } from './branch-protection';
export { BranchProtectionManager, checkBranchProtection, matchesProtectionPattern, };
// ============================================================================
// OAuth.do Integration Imports and Exports
// ============================================================================
import { extractToken, verifyJWT, createOAuthMiddleware, requireScope, InMemorySessionCache, parseGitScopes, hasScope, canPerformOperation, shouldRefreshToken, } from './oauth';
export { extractToken, verifyJWT, createOAuthMiddleware, requireScope, InMemorySessionCache, parseGitScopes, hasScope, canPerformOperation, shouldRefreshToken, };
//# sourceMappingURL=index.js.map