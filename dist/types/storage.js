/**
 * @fileoverview Storage Interface Types
 *
 * This module defines the canonical interfaces for object storage and commit providers.
 * All storage-related interfaces are defined here as the single source of truth.
 *
 * The interfaces follow a layered design:
 * - {@link BasicObjectStore} - Core object CRUD operations
 * - {@link RefObjectStore} - Adds ref management capabilities
 * - {@link TreeDiffObjectStore} - Specialized for tree diff operations
 * - {@link ObjectStore} - Full-featured store combining all capabilities
 *
 * Similarly for commit providers:
 * - {@link BasicCommitProvider} - Core commit retrieval
 * - {@link CommitProvider} - Extended with path filtering and tree access
 *
 * @module types/storage
 *
 * @example
 * ```typescript
 * import type { ObjectStore, CommitProvider } from './types/storage'
 *
 * // Implement a storage backend
 * class MyObjectStore implements ObjectStore {
 *   async getObject(sha: string) { ... }
 *   async storeObject(type: string, data: Uint8Array) { ... }
 *   // ... other methods
 * }
 * ```
 */
export {};
//# sourceMappingURL=storage.js.map