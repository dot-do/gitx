/**
 * @fileoverview Git Smart HTTP Protocol Implementation
 *
 * This module implements the Git Smart HTTP protocol for server-side handling of
 * Git fetch and push operations over HTTP. It provides handlers for:
 *
 * - **Ref Discovery** (`GET /info/refs?service=git-upload-pack|git-receive-pack`)
 *   Advertises available refs and server capabilities to clients.
 *
 * - **Fetch Data Transfer** (`POST /git-upload-pack`)
 *   Handles client fetch requests by processing wants/haves and returning packfiles.
 *
 * - **Push Data Transfer** (`POST /git-receive-pack`)
 *   Handles client push requests by processing ref updates and incoming packfiles.
 *
 * @module wire/smart-http
 * @see {@link https://git-scm.com/docs/http-protocol} Git HTTP Protocol Documentation
 * @see {@link https://git-scm.com/docs/protocol-common} Git Protocol Common
 *
 * @example Basic server integration
 * ```typescript
 * import { handleInfoRefs, handleUploadPack, handleReceivePack } from './wire/smart-http'
 *
 * // Handle GET /repo.git/info/refs?service=git-upload-pack
 * app.get('/:repo/info/refs', async (req, res) => {
 *   const request: SmartHTTPRequest = {
 *     method: 'GET',
 *     path: '/info/refs',
 *     query: { service: req.query.service },
 *     headers: req.headers,
 *     repository: req.params.repo
 *   }
 *   const response = await handleInfoRefs(request, repositoryProvider, capabilities)
 *   res.status(response.status).set(response.headers).send(response.body)
 * })
 * ```
 */
/**
 * Supported Git Smart HTTP services.
 *
 * @description
 * Git Smart HTTP supports two services:
 * - `git-upload-pack`: Used by git-fetch to download objects
 * - `git-receive-pack`: Used by git-push to upload objects
 */
export type GitService = 'git-upload-pack' | 'git-receive-pack';
/**
 * HTTP methods supported by the Smart HTTP protocol.
 *
 * @description
 * - `GET`: Used for ref discovery (/info/refs)
 * - `POST`: Used for data transfer (upload-pack and receive-pack)
 */
export type HTTPMethod = 'GET' | 'POST';
/**
 * Represents a Git reference (branch, tag, etc.).
 *
 * @description
 * A Git reference is a named pointer to a specific commit or object.
 * Common ref types include:
 * - Branches: `refs/heads/main`, `refs/heads/feature`
 * - Tags: `refs/tags/v1.0.0`
 * - Remote tracking: `refs/remotes/origin/main`
 *
 * @example
 * ```typescript
 * const mainBranch: GitRef = {
 *   sha: 'abc123def456...',
 *   name: 'refs/heads/main'
 * }
 *
 * const annotatedTag: GitRef = {
 *   sha: 'tag-object-sha...',
 *   name: 'refs/tags/v1.0.0',
 *   peeled: 'target-commit-sha...'
 * }
 * ```
 */
export interface GitRef {
    /** SHA-1 hash of the object this ref points to (40 hex characters) */
    sha: string;
    /** Full ref name (e.g., 'refs/heads/main', 'refs/tags/v1.0.0') */
    name: string;
    /** Optional peeled SHA for annotated tags - the SHA of the target object */
    peeled?: string;
}
/**
 * Server capabilities advertised during ref discovery.
 *
 * @description
 * Capabilities determine what features the server supports. Clients select
 * which capabilities to use during the initial handshake. Common capability
 * categories include:
 *
 * - **Negotiation**: `multi_ack`, `multi_ack_detailed` - for efficient fetch negotiation
 * - **Transfer**: `thin-pack`, `ofs-delta` - for efficient packfile transfer
 * - **Communication**: `side-band`, `side-band-64k` - for multiplexed output
 * - **Features**: `shallow`, `filter`, `atomic` - for advanced operations
 *
 * @example
 * ```typescript
 * const capabilities: ServerCapabilities = {
 *   multiAckDetailed: true,
 *   sideBand64k: true,
 *   thinPack: true,
 *   ofsDelta: true,
 *   shallow: true,
 *   reportStatus: true,
 *   deleteRefs: true,
 *   agent: 'my-git-server/1.0'
 * }
 * ```
 *
 * @see {@link https://git-scm.com/docs/protocol-capabilities} Git Protocol Capabilities
 */
export interface ServerCapabilities {
    /** Server supports multi_ack for negotiation optimization */
    multiAck?: boolean;
    /** Server supports multi_ack_detailed for finer-grained negotiation */
    multiAckDetailed?: boolean;
    /** Server supports thin-pack (deltas against objects not in pack) */
    thinPack?: boolean;
    /** Server supports side-band communication (multiplexed output) */
    sideBand?: boolean;
    /** Server supports side-band-64k communication (larger packets) */
    sideBand64k?: boolean;
    /** Server supports ofs-delta (offset-based delta encoding) */
    ofsDelta?: boolean;
    /** Server supports shallow clones (limited history) */
    shallow?: boolean;
    /** Server supports deepen-since (shallow by date) */
    deepenSince?: boolean;
    /** Server supports deepen-not (exclude refs from shallow) */
    deepenNot?: boolean;
    /** Server supports deepen-relative (deepen from current shallow) */
    deepenRelative?: boolean;
    /** Server supports no-progress (suppress progress output) */
    noProgress?: boolean;
    /** Server supports include-tag (auto-send annotated tags) */
    includeTag?: boolean;
    /** Server supports report-status (push status report) */
    reportStatus?: boolean;
    /** Server supports report-status-v2 (enhanced push status) */
    reportStatusV2?: boolean;
    /** Server supports delete-refs (ref deletion via push) */
    deleteRefs?: boolean;
    /** Server supports quiet mode (suppress output) */
    quiet?: boolean;
    /** Server supports atomic pushes (all-or-nothing ref updates) */
    atomic?: boolean;
    /** Server supports push-options (custom push metadata) */
    pushOptions?: boolean;
    /** Server allows fetching tip SHA-1 not in refs */
    allowTipSha1InWant?: boolean;
    /** Server allows fetching reachable SHA-1 not in refs */
    allowReachableSha1InWant?: boolean;
    /** Server's agent identification string */
    agent?: string;
    /** Server supports object-format (sha1/sha256 hash algorithm) */
    objectFormat?: string;
    /** Server supports filter capability (partial clone) */
    filter?: boolean;
}
/**
 * Incoming Smart HTTP request structure.
 *
 * @description
 * Encapsulates all information from an incoming HTTP request that is
 * relevant for Git Smart HTTP processing. This abstraction allows the
 * protocol handlers to be framework-agnostic.
 *
 * @example
 * ```typescript
 * // Converting from Express request
 * const smartRequest: SmartHTTPRequest = {
 *   method: req.method as HTTPMethod,
 *   path: req.path,
 *   query: req.query as Record<string, string>,
 *   headers: req.headers as Record<string, string>,
 *   body: req.body, // Buffer/Uint8Array
 *   repository: req.params.repo
 * }
 * ```
 */
export interface SmartHTTPRequest {
    /** HTTP method (GET or POST) */
    method: HTTPMethod;
    /** Request path (e.g., '/info/refs' or '/git-upload-pack') */
    path: string;
    /** Query parameters as key-value pairs */
    query: Record<string, string>;
    /** HTTP headers as key-value pairs (lowercase keys recommended) */
    headers: Record<string, string>;
    /** Request body as Uint8Array (for POST requests) */
    body?: Uint8Array;
    /** Repository identifier/name extracted from the URL */
    repository: string;
}
/**
 * Outgoing Smart HTTP response structure.
 *
 * @description
 * Contains all information needed to send an HTTP response back to the
 * Git client. The body is always a Uint8Array to handle both text and
 * binary packfile data.
 *
 * @example
 * ```typescript
 * // Converting to Express response
 * const response = await handleInfoRefs(request, repo, caps)
 * res.status(response.status)
 *    .set(response.headers)
 *    .send(Buffer.from(response.body))
 * ```
 */
export interface SmartHTTPResponse {
    /** HTTP status code (e.g., 200, 400, 403, 404) */
    status: number;
    /** HTTP status text (e.g., 'OK', 'Bad Request', 'Not Found') */
    statusText: string;
    /** Response headers to send */
    headers: Record<string, string>;
    /** Response body as Uint8Array */
    body: Uint8Array;
}
/**
 * Error response with specific HTTP status codes.
 *
 * @description
 * Extends the standard Error class with an HTTP status code for
 * proper error handling in HTTP responses.
 */
export interface SmartHTTPError extends Error {
    /** HTTP status code for the error (e.g., 400, 403, 404, 500) */
    statusCode: number;
}
/**
 * Repository interface for Smart HTTP operations.
 *
 * @description
 * This interface defines the contract that a repository implementation must
 * fulfill to support Smart HTTP operations. Implementations typically wrap
 * a Git repository or object store.
 *
 * @example
 * ```typescript
 * class MyRepositoryProvider implements RepositoryProvider {
 *   async getRefs(): Promise<GitRef[]> {
 *     return this.store.listRefs()
 *   }
 *
 *   async exists(): Promise<boolean> {
 *     return this.store.repositoryExists()
 *   }
 *
 *   async hasPermission(service: GitService): Promise<boolean> {
 *     if (service === 'git-receive-pack') {
 *       return this.user.canPush()
 *     }
 *     return this.user.canRead()
 *   }
 *
 *   async uploadPack(wants, haves, caps): Promise<Uint8Array> {
 *     return this.packGenerator.generatePack(wants, haves)
 *   }
 *
 *   async receivePack(packData, commands): Promise<ReceivePackResult> {
 *     return this.refUpdater.processUpdates(packData, commands)
 *   }
 * }
 * ```
 */
export interface RepositoryProvider {
    /**
     * Get all refs in the repository.
     * @returns Promise resolving to array of GitRef objects
     */
    getRefs(): Promise<GitRef[]>;
    /**
     * Check if the repository exists.
     * @returns Promise resolving to true if repository exists
     */
    exists(): Promise<boolean>;
    /**
     * Check if the client has permission for the specified service.
     * @param service - The Git service being requested
     * @returns Promise resolving to true if permission is granted
     */
    hasPermission(service: GitService): Promise<boolean>;
    /**
     * Handle upload-pack (fetch) - generates and returns packfile data.
     * @param wants - SHA-1 hashes of objects the client wants
     * @param haves - SHA-1 hashes of objects the client already has
     * @param capabilities - Client-requested capabilities
     * @returns Promise resolving to packfile data as Uint8Array
     */
    uploadPack(wants: string[], haves: string[], capabilities: string[]): Promise<Uint8Array>;
    /**
     * Handle receive-pack (push) - processes incoming packfile and ref updates.
     * @param packData - Incoming packfile data
     * @param commands - Ref update commands from the client
     * @returns Promise resolving to the result of the push operation
     */
    receivePack(packData: Uint8Array, commands: RefUpdateCommand[]): Promise<ReceivePackResult>;
}
/**
 * Command to update a reference during push.
 *
 * @description
 * Each command describes a single ref update operation:
 * - **Create**: oldSha is ZERO_SHA, newSha is the new commit
 * - **Update**: oldSha is current ref value, newSha is new value
 * - **Delete**: oldSha is current ref value, newSha is ZERO_SHA
 *
 * The oldSha is used for optimistic locking - the server verifies the ref
 * hasn't changed before applying the update.
 *
 * @example
 * ```typescript
 * // Create a new branch
 * const createBranch: RefUpdateCommand = {
 *   oldSha: ZERO_SHA,
 *   newSha: 'abc123...',
 *   refName: 'refs/heads/feature'
 * }
 *
 * // Update existing branch
 * const updateBranch: RefUpdateCommand = {
 *   oldSha: 'abc123...',
 *   newSha: 'def456...',
 *   refName: 'refs/heads/main'
 * }
 *
 * // Delete a branch
 * const deleteBranch: RefUpdateCommand = {
 *   oldSha: 'abc123...',
 *   newSha: ZERO_SHA,
 *   refName: 'refs/heads/old-feature'
 * }
 * ```
 */
export interface RefUpdateCommand {
    /** Old SHA (ZERO_SHA for create operations) */
    oldSha: string;
    /** New SHA (ZERO_SHA for delete operations) */
    newSha: string;
    /** Full ref name (e.g., 'refs/heads/main') */
    refName: string;
}
/**
 * Result of receive-pack operation.
 *
 * @description
 * Contains the overall success status and individual results for each
 * ref update that was requested. Used to generate the status report
 * sent back to the client.
 *
 * @example
 * ```typescript
 * const result: ReceivePackResult = {
 *   success: true,
 *   refResults: [
 *     { refName: 'refs/heads/main', success: true },
 *     { refName: 'refs/heads/feature', success: false, error: 'non-fast-forward' }
 *   ]
 * }
 * ```
 */
export interface ReceivePackResult {
    /** Whether the overall operation succeeded (all refs updated successfully) */
    success: boolean;
    /** Individual ref update results */
    refResults: Array<{
        /** The ref that was being updated */
        refName: string;
        /** Whether this specific ref update succeeded */
        success: boolean;
        /** Error message if the update failed */
        error?: string;
    }>;
}
/**
 * Content-Type for git-upload-pack advertisement response.
 * @see {@link https://git-scm.com/docs/http-protocol#_smart_server_response}
 */
export declare const CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT = "application/x-git-upload-pack-advertisement";
/**
 * Content-Type for git-receive-pack advertisement response.
 * @see {@link https://git-scm.com/docs/http-protocol#_smart_server_response}
 */
export declare const CONTENT_TYPE_RECEIVE_PACK_ADVERTISEMENT = "application/x-git-receive-pack-advertisement";
/**
 * Content-Type for git-upload-pack request body.
 */
export declare const CONTENT_TYPE_UPLOAD_PACK_REQUEST = "application/x-git-upload-pack-request";
/**
 * Content-Type for git-upload-pack response body.
 */
export declare const CONTENT_TYPE_UPLOAD_PACK_RESULT = "application/x-git-upload-pack-result";
/**
 * Content-Type for git-receive-pack request body.
 */
export declare const CONTENT_TYPE_RECEIVE_PACK_REQUEST = "application/x-git-receive-pack-request";
/**
 * Content-Type for git-receive-pack response body.
 */
export declare const CONTENT_TYPE_RECEIVE_PACK_RESULT = "application/x-git-receive-pack-result";
/**
 * Zero SHA constant used for ref creation/deletion.
 *
 * @description
 * This 40-character string of zeros is used as a placeholder SHA:
 * - In oldSha: indicates a ref is being created (doesn't exist yet)
 * - In newSha: indicates a ref is being deleted
 *
 * @example
 * ```typescript
 * // Check if this is a create operation
 * const isCreate = command.oldSha === ZERO_SHA
 *
 * // Check if this is a delete operation
 * const isDelete = command.newSha === ZERO_SHA
 * ```
 */
export declare const ZERO_SHA = "0000000000000000000000000000000000000000";
/**
 * Handle GET /info/refs requests for ref discovery.
 *
 * @description
 * This is the first endpoint called by git clients when initiating a fetch
 * or push operation. It returns:
 * 1. The service being requested
 * 2. A list of all refs with their current SHA values
 * 3. Server capabilities on the first ref line
 *
 * The response format is pkt-line encoded for compatibility with Git's
 * smart HTTP protocol.
 *
 * @param request - The incoming HTTP request
 * @param repository - Repository provider for fetching refs
 * @param capabilities - Optional server capabilities to advertise
 * @returns Promise resolving to HTTP response with ref advertisement
 *
 * @throws {SmartHTTPError} 400 if service parameter is missing or invalid
 * @throws {SmartHTTPError} 403 if permission is denied
 * @throws {SmartHTTPError} 404 if repository does not exist
 *
 * @example
 * ```typescript
 * // Handle ref discovery request
 * const request: SmartHTTPRequest = {
 *   method: 'GET',
 *   path: '/info/refs',
 *   query: { service: 'git-upload-pack' },
 *   headers: {},
 *   repository: 'my-repo'
 * }
 *
 * const capabilities: ServerCapabilities = {
 *   sideBand64k: true,
 *   thinPack: true
 * }
 *
 * const response = await handleInfoRefs(request, repoProvider, capabilities)
 * // response.status === 200
 * // response.headers['Content-Type'] === 'application/x-git-upload-pack-advertisement'
 * ```
 */
export declare function handleInfoRefs(request: SmartHTTPRequest, repository: RepositoryProvider, capabilities?: ServerCapabilities): Promise<SmartHTTPResponse>;
/**
 * Handle POST /git-upload-pack requests for fetch data transfer.
 *
 * @description
 * This endpoint processes fetch requests from git clients. It:
 * 1. Parses the client's wants (objects they need) and haves (objects they have)
 * 2. Negotiates which objects need to be sent
 * 3. Generates and returns a packfile containing the required objects
 *
 * The response includes ACK/NAK lines followed by the packfile data,
 * optionally wrapped in side-band format for progress reporting.
 *
 * @param request - The incoming HTTP request with wants/haves
 * @param repository - Repository provider for creating packfile
 * @returns Promise resolving to HTTP response with packfile data
 *
 * @throws {SmartHTTPError} 400 if request body is missing or malformed
 * @throws {SmartHTTPError} 403 if permission is denied
 * @throws {SmartHTTPError} 415 if content type is invalid
 *
 * @example
 * ```typescript
 * // Handle fetch request
 * const request: SmartHTTPRequest = {
 *   method: 'POST',
 *   path: '/git-upload-pack',
 *   query: {},
 *   headers: { 'Content-Type': 'application/x-git-upload-pack-request' },
 *   body: requestBody, // pkt-line encoded wants/haves
 *   repository: 'my-repo'
 * }
 *
 * const response = await handleUploadPack(request, repoProvider)
 * // response.body contains NAK + packfile data
 * ```
 */
export declare function handleUploadPack(request: SmartHTTPRequest, repository: RepositoryProvider): Promise<SmartHTTPResponse>;
/**
 * Handle POST /git-receive-pack requests for push data transfer.
 *
 * @description
 * This endpoint processes push requests from git clients. It:
 * 1. Parses ref update commands (create, update, delete)
 * 2. Extracts and validates the incoming packfile
 * 3. Applies ref updates (if packfile is valid)
 * 4. Returns a status report (if report-status capability was requested)
 *
 * The response includes unpack status and individual ref update results.
 *
 * @param request - The incoming HTTP request with commands and packfile
 * @param repository - Repository provider for processing push
 * @returns Promise resolving to HTTP response with status report
 *
 * @throws {SmartHTTPError} 400 if request body is missing or malformed
 * @throws {SmartHTTPError} 403 if permission is denied
 * @throws {SmartHTTPError} 415 if content type is invalid
 *
 * @example
 * ```typescript
 * // Handle push request
 * const request: SmartHTTPRequest = {
 *   method: 'POST',
 *   path: '/git-receive-pack',
 *   query: {},
 *   headers: { 'Content-Type': 'application/x-git-receive-pack-request' },
 *   body: requestBody, // commands + packfile
 *   repository: 'my-repo'
 * }
 *
 * const response = await handleReceivePack(request, repoProvider)
 * // response.body contains "unpack ok" + ref status lines
 * ```
 */
export declare function handleReceivePack(request: SmartHTTPRequest, repository: RepositoryProvider): Promise<SmartHTTPResponse>;
/**
 * Format ref advertisement for info/refs response.
 *
 * @description
 * Creates a pkt-line formatted ref advertisement that includes:
 * 1. Service announcement line (e.g., "# service=git-upload-pack")
 * 2. Flush packet
 * 3. First ref with capabilities (or zero SHA for empty repos)
 * 4. Remaining refs
 * 5. Peeled refs for annotated tags
 * 6. Final flush packet
 *
 * @param service - The git service (git-upload-pack or git-receive-pack)
 * @param refs - Array of refs to advertise
 * @param capabilities - Optional server capabilities to include
 * @returns Formatted ref advertisement as Uint8Array
 *
 * @example
 * ```typescript
 * const refs: GitRef[] = [
 *   { sha: 'abc123...', name: 'refs/heads/main' },
 *   { sha: 'def456...', name: 'refs/heads/feature' }
 * ]
 *
 * const advertisement = formatRefAdvertisement(
 *   'git-upload-pack',
 *   refs,
 *   { sideBand64k: true, thinPack: true }
 * )
 * ```
 */
export declare function formatRefAdvertisement(service: GitService, refs: GitRef[], capabilities?: ServerCapabilities): Uint8Array;
/**
 * Parse upload-pack request body.
 *
 * @description
 * Extracts wants, haves, and capabilities from the pkt-line formatted
 * request body sent by git fetch. The format is:
 * 1. Want lines: "want <sha> [capabilities]" (caps only on first)
 * 2. Shallow/filter commands (optional)
 * 3. Flush packet
 * 4. Have lines: "have <sha>"
 * 5. "done" line (or flush for multi_ack)
 *
 * @param body - Request body as Uint8Array
 * @returns Parsed wants, haves, capabilities, and done flag
 *
 * @throws {Error} If the request is malformed (invalid pkt-line length prefix)
 *
 * @example
 * ```typescript
 * const body = encoder.encode(
 *   '0032want abc123... side-band-64k\n' +
 *   '0000' +
 *   '0032have def456...\n' +
 *   '0009done\n'
 * )
 *
 * const { wants, haves, capabilities, done } = parseUploadPackRequest(body)
 * // wants = ['abc123...']
 * // haves = ['def456...']
 * // capabilities = ['side-band-64k']
 * // done = true
 * ```
 */
export declare function parseUploadPackRequest(body: Uint8Array): {
    wants: string[];
    haves: string[];
    capabilities: string[];
    done: boolean;
};
/**
 * Parse receive-pack request body.
 *
 * @description
 * Extracts ref update commands, capabilities, and packfile data from
 * the request body sent by git push. The format is:
 * 1. Command lines: "<old-sha> <new-sha> <refname>" (caps on first via NUL)
 * 2. Flush packet
 * 3. Push options (optional, if push-options capability)
 * 4. Flush packet (if push options present)
 * 5. PACK data (packfile)
 *
 * @param body - Request body as Uint8Array
 * @returns Parsed commands, capabilities, and packfile
 *
 * @throws {Error} If the pkt-line length prefix is incomplete or invalid
 * @throws {Error} If the pkt-line packet data is incomplete
 *
 * @example
 * ```typescript
 * const body = encoder.encode(
 *   '0077' + ZERO_SHA + ' abc123... refs/heads/new\0report-status\n' +
 *   '0000' +
 *   'PACK...' // packfile data
 * )
 *
 * const { commands, capabilities, packfile } = parseReceivePackRequest(body)
 * // commands = [{ oldSha: ZERO_SHA, newSha: 'abc123...', refName: 'refs/heads/new' }]
 * // capabilities = ['report-status']
 * ```
 */
export declare function parseReceivePackRequest(body: Uint8Array): {
    commands: RefUpdateCommand[];
    capabilities: string[];
    packfile: Uint8Array;
};
/**
 * Format upload-pack response.
 *
 * @description
 * Creates the response body for git-upload-pack POST request,
 * including NAK/ACK responses and packfile data with optional sideband.
 * The response format is:
 * 1. NAK or ACK lines (based on negotiation)
 * 2. Packfile data (optionally wrapped in side-band)
 * 3. Flush packet
 *
 * @param packData - The packfile data to send
 * @param useSideBand - Whether to use side-band encoding (channel 1 for data)
 * @param hasCommonObjects - Whether there are common objects (for ACK vs NAK)
 * @param haves - The have SHAs from the client (first one is ACKed if common)
 * @returns Formatted response as Uint8Array
 *
 * @example
 * ```typescript
 * // Simple NAK response with packfile
 * const response = formatUploadPackResponse(packData, false, false, [])
 *
 * // Side-band response with ACK
 * const response = formatUploadPackResponse(
 *   packData,
 *   true,
 *   true,
 *   ['abc123...']
 * )
 * ```
 */
export declare function formatUploadPackResponse(packData: Uint8Array, useSideBand?: boolean, hasCommonObjects?: boolean, haves?: string[]): Uint8Array;
/**
 * Format receive-pack response.
 *
 * @description
 * Creates the response body for git-receive-pack POST request,
 * including unpack status and ref update results. The format is:
 * 1. Unpack status line: "unpack ok" or "unpack error"
 * 2. Ref status lines: "ok <refname>" or "ng <refname> <error>"
 * 3. Flush packet
 *
 * @param result - Result of the receive-pack operation
 * @returns Formatted response as Uint8Array
 *
 * @example
 * ```typescript
 * const result: ReceivePackResult = {
 *   success: true,
 *   refResults: [
 *     { refName: 'refs/heads/main', success: true },
 *     { refName: 'refs/heads/feature', success: false, error: 'non-fast-forward' }
 *   ]
 * }
 *
 * const response = formatReceivePackResponse(result)
 * // "unpack ok\nok refs/heads/main\nng refs/heads/feature non-fast-forward\n0000"
 * ```
 */
export declare function formatReceivePackResponse(result: ReceivePackResult): Uint8Array;
/**
 * Convert ServerCapabilities to capability string list.
 *
 * @description
 * Converts the ServerCapabilities object into an array of capability
 * strings suitable for inclusion in ref advertisements. Boolean capabilities
 * become simple strings, while capabilities with values become "name=value".
 *
 * @param capabilities - Server capabilities object
 * @returns Array of capability strings
 *
 * @example
 * ```typescript
 * const caps: ServerCapabilities = {
 *   sideBand64k: true,
 *   thinPack: true,
 *   agent: 'my-server/1.0'
 * }
 *
 * const strings = capabilitiesToStrings(caps)
 * // ['side-band-64k', 'thin-pack', 'agent=my-server/1.0']
 * ```
 */
export declare function capabilitiesToStrings(capabilities: ServerCapabilities): string[];
/**
 * Parse capability strings into ServerCapabilities object.
 *
 * @description
 * Converts an array of capability strings (as received from a client or
 * server) into a structured ServerCapabilities object for easier access.
 *
 * @param capStrings - Array of capability strings
 * @returns Parsed capabilities object
 *
 * @example
 * ```typescript
 * const strings = ['side-band-64k', 'thin-pack', 'agent=git/2.30.0']
 * const caps = parseCapabilities(strings)
 * // caps.sideBand64k === true
 * // caps.thinPack === true
 * // caps.agent === 'git/2.30.0'
 * ```
 */
export declare function parseCapabilities(capStrings: string[]): ServerCapabilities;
/**
 * Validate Content-Type header for a request.
 *
 * @description
 * Compares the provided Content-Type header against an expected value,
 * handling case-insensitivity and stripping charset or other parameters.
 *
 * @param contentType - The Content-Type header value from the request
 * @param expectedType - The expected Content-Type
 * @returns true if the content type matches, false otherwise
 *
 * @example
 * ```typescript
 * validateContentType(
 *   'application/x-git-upload-pack-request; charset=utf-8',
 *   'application/x-git-upload-pack-request'
 * )
 * // Returns true
 *
 * validateContentType('text/plain', 'application/x-git-upload-pack-request')
 * // Returns false
 * ```
 */
export declare function validateContentType(contentType: string | undefined, expectedType: string): boolean;
/**
 * Create an error response with appropriate status code and message.
 *
 * @description
 * Helper function to create a properly formatted error response with
 * the correct HTTP status code, status text, and plain text body.
 *
 * @param statusCode - HTTP status code (e.g., 400, 403, 404)
 * @param message - Error message to include in the response body
 * @returns SmartHTTPResponse with error information
 *
 * @example
 * ```typescript
 * const response = createErrorResponse(404, 'Repository not found')
 * // response.status === 404
 * // response.statusText === 'Not Found'
 * // response.headers['Content-Type'] === 'text/plain'
 * // response.body contains 'Repository not found'
 * ```
 */
export declare function createErrorResponse(statusCode: number, message: string): SmartHTTPResponse;
//# sourceMappingURL=smart-http.d.ts.map