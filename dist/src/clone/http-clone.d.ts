/**
 * @fileoverview Git HTTP Clone Implementation
 *
 * This module implements end-to-end cloning from GitHub HTTPS URLs using
 * the Git Smart HTTP protocol. It handles:
 *
 * - Ref discovery via GET /info/refs?service=git-upload-pack
 * - Packfile negotiation via POST /git-upload-pack
 * - Packfile parsing and object extraction
 * - Object storage with SHA-1 verification
 *
 * @module clone/http-clone
 *
 * @example
 * ```typescript
 * import { cloneFromUrl } from './clone/http-clone'
 *
 * const storage = {
 *   async storeObject(type: string, data: Uint8Array): Promise<string> {
 *     // Store and return SHA-1
 *   }
 * }
 *
 * const { refs } = await cloneFromUrl('https://github.com/user/repo.git', storage)
 * console.log('Cloned refs:', refs)
 * ```
 */
import { PackObjectType } from '../pack/format';
/**
 * Storage interface for cloned objects.
 */
export interface CloneStorage {
    /**
     * Store a Git object and return its SHA-1 hash.
     * @param type - Object type ('blob', 'tree', 'commit', 'tag')
     * @param data - Raw object data (without Git header)
     * @returns SHA-1 hash of the stored object
     */
    storeObject(type: string, data: Uint8Array): Promise<string>;
}
/**
 * Result of a clone operation.
 */
export interface CloneResult {
    /** Map of ref names to their SHA-1 values */
    refs: Map<string, string>;
}
/**
 * Parsed ref from server advertisement.
 */
interface AdvertisedRef {
    sha: string;
    name: string;
    capabilities?: string[];
}
/**
 * Object extracted from packfile, pending storage.
 */
interface ExtractedObject {
    type: PackObjectType;
    data: Uint8Array;
    offset: number;
}
/**
 * Clone a repository from a Git HTTP URL.
 *
 * @description
 * Performs an end-to-end clone operation using the Git Smart HTTP protocol:
 *
 * 1. **Ref Discovery**: GET {url}/info/refs?service=git-upload-pack
 *    - Receives list of available refs and server capabilities
 *
 * 2. **Want/Have Negotiation**: POST {url}/git-upload-pack
 *    - Sends "want" lines for all discovered refs
 *    - Receives packfile with all needed objects
 *
 * 3. **Packfile Unpacking**:
 *    - Parses packfile header and objects
 *    - Decompresses zlib-compressed data
 *    - Resolves delta objects (ofs_delta and ref_delta)
 *
 * 4. **Object Storage**:
 *    - Computes SHA-1 for each object
 *    - Stores objects via the provided storage interface
 *
 * @param url - Git repository URL (e.g., 'https://github.com/user/repo.git')
 * @param storage - Storage interface for persisting objects
 * @returns Clone result with discovered refs
 * @throws Error if the clone operation fails
 *
 * @example
 * ```typescript
 * const result = await cloneFromUrl(
 *   'https://github.com/octocat/Hello-World.git',
 *   myStorage
 * )
 * console.log('HEAD:', result.refs.get('HEAD'))
 * ```
 */
export declare function cloneFromUrl(url: string, storage: CloneStorage): Promise<CloneResult>;
/**
 * Parse the ref advertisement response.
 *
 * @description
 * The response format is:
 * 1. Service announcement: "# service=git-upload-pack\n"
 * 2. Flush packet: 0000
 * 3. First ref with capabilities: "<sha> <refname>\0<capabilities>\n"
 * 4. Additional refs: "<sha> <refname>\n"
 * 5. Peeled refs for tags: "<sha> <refname>^{}\n"
 * 6. Flush packet: 0000
 *
 * @param data - Raw response body
 * @returns Parsed refs and capabilities
 */
declare function parseRefAdvertisement(data: Uint8Array): {
    refs: AdvertisedRef[];
    capabilities: string[];
};
/**
 * Build the upload-pack request body.
 *
 * @param refs - Refs to request (want)
 * @param serverCapabilities - Capabilities the server advertised
 * @returns Request body as Uint8Array
 */
declare function buildUploadPackRequest(refs: AdvertisedRef[], serverCapabilities: string[]): Uint8Array;
/**
 * Extract the packfile from the upload-pack response.
 *
 * @description
 * The response format is:
 * - NAK or ACK lines (pkt-line format)
 * - Packfile data (either direct or in side-band format)
 * - Flush packet
 *
 * @param response - Raw response body
 * @returns Extracted packfile data
 */
declare function extractPackfile(response: Uint8Array): Uint8Array;
/**
 * Extract a single object from the packfile.
 *
 * @param packfile - Raw packfile data
 * @param offset - Starting offset of the object
 * @returns Extracted object data and next offset
 */
declare function extractObject(packfile: Uint8Array, offset: number): ExtractedObject & {
    nextOffset: number;
    baseOffset?: number;
    baseSha?: string;
};
export { parseRefAdvertisement, buildUploadPackRequest, extractPackfile, extractObject, };
//# sourceMappingURL=http-clone.d.ts.map