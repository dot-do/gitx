/**
 * @fileoverview Git send-pack Protocol Implementation (Client)
 *
 * This module implements the client-side of Git's send-pack service, which is
 * used by `git-push` to push objects to a remote repository via the
 * git-receive-pack service.
 *
 * @module wire/send-pack
 *
 * ## Protocol Flow
 *
 * 1. **Ref Discovery**: GET /info/refs?service=git-receive-pack to discover remote refs
 * 2. **Command Phase**: Send ref update commands (old-sha new-sha refname)
 * 3. **Pack Phase**: Send packfile with objects the remote doesn't have
 * 4. **Report Status**: Receive status report from server (if report-status capability)
 *
 * ## Features
 *
 * - HTTPS authentication (Basic, Bearer token)
 * - Side-band progress reporting
 * - Report-status handling
 * - Atomic push support
 * - Thin pack generation
 *
 * @see {@link https://git-scm.com/docs/pack-protocol} Git Pack Protocol
 * @see {@link https://git-scm.com/docs/git-send-pack} git-send-pack Documentation
 *
 * @example Push to a remote repository
 * ```typescript
 * import { push } from './wire/send-pack'
 *
 * const result = await push({
 *   url: 'https://github.com/user/repo.git',
 *   auth: { username: 'token', password: 'ghp_xxx' },
 *   refUpdates: [
 *     { refName: 'refs/heads/main', oldSha: 'abc123...', newSha: 'def456...' }
 *   ],
 *   backend
 * })
 *
 * if (result.success) {
 *   console.log('Push successful')
 * }
 * ```
 */
import { type ParsedCloneUrl } from '../ops/clone';
import type { GitBackend } from '../core/backend';
/** Zero SHA - indicates ref creation or deletion */
export declare const ZERO_SHA: string;
/**
 * Authentication credentials for push.
 */
export interface PushAuth {
    /** Username for Basic auth (often 'token' or 'oauth2') */
    username: string;
    /** Password or token for authentication */
    password: string;
}
/**
 * Options for discoverReceivePackRefs
 */
export interface DiscoverOptions {
    /** Authentication credentials */
    auth?: PushAuth | undefined;
    /** Custom fetch function (for testing) */
    fetch?: typeof fetch | undefined;
}
/**
 * A reference update command for push.
 */
export interface RefUpdate {
    /** Full ref name (e.g., 'refs/heads/main') */
    refName: string;
    /** Current SHA on remote (ZERO_SHA for create, actual SHA for update/delete) */
    oldSha: string;
    /** New SHA to set (ZERO_SHA for delete) */
    newSha: string;
    /** Whether to force push (non-fast-forward) */
    force?: boolean;
}
/**
 * Result of a single ref update.
 */
export interface RefUpdateResult {
    /** The ref that was updated */
    refName: string;
    /** Whether the update succeeded */
    success: boolean;
    /** Error message if update failed */
    error?: string;
}
/**
 * Server capabilities from git-receive-pack.
 */
export interface ReceivePackCapabilities {
    /** Server supports status report */
    reportStatus?: boolean;
    /** Server supports delete-refs */
    deleteRefs?: boolean;
    /** Server supports atomic push */
    atomic?: boolean;
    /** Server supports side-band multiplexing */
    sideBand64k?: boolean;
    /** Server supports thin packs */
    thinPack?: boolean;
    /** Server supports ofs-delta */
    ofsDelta?: boolean;
    /** Server agent string */
    agent?: string;
    /** Server supports push options */
    pushOptions?: boolean;
}
/**
 * Remote ref advertisement from git-receive-pack.
 */
export interface RemoteRefAdvertisement {
    /** All refs advertised by the server */
    refs: Array<{
        name: string;
        sha: string;
        peeled?: string;
    }>;
    /** Server capabilities */
    capabilities: ReceivePackCapabilities;
}
/**
 * Options for push operation.
 */
export interface PushOptions {
    /** Remote repository URL (HTTPS) */
    url: string;
    /** Authentication credentials */
    auth?: PushAuth | undefined;
    /** Ref updates to push */
    refUpdates: RefUpdate[];
    /** Git backend to read objects from */
    backend: GitBackend;
    /** Progress callback */
    onProgress?: ((message: string) => void) | undefined;
    /** Custom fetch function (for testing) */
    fetch?: typeof fetch | undefined;
    /** Force push all refs (equivalent to --force) */
    force?: boolean | undefined;
    /** Atomic push - all refs update or none */
    atomic?: boolean | undefined;
    /** Push options to send to server */
    pushOptions?: string[] | undefined;
    /** Generate thin pack (smaller transfer) - currently unused */
    thinPack?: boolean | undefined;
}
/**
 * Result of a push operation.
 */
export interface PushResult {
    /** Whether the push succeeded */
    success: boolean;
    /** Overall error message if push failed */
    error?: string | undefined;
    /** Per-ref results */
    refResults: RefUpdateResult[];
    /** Number of objects sent */
    objectsSent: number;
    /** Pack size in bytes */
    packSize: number;
}
/**
 * Parse capabilities from the first ref line.
 *
 * @param capsString - Space-separated capability string
 * @returns Parsed capabilities object
 */
export declare function parseReceivePackCapabilities(capsString: string): ReceivePackCapabilities;
/**
 * Discover refs from remote for git-receive-pack.
 *
 * @param url - Parsed or string URL
 * @param options - Push options (for auth and custom fetch)
 * @returns Remote ref advertisement
 */
export declare function discoverReceivePackRefs(url: string | ParsedCloneUrl, options?: DiscoverOptions): Promise<RemoteRefAdvertisement>;
/**
 * Push refs to a remote repository.
 *
 * @description
 * Implements the git send-pack protocol to push local refs to a remote
 * repository. This is equivalent to `git push`.
 *
 * The push process:
 * 1. Discover remote refs via info/refs?service=git-receive-pack
 * 2. Determine which objects need to be sent
 * 3. Generate a packfile with those objects
 * 4. Send ref update commands + packfile to the remote
 * 5. Parse and return the server's status report
 *
 * @param options - Push options
 * @returns Push result with per-ref status
 *
 * @example
 * ```typescript
 * const result = await push({
 *   url: 'https://github.com/user/repo.git',
 *   auth: { username: 'token', password: 'ghp_xxx' },
 *   refUpdates: [
 *     {
 *       refName: 'refs/heads/main',
 *       oldSha: 'abc123...',
 *       newSha: 'def456...'
 *     }
 *   ],
 *   backend
 * })
 *
 * if (result.success) {
 *   console.log(`Pushed ${result.objectsSent} objects`)
 * } else {
 *   console.error('Push failed:', result.error)
 * }
 * ```
 */
export declare function push(options: PushOptions): Promise<PushResult>;
/**
 * Push a single branch to a remote.
 *
 * @param url - Remote repository URL
 * @param backend - Git backend
 * @param branchName - Branch name (without refs/heads/ prefix)
 * @param options - Additional options
 * @returns Push result
 *
 * @example
 * ```typescript
 * const result = await pushBranch(
 *   'https://github.com/user/repo.git',
 *   backend,
 *   'main',
 *   { auth: { username: 'token', password: 'ghp_xxx' } }
 * )
 * ```
 */
export declare function pushBranch(url: string, backend: GitBackend, branchName: string, options?: {
    auth?: PushAuth | undefined;
    force?: boolean | undefined;
    onProgress?: ((message: string) => void) | undefined;
    fetch?: typeof fetch | undefined;
}): Promise<PushResult>;
/**
 * Delete a branch on a remote.
 *
 * @param url - Remote repository URL
 * @param branchName - Branch name to delete
 * @param options - Additional options
 * @returns Push result
 *
 * @example
 * ```typescript
 * const result = await deleteBranch(
 *   'https://github.com/user/repo.git',
 *   'old-feature',
 *   { auth: { username: 'token', password: 'ghp_xxx' } }
 * )
 * ```
 */
export declare function deleteBranch(url: string, branchName: string, backend: GitBackend, options?: {
    auth?: PushAuth | undefined;
    onProgress?: ((message: string) => void) | undefined;
    fetch?: typeof fetch | undefined;
}): Promise<PushResult>;
//# sourceMappingURL=send-pack.d.ts.map