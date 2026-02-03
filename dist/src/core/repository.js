/**
 * @fileoverview Repository Abstraction
 *
 * Provides a high-level Repository interface that encapsulates ObjectStore,
 * ref operations, and tree operations into a single cohesive facade.
 *
 * This module is platform-agnostic and delegates all operations to existing
 * modules rather than reimplementing them.
 *
 * @module core/repository
 *
 * @example
 * ```typescript
 * import { GitBackendRepository } from './core/repository'
 * import { createMemoryBackend } from './core/backend'
 *
 * const backend = createMemoryBackend()
 * const repo = new GitBackendRepository(backend)
 *
 * // Object operations
 * const sha = await repo.storeObject('blob', new TextEncoder().encode('hello'))
 * const obj = await repo.getObject(sha)
 *
 * // Ref operations
 * await repo.setRef('refs/heads/main', sha)
 * const refs = await repo.listRefs('refs/heads/')
 *
 * // High-level operations
 * const commit = await repo.getCommit(sha)
 * const log = await repo.log('refs/heads/main', 10)
 * ```
 */
import { GitCommit, parseTreeEntries } from '../../core/objects';
const decoder = new TextDecoder();
// ============================================================================
// GitBackendRepository Implementation
// ============================================================================
/**
 * Repository implementation backed by a GitBackend.
 *
 * @description
 * Delegates all operations to the underlying GitBackend instance.
 * This is a thin facade that adds high-level operations (getCommit,
 * getTree, log) on top of the raw backend interface.
 *
 * @example
 * ```typescript
 * import { GitBackendRepository } from './core/repository'
 * import { createMemoryBackend } from './core/backend'
 *
 * const backend = createMemoryBackend()
 * const repo = new GitBackendRepository(backend)
 *
 * const sha = await repo.storeObject('blob', content)
 * await repo.setRef('refs/heads/main', commitSha)
 * const history = await repo.log('refs/heads/main', 10)
 * ```
 */
export class GitBackendRepository {
    backend;
    constructor(backend) {
        this.backend = backend;
    }
    // ─────────────────────────────────────────────────────────────────────────
    // Object operations
    // ─────────────────────────────────────────────────────────────────────────
    async getObject(sha) {
        const obj = await this.backend.readObject(sha);
        if (!obj)
            return null;
        return { type: obj.type, data: obj.data };
    }
    async storeObject(type, data) {
        return this.backend.writeObject({ type, data });
    }
    async hasObject(sha) {
        return this.backend.hasObject(sha);
    }
    // ─────────────────────────────────────────────────────────────────────────
    // Ref operations
    // ─────────────────────────────────────────────────────────────────────────
    async getRef(name) {
        return this.backend.readRef(name);
    }
    async setRef(name, target) {
        return this.backend.writeRef(name, target);
    }
    async deleteRef(name) {
        const existing = await this.backend.readRef(name);
        if (existing === null)
            return false;
        await this.backend.deleteRef(name);
        return true;
    }
    async listRefs(prefix) {
        return this.backend.listRefs(prefix);
    }
    // ─────────────────────────────────────────────────────────────────────────
    // High-level operations
    // ─────────────────────────────────────────────────────────────────────────
    async getCommit(sha) {
        const obj = await this.backend.readObject(sha);
        if (!obj || obj.type !== 'commit')
            return null;
        try {
            const content = decoder.decode(obj.data);
            const gitCommit = GitCommit.fromContent(content);
            return {
                type: 'commit',
                data: obj.data,
                tree: gitCommit.tree,
                parents: [...(gitCommit.parents || [])],
                author: gitCommit.author,
                committer: gitCommit.committer,
                message: gitCommit.message,
            };
        }
        catch {
            return null;
        }
    }
    async getTree(sha) {
        const obj = await this.backend.readObject(sha);
        if (!obj || obj.type !== 'tree')
            return [];
        try {
            return parseTreeEntries(obj.data);
        }
        catch {
            return [];
        }
    }
    async log(ref, limit = 20) {
        // Resolve ref to SHA if it's a ref name
        let sha = ref;
        if (!/^[0-9a-f]{40}$/i.test(ref)) {
            sha = await this.backend.readRef(ref);
            if (!sha)
                return [];
        }
        const commits = [];
        const queue = [sha];
        const visited = new Set();
        while (queue.length > 0 && commits.length < limit) {
            const currentSha = queue.shift();
            if (visited.has(currentSha))
                continue;
            visited.add(currentSha);
            const commit = await this.getCommit(currentSha);
            if (!commit)
                continue;
            commits.push(commit);
            // Add parents to queue for traversal
            for (const parentSha of commit.parents) {
                if (!visited.has(parentSha)) {
                    queue.push(parentSha);
                }
            }
        }
        return commits;
    }
}
//# sourceMappingURL=repository.js.map