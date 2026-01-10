/**
 * @fileoverview Consolidated Interface Types
 *
 * This module provides common interface types used across the gitx.do codebase,
 * including storage interfaces, R2 bucket types, and workflow context interfaces.
 * These interfaces serve as the foundation for DO integration modules.
 *
 * @module types/interfaces
 *
 * @example
 * ```typescript
 * import type { SqlStorage, R2BucketLike, WorkflowContext } from 'gitx.do/types'
 *
 * // Use in a Durable Object context
 * class MyDO {
 *   private storage: SqlStorage
 *   private r2: R2BucketLike
 *
 *   constructor(state: DurableObjectState) {
 *     this.storage = state.storage
 *   }
 * }
 * ```
 */
export {};
//# sourceMappingURL=interfaces.js.map