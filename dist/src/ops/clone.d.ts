/**
 * @fileoverview Git Clone Operation Implementation
 *
 * This module implements the client-side Git clone operation for fetching repositories
 * from remote HTTPS URLs using the Git Smart HTTP protocol.
 *
 * ## Protocol Flow
 *
 * 1. **URL Parsing**: Extract host, path, and credentials from the clone URL
 * 2. **Ref Discovery**: GET /info/refs?service=git-upload-pack to discover refs
 * 3. **Negotiation**: POST /git-upload-pack with wants (no haves for clone)
 * 4. **Pack Fetch**: Receive packfile with all requested objects
 * 5. **Unpack**: Extract and store objects from the packfile
 * 6. **Refs Setup**: Create local refs pointing to fetched commits
 *
 * @module ops/clone
 * @see {@link https://git-scm.com/docs/http-protocol} Git HTTP Protocol
 * @see {@link https://git-scm.com/book/en/v2/Git-Internals-Transfer-Protocols}
 *
 * @example
 * ```typescript
 * import { clone, parseCloneUrl, discoverRefs, fetchPack } from './ops/clone'
 *
 * // Full clone operation
 * const result = await clone('https://github.com/user/repo.git', backend)
 *
 * // Or step by step:
 * const url = parseCloneUrl('https://github.com/user/repo.git')
 * const refs = await discoverRefs(url)
 * const packData = await fetchPack(url, refs.refs.map(r => r.sha))
 * await unpackObjects(backend, packData)
 * ```
 */
import type { ServerCapabilities, GitRef } from '../wire/smart-http';
import type { GitBackend } from '../core/backend';
/**
 * Parsed clone URL components.
 *
 * @description
 * Contains the parsed components of a Git remote URL, supporting
 * both HTTPS and SSH formats (SSH support is planned for future).
 */
export interface ParsedCloneUrl {
    /** Protocol (https or ssh) */
    protocol: 'https' | 'ssh';
    /** Hostname (e.g., 'github.com') */
    host: string;
    /** Port number (null for default) */
    port: number | null;
    /** Repository path (e.g., '/user/repo.git') */
    path: string;
    /** Username for authentication (optional) */
    username?: string;
    /** Password/token for authentication (optional) */
    password?: string;
    /** Full URL for HTTP requests */
    baseUrl: string;
}
/**
 * Ref advertisement from remote server.
 *
 * @description
 * Contains the refs and capabilities discovered during the
 * initial info/refs request.
 */
export interface RefAdvertisement {
    /** All refs advertised by the server */
    refs: GitRef[];
    /** Server capabilities */
    capabilities: ServerCapabilities;
    /** HEAD reference if present */
    head?: string;
    /** Symbolic ref targets (e.g., HEAD -> refs/heads/main) */
    symrefs: Map<string, string>;
}
/**
 * Result of a clone operation.
 *
 * @description
 * Contains information about what was cloned, including
 * refs created and objects fetched.
 */
export interface CloneResult {
    /** Whether clone succeeded */
    success: boolean;
    /** Error message if clone failed */
    error?: string;
    /** Refs that were created */
    refs: GitRef[];
    /** HEAD commit SHA */
    head?: string;
    /** Default branch name */
    defaultBranch?: string;
    /** Number of objects fetched */
    objectCount: number;
}
/**
 * Options for clone operation.
 */
export interface CloneOptions {
    /** Specific branch to clone (default: default branch) */
    branch?: string;
    /** Clone depth for shallow clone (undefined for full clone) */
    depth?: number;
    /** Progress callback */
    onProgress?: (message: string) => void;
    /** Authentication credentials */
    auth?: {
        username: string;
        password: string;
    };
    /** Custom fetch function (for testing or custom transport) */
    fetch?: typeof fetch;
}
/**
 * Parse a Git clone URL into its components.
 *
 * @description
 * Supports the following URL formats:
 * - `https://github.com/user/repo.git`
 * - `https://github.com/user/repo` (without .git)
 * - `https://username:password@github.com/user/repo.git`
 * - `https://github.com:443/user/repo.git` (with port)
 *
 * SSH URLs are recognized but not yet fully supported:
 * - `git@github.com:user/repo.git`
 * - `ssh://git@github.com/user/repo.git`
 *
 * @param url - The Git remote URL to parse
 * @returns Parsed URL components
 * @throws {Error} If the URL format is invalid or unsupported
 *
 * @example
 * ```typescript
 * const parsed = parseCloneUrl('https://github.com/user/repo.git')
 * // {
 * //   protocol: 'https',
 * //   host: 'github.com',
 * //   port: null,
 * //   path: '/user/repo.git',
 * //   baseUrl: 'https://github.com/user/repo.git'
 * // }
 * ```
 */
export declare function parseCloneUrl(url: string): ParsedCloneUrl;
/**
 * Discover refs from a remote Git repository.
 *
 * @description
 * Performs the initial ref discovery phase of the Git Smart HTTP protocol.
 * This is equivalent to `git ls-remote` and returns all refs and server capabilities.
 *
 * The response format is:
 * 1. Service announcement: `# service=git-upload-pack`
 * 2. Flush packet
 * 3. Refs with capabilities on first line
 * 4. Flush packet
 *
 * @param url - Parsed clone URL or string URL
 * @param options - Clone options (for auth and custom fetch)
 * @returns Ref advertisement with refs and capabilities
 * @throws {Error} If the request fails or response is invalid
 *
 * @example
 * ```typescript
 * const refs = await discoverRefs('https://github.com/user/repo.git')
 * console.log(refs.refs.map(r => `${r.sha} ${r.name}`))
 * console.log('Default branch:', refs.symrefs.get('HEAD'))
 * ```
 */
export declare function discoverRefs(url: string | ParsedCloneUrl, options?: CloneOptions): Promise<RefAdvertisement>;
/**
 * Fetch pack data from a remote repository.
 *
 * @description
 * Performs the data transfer phase of the Git Smart HTTP protocol.
 * Sends want requests for the specified SHAs and receives a packfile
 * containing the requested objects (and all reachable objects).
 *
 * For clone operations, `haves` should be empty since we don't have
 * any objects yet. For fetch operations, `haves` contains SHAs of
 * objects we already have.
 *
 * @param url - Parsed clone URL or string URL
 * @param wants - SHA-1 hashes of objects we want
 * @param options - Clone options
 * @returns Pack data as Uint8Array (including NAK/ACK prefix)
 * @throws {Error} If the request fails
 *
 * @example
 * ```typescript
 * // Clone: want everything, have nothing
 * const packData = await fetchPack(url, refs.map(r => r.sha), [])
 *
 * // Fetch: want new commits, have old ones
 * const packData = await fetchPack(url, newShas, existingShas)
 * ```
 */
export declare function fetchPack(url: string | ParsedCloneUrl, wants: string[], options?: CloneOptions): Promise<Uint8Array>;
/**
 * Extract packfile data from upload-pack response.
 *
 * @description
 * The upload-pack response contains:
 * 1. NAK or ACK lines
 * 2. Packfile data (possibly in side-band format)
 * 3. Flush packet
 *
 * This function extracts just the PACK data, handling side-band
 * demultiplexing if present.
 *
 * @param response - Full upload-pack response
 * @returns Extracted packfile data
 * @throws {Error} If response format is invalid
 *
 * @internal
 */
export declare function extractPackData(response: Uint8Array): Uint8Array;
/**
 * Unpack objects from a packfile and store them in the backend.
 *
 * @description
 * Parses a Git packfile and extracts all objects, handling both
 * full objects and delta-compressed objects. Objects are stored
 * in the provided backend.
 *
 * The packfile format is:
 * 1. 12-byte header (PACK + version + object count)
 * 2. Object entries (variable-length encoded, zlib compressed)
 * 3. 20-byte SHA-1 checksum
 *
 * Delta objects (OFS_DELTA and REF_DELTA) are resolved by applying
 * delta instructions against their base objects.
 *
 * @param backend - Git backend to store objects
 * @param packData - Raw packfile data
 * @param onProgress - Optional progress callback
 * @returns Number of objects unpacked
 * @throws {Error} If packfile is invalid or corrupted
 *
 * @example
 * ```typescript
 * const packData = await fetchPack(url, wants)
 * const extractedPack = extractPackData(packData)
 * const objectCount = await unpackObjects(backend, extractedPack)
 * console.log(`Unpacked ${objectCount} objects`)
 * ```
 */
export declare function unpackObjects(backend: GitBackend, packData: Uint8Array, onProgress?: (message: string) => void): Promise<number>;
/**
 * Clone a remote Git repository.
 *
 * @description
 * Performs a full clone operation, fetching all refs and objects from
 * the remote repository and storing them in the provided backend.
 *
 * This is equivalent to `git clone <url>` and performs:
 * 1. Ref discovery from the remote
 * 2. Packfile fetch with all refs
 * 3. Object unpacking
 * 4. Ref creation in the backend
 *
 * @param url - Remote repository URL (HTTPS)
 * @param backend - Git backend to store cloned data
 * @param options - Clone options
 * @returns Clone result with refs and object count
 *
 * @example
 * ```typescript
 * import { clone } from './ops/clone'
 * import { createMemoryBackend } from '../core/backend'
 *
 * const backend = createMemoryBackend()
 * const result = await clone('https://github.com/user/repo.git', backend, {
 *   onProgress: console.log
 * })
 *
 * console.log(`Cloned ${result.objectCount} objects`)
 * console.log(`Default branch: ${result.defaultBranch}`)
 * ```
 */
export declare function clone(url: string, backend: GitBackend, options?: CloneOptions): Promise<CloneResult>;
//# sourceMappingURL=clone.d.ts.map