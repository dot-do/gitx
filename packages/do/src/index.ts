/**
 * @fileoverview gitx.do - Git on Cloudflare Durable Objects
 *
 * This package provides the Cloudflare Workers/Durable Objects integration
 * for gitx. It depends on @dotdo/gitx for the pure git implementation.
 *
 * @module gitx.do
 *
 * @example
 * ```typescript
 * import { GitRepoDO, GitModule, withGit } from 'gitx.do'
 *
 * // Use GitRepoDO for full repository management
 * export { GitRepoDO }
 *
 * // Or use mixins for custom DOs
 * class MyDO extends withGit(DurableObject) {
 *   async doSomething() {
 *     await this.git.clone('https://github.com/org/repo')
 *   }
 * }
 * ```
 */

// Re-export core git types from @dotdo/gitx
export * from '@dotdo/gitx'

// Note: The actual DO implementations will be moved here from src/do/
// For now, this serves as a placeholder for the package structure.
// The full migration will move:
// - GitRepoDO
// - GitModule
// - FsModule
// - withGit, withFs mixins
// - TieredStorage
// - ObjectStore
// - WAL
// - Container executor
// - Schema management
