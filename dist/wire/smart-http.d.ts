/**
 * Git Smart HTTP Protocol Implementation
 *
 * Implements the Git Smart HTTP protocol for server-side handling of:
 * - Fetch discovery (GET /info/refs?service=git-upload-pack)
 * - Push discovery (GET /info/refs?service=git-receive-pack)
 * - Fetch data transfer (POST /git-upload-pack)
 * - Push data transfer (POST /git-receive-pack)
 *
 * Reference: https://git-scm.com/docs/http-protocol
 */
/**
 * Supported Git Smart HTTP services
 */
export type GitService = 'git-upload-pack' | 'git-receive-pack';
/**
 * HTTP methods supported by the Smart HTTP protocol
 */
export type HTTPMethod = 'GET' | 'POST';
/**
 * Represents a Git reference (branch, tag, etc.)
 */
export interface GitRef {
    /** SHA-1 hash of the object this ref points to */
    sha: string;
    /** Full ref name (e.g., 'refs/heads/main') */
    name: string;
    /** Optional peeled SHA for annotated tags */
    peeled?: string;
}
/**
 * Server capabilities advertised during ref discovery
 */
export interface ServerCapabilities {
    /** Server supports multi_ack */
    multiAck?: boolean;
    /** Server supports multi_ack_detailed */
    multiAckDetailed?: boolean;
    /** Server supports thin-pack */
    thinPack?: boolean;
    /** Server supports side-band communication */
    sideBand?: boolean;
    /** Server supports side-band-64k communication */
    sideBand64k?: boolean;
    /** Server supports ofs-delta */
    ofsDelta?: boolean;
    /** Server supports shallow clones */
    shallow?: boolean;
    /** Server supports deepen-since */
    deepenSince?: boolean;
    /** Server supports deepen-not */
    deepenNot?: boolean;
    /** Server supports deepen-relative */
    deepenRelative?: boolean;
    /** Server supports no-progress */
    noProgress?: boolean;
    /** Server supports include-tag */
    includeTag?: boolean;
    /** Server supports report-status */
    reportStatus?: boolean;
    /** Server supports report-status-v2 */
    reportStatusV2?: boolean;
    /** Server supports delete-refs */
    deleteRefs?: boolean;
    /** Server supports quiet mode */
    quiet?: boolean;
    /** Server supports atomic pushes */
    atomic?: boolean;
    /** Server supports push-options */
    pushOptions?: boolean;
    /** Server allows tips with SHA-1 hashes that start with all-zeros */
    allowTipSha1InWant?: boolean;
    /** Server allows reachable SHA-1 hashes */
    allowReachableSha1InWant?: boolean;
    /** Server's agent string */
    agent?: string;
    /** Server supports object-format (sha1/sha256) */
    objectFormat?: string;
    /** Server supports filter capability */
    filter?: boolean;
}
/**
 * Incoming Smart HTTP request
 */
export interface SmartHTTPRequest {
    /** HTTP method (GET or POST) */
    method: HTTPMethod;
    /** Request path (e.g., '/info/refs' or '/git-upload-pack') */
    path: string;
    /** Query parameters */
    query: Record<string, string>;
    /** HTTP headers */
    headers: Record<string, string>;
    /** Request body as Uint8Array (for POST requests) */
    body?: Uint8Array;
    /** Repository identifier/name */
    repository: string;
}
/**
 * Outgoing Smart HTTP response
 */
export interface SmartHTTPResponse {
    /** HTTP status code */
    status: number;
    /** HTTP status text */
    statusText: string;
    /** Response headers */
    headers: Record<string, string>;
    /** Response body as Uint8Array */
    body: Uint8Array;
}
/**
 * Error response with specific HTTP status codes
 */
export interface SmartHTTPError extends Error {
    /** HTTP status code for the error */
    statusCode: number;
}
/**
 * Repository interface for Smart HTTP operations
 * This interface defines the methods needed from a repository to support Smart HTTP
 */
export interface RepositoryProvider {
    /** Get all refs in the repository */
    getRefs(): Promise<GitRef[]>;
    /** Check if repository exists */
    exists(): Promise<boolean>;
    /** Check if client has permission for service */
    hasPermission(service: GitService): Promise<boolean>;
    /** Handle upload-pack (fetch) - returns packfile data */
    uploadPack(wants: string[], haves: string[], capabilities: string[]): Promise<Uint8Array>;
    /** Handle receive-pack (push) - processes incoming packfile */
    receivePack(packData: Uint8Array, commands: RefUpdateCommand[]): Promise<ReceivePackResult>;
}
/**
 * Command to update a reference during push
 */
export interface RefUpdateCommand {
    /** Old SHA (zero hash for create) */
    oldSha: string;
    /** New SHA (zero hash for delete) */
    newSha: string;
    /** Full ref name */
    refName: string;
}
/**
 * Result of receive-pack operation
 */
export interface ReceivePackResult {
    /** Whether the overall operation succeeded */
    success: boolean;
    /** Individual ref update results */
    refResults: Array<{
        refName: string;
        success: boolean;
        error?: string;
    }>;
}
/**
 * Content-Type for git-upload-pack advertisement
 */
export declare const CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT = "application/x-git-upload-pack-advertisement";
/**
 * Content-Type for git-receive-pack advertisement
 */
export declare const CONTENT_TYPE_RECEIVE_PACK_ADVERTISEMENT = "application/x-git-receive-pack-advertisement";
/**
 * Content-Type for git-upload-pack request
 */
export declare const CONTENT_TYPE_UPLOAD_PACK_REQUEST = "application/x-git-upload-pack-request";
/**
 * Content-Type for git-upload-pack result
 */
export declare const CONTENT_TYPE_UPLOAD_PACK_RESULT = "application/x-git-upload-pack-result";
/**
 * Content-Type for git-receive-pack request
 */
export declare const CONTENT_TYPE_RECEIVE_PACK_REQUEST = "application/x-git-receive-pack-request";
/**
 * Content-Type for git-receive-pack result
 */
export declare const CONTENT_TYPE_RECEIVE_PACK_RESULT = "application/x-git-receive-pack-result";
/**
 * Zero SHA constant used for ref creation/deletion
 */
export declare const ZERO_SHA = "0000000000000000000000000000000000000000";
/**
 * Handle GET /info/refs requests for ref discovery.
 *
 * This endpoint is called by git clients to discover refs and capabilities
 * before performing fetch or push operations.
 *
 * @param request - The incoming HTTP request
 * @param repository - Repository provider for fetching refs
 * @param capabilities - Server capabilities to advertise
 * @returns HTTP response with ref advertisement
 * @throws SmartHTTPError for invalid requests or repository errors
 */
export declare function handleInfoRefs(request: SmartHTTPRequest, repository: RepositoryProvider, capabilities?: ServerCapabilities): Promise<SmartHTTPResponse>;
/**
 * Handle POST /git-upload-pack requests for fetch data transfer.
 *
 * This endpoint receives the client's wants/haves and returns a packfile
 * containing the requested objects.
 *
 * @param request - The incoming HTTP request with wants/haves
 * @param repository - Repository provider for creating packfile
 * @returns HTTP response with packfile data
 * @throws SmartHTTPError for invalid requests or repository errors
 */
export declare function handleUploadPack(request: SmartHTTPRequest, repository: RepositoryProvider): Promise<SmartHTTPResponse>;
/**
 * Handle POST /git-receive-pack requests for push data transfer.
 *
 * This endpoint receives ref update commands and a packfile from the client,
 * updates refs accordingly, and returns a status report.
 *
 * @param request - The incoming HTTP request with commands and packfile
 * @param repository - Repository provider for processing push
 * @returns HTTP response with status report
 * @throws SmartHTTPError for invalid requests or repository errors
 */
export declare function handleReceivePack(request: SmartHTTPRequest, repository: RepositoryProvider): Promise<SmartHTTPResponse>;
/**
 * Format ref advertisement for info/refs response.
 *
 * Creates pkt-line formatted ref advertisement including:
 * - Service header
 * - Capability advertisement on first ref
 * - All refs with their SHAs
 * - Flush packet
 *
 * @param service - The git service (git-upload-pack or git-receive-pack)
 * @param refs - Array of refs to advertise
 * @param capabilities - Server capabilities to include
 * @returns Formatted ref advertisement as Uint8Array
 */
export declare function formatRefAdvertisement(service: GitService, refs: GitRef[], capabilities?: ServerCapabilities): Uint8Array;
/**
 * Parse upload-pack request body.
 *
 * Extracts wants, haves, and capabilities from the pkt-line formatted
 * request body sent by git fetch.
 *
 * @param body - Request body as Uint8Array
 * @returns Parsed wants, haves, and capabilities
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
 * Extracts ref update commands, capabilities, and packfile data from
 * the request body sent by git push.
 *
 * @param body - Request body as Uint8Array
 * @returns Parsed commands, capabilities, and packfile
 */
export declare function parseReceivePackRequest(body: Uint8Array): {
    commands: RefUpdateCommand[];
    capabilities: string[];
    packfile: Uint8Array;
};
/**
 * Format upload-pack response.
 *
 * Creates the response body for git-upload-pack POST request,
 * including NAK/ACK responses and packfile data with optional sideband.
 *
 * @param packData - The packfile data to send
 * @param useSideBand - Whether to use side-band encoding
 * @param hasCommonObjects - Whether there are common objects (for ACK vs NAK)
 * @param haves - The have SHAs from the client
 * @returns Formatted response as Uint8Array
 */
export declare function formatUploadPackResponse(packData: Uint8Array, useSideBand?: boolean, hasCommonObjects?: boolean, haves?: string[]): Uint8Array;
/**
 * Format receive-pack response.
 *
 * Creates the response body for git-receive-pack POST request,
 * including unpack status and ref update results.
 *
 * @param result - Result of the receive-pack operation
 * @returns Formatted response as Uint8Array
 */
export declare function formatReceivePackResponse(result: ReceivePackResult): Uint8Array;
/**
 * Convert ServerCapabilities to capability string list.
 *
 * @param capabilities - Server capabilities object
 * @returns Array of capability strings
 */
export declare function capabilitiesToStrings(capabilities: ServerCapabilities): string[];
/**
 * Parse capability strings into ServerCapabilities object.
 *
 * @param capStrings - Array of capability strings
 * @returns Parsed capabilities object
 */
export declare function parseCapabilities(capStrings: string[]): ServerCapabilities;
/**
 * Validate Content-Type header for a request.
 *
 * @param contentType - The Content-Type header value
 * @param expectedType - The expected Content-Type
 * @returns true if valid, false otherwise
 */
export declare function validateContentType(contentType: string | undefined, expectedType: string): boolean;
/**
 * Create an error response with appropriate status code and message.
 *
 * @param statusCode - HTTP status code
 * @param message - Error message
 * @returns SmartHTTPResponse with error
 */
export declare function createErrorResponse(statusCode: number, message: string): SmartHTTPResponse;
//# sourceMappingURL=smart-http.d.ts.map