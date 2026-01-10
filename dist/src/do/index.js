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
import { GitModule, createGitModule, isGitModule, } from './GitModule';
export { GitModule, createGitModule, isGitModule, };
// ============================================================================
// withGit Mixin Imports and Exports
// ============================================================================
import { withGit, hasGitCapability, } from './withGit';
export { withGit, hasGitCapability, };
// ============================================================================
// withFs Mixin Imports and Exports
// ============================================================================
import { withFs, hasFsCapability, } from './withFs';
export { withFs, hasFsCapability, };
// ============================================================================
// FsModule Imports and Exports
// ============================================================================
import { FsModule, createFsModule, isFsModule, 
// Constants
S_IFMT, S_IFREG, S_IFDIR, S_IFLNK, 
// Error classes
ENOENT, EEXIST, EISDIR, ENOTDIR, ENOTEMPTY, } from './FsModule';
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
import { GitRepoDO, isGitRepoDO } from './GitRepoDO';
export { GitRepoDO, isGitRepoDO };
//# sourceMappingURL=index.js.map