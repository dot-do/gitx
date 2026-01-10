/**
 * @fileoverview Storage Backend Interface for Git Operations
 *
 * This module defines the `StorageBackend` interface that abstracts over different
 * storage implementations. It provides a unified API for:
 * - Content-addressable storage (CAS) for Git objects (blobs, trees, commits, tags)
 * - Reference management (branches, tags, HEAD)
 * - Raw file operations (for index, config, and other Git files)
 * - Directory operations
 *
 * **Implementations**:
 * - `FSStorageBackend` - Uses Node.js `fs/promises` for CLI usage
 * - `DOStorageBackend` - Uses SQLite in Durable Objects for cloud deployment
 *
 * @module storage/backend
 *
 * @example
 * ```typescript
 * import { StorageBackend } from './storage/backend'
 *
 * async function createCommit(backend: StorageBackend) {
 *   // Store a blob
 *   const blobSha = await backend.putObject('blob', content)
 *
 *   // Store a tree referencing the blob
 *   const treeSha = await backend.putObject('tree', treeContent)
 *
 *   // Store the commit
 *   const commitSha = await backend.putObject('commit', commitContent)
 *
 *   // Update the branch ref
 *   await backend.setRef('refs/heads/main', {
 *     name: 'refs/heads/main',
 *     target: commitSha,
 *     type: 'direct'
 *   })
 * }
 * ```
 */
export {};
//# sourceMappingURL=backend.js.map