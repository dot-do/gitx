/**
 * @fileoverview GitCapability TypeScript Interfaces
 *
 * This module defines the comprehensive TypeScript interfaces for the git capability,
 * designed for integration with Durable Objects as the $.git proxy. It provides
 * type definitions for all core git operations including:
 *
 * - **Repository operations**: clone, init, fetch, pull, push
 * - **Working tree operations**: add, commit, status, log, diff
 * - **Branch operations**: branch, checkout, merge
 * - **Low-level operations**: resolveRef, readObject
 *
 * The interfaces follow the existing patterns established in objects.ts and storage.ts,
 * using JSDoc comments and consistent naming conventions.
 *
 * @module types/capability
 *
 * @example
 * ```typescript
 * import type { GitCapability, GitStatus, Commit } from 'gitx.do'
 *
 * // Use in a Durable Object context as $.git
 * class MyDO extends DO {
 *   async handleRequest(request: Request): Promise<Response> {
 *     const status = await this.$.git.status()
 *     if (status.staged.length > 0) {
 *       const commit = await this.$.git.commit({ message: 'Auto-commit' })
 *       console.log(`Created commit: ${commit.sha}`)
 *     }
 *     return new Response('OK')
 *   }
 * }
 * ```
 */
export {};
//# sourceMappingURL=capability.js.map