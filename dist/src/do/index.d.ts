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
import { GitModule, createGitModule, isGitModule, type GitModuleOptions, type GitBinding, type GitStatus, type SyncResult, type PushResult, type FsCapability, type R2BucketLike, type R2ObjectLike, type R2ObjectsLike } from './git-module';
export { GitModule, createGitModule, isGitModule, type GitModuleOptions, type GitBinding, type GitStatus, type SyncResult, type PushResult, type FsCapability, type R2BucketLike, type R2ObjectLike, type R2ObjectsLike, };
import { withGit, hasGitCapability, type WithGitCapability, type WithGitOptions, type WithGitContext, type Constructor } from './with-git';
export { withGit, hasGitCapability, type WithGitCapability, type WithGitOptions, type WithGitContext, type Constructor, };
import { withFs, hasFsCapability, type WithFsCapability, type WithFsOptions, type WithFsContext } from './with-fs';
export { withFs, hasFsCapability, type WithFsCapability, type WithFsOptions, type WithFsContext, };
import { FsModule, createFsModule, isFsModule, S_IFMT, S_IFREG, S_IFDIR, S_IFLNK, ENOENT, EEXIST, EISDIR, ENOTDIR, ENOTEMPTY, type FsModuleOptions, type SqlStorage, type SqlResult, type R2BucketLike as FsR2BucketLike, type R2ObjectLike as FsR2ObjectLike, type ReadOptions, type WriteOptions, type MkdirOptions, type RmdirOptions, type RemoveOptions, type ReaddirOptions, type MoveOptions, type CopyOptions, type Dirent, type Stats } from './fs-module';
export { FsModule, createFsModule, isFsModule, S_IFMT, S_IFREG, S_IFDIR, S_IFLNK, ENOENT, EEXIST, EISDIR, ENOTDIR, ENOTEMPTY, type FsModuleOptions, type SqlStorage, type SqlResult, type FsR2BucketLike, type FsR2ObjectLike, type ReadOptions, type WriteOptions, type MkdirOptions, type RmdirOptions, type RemoveOptions, type ReaddirOptions, type MoveOptions, type CopyOptions, type Dirent, type Stats, };
import { CloudflareContainerExecutor, createContainerExecutor, createSandboxExecutor, createHttpExecutor, createWebSocketExecutor, isContainerExecutor, type ContainerExecutorOptions, type CloudflareSandbox, type SandboxExecOptions, type SandboxExecResult, type SandboxStreamResult, type SandboxStreamChunk, type SandboxProcessHandle, type CloudflareContainer, type CloudflareContainerInstance, type ContainerStartOptions, type BashResult, type ExecOptions, type SpawnOptions, type SpawnHandle, type BashExecutor } from './container-executor';
export { CloudflareContainerExecutor, createContainerExecutor, createSandboxExecutor, createHttpExecutor, createWebSocketExecutor, isContainerExecutor, type ContainerExecutorOptions, type CloudflareSandbox, type SandboxExecOptions, type SandboxExecResult, type SandboxStreamResult, type SandboxStreamChunk, type SandboxProcessHandle, type CloudflareContainer, type CloudflareContainerInstance, type ContainerStartOptions, type BashResult, type ExecOptions, type SpawnOptions, type SpawnHandle, type BashExecutor, };
import { TieredStorage, createTieredStorage, type TieredStorageOptions, type TieredStorageStats, type GetObjectResult, type ObjectMetadata, type StorageTier, type R2BucketLike as TieredR2BucketLike, type R2ObjectLike as TieredR2ObjectLike, type R2ObjectsLike as TieredR2ObjectsLike, type R2PutOptions, type SqlStorage as TieredSqlStorage } from './tiered-storage';
export { TieredStorage, createTieredStorage, type TieredStorageOptions, type TieredStorageStats, type GetObjectResult, type ObjectMetadata, type StorageTier, type TieredR2BucketLike, type TieredR2ObjectLike, type TieredR2ObjectsLike, type R2PutOptions, type TieredSqlStorage, };
import { GitRepoDO, isGitRepoDO } from './git-repo-do';
export { GitRepoDO, isGitRepoDO };
import { SchemaManager, SCHEMA_VERSION, SCHEMA_SQL, type DurableObjectStorage } from './schema';
export { SchemaManager, SCHEMA_VERSION, SCHEMA_SQL, type DurableObjectStorage, };
import { ObjectStore, type StoredObject, type ObjectStoreOptions, type ObjectStoreLogger, type ObjectStoreMetrics } from './object-store';
export { ObjectStore, type StoredObject, type ObjectStoreOptions, type ObjectStoreLogger, type ObjectStoreMetrics, };
import { WALManager, type WALOperationType, type TransactionState, type WALEntry, type Transaction, type Checkpoint } from './wal';
export { WALManager, type WALOperationType, type TransactionState, type WALEntry, type Transaction, type Checkpoint, };
import { BranchProtectionManager, checkBranchProtection, matchesProtectionPattern, type BranchProtectionRule, type BranchProtectionInput, type ProtectionCheckResult, type RefUpdateForProtection } from './branch-protection';
export { BranchProtectionManager, checkBranchProtection, matchesProtectionPattern, type BranchProtectionRule, type BranchProtectionInput, type ProtectionCheckResult, type RefUpdateForProtection, };
import { extractToken, verifyJWT, createOAuthMiddleware, requireScope, InMemorySessionCache, parseGitScopes, hasScope, canPerformOperation, shouldRefreshToken, type GitScope, type JWTVerifyOptions, type JWTPayload, type JWTVerifyResult, type OAuthContext, type SessionCache, type OAuthMiddlewareOptions } from './oauth';
export { extractToken, verifyJWT, createOAuthMiddleware, requireScope, InMemorySessionCache, parseGitScopes, hasScope, canPerformOperation, shouldRefreshToken, type GitScope, type JWTVerifyOptions, type JWTPayload, type JWTVerifyResult, type OAuthContext, type SessionCache, type OAuthMiddlewareOptions, };
//# sourceMappingURL=index.d.ts.map