/**
 * @fileoverview LFS batch API route handlers for GitRepoDO.
 *
 * Implements Git LFS (Large File Storage) support for GitX:
 * - Batch API endpoint for checking object availability
 * - Upload endpoint for storing LFS objects in R2
 * - Download endpoint for retrieving LFS objects from R2
 *
 * Git LFS Protocol:
 * 1. Client sends batch request to /objects/batch with list of objects
 * 2. Server responds with URLs for upload/download of each object
 * 3. Client uploads/downloads objects directly to those URLs
 *
 * @see https://github.com/git-lfs/git-lfs/blob/main/docs/api/batch.md
 *
 * @module do/lfs-routes
 */
import type { Hono } from 'hono';
import type { GitRepoDOInstance, RouteContext } from './routes';
/**
 * LFS batch API endpoint handler.
 *
 * @description
 * Handles Git LFS batch API requests for download/upload operations.
 * This endpoint is used by git-lfs clients to check object availability
 * and get URLs for direct R2 access.
 *
 * Request format:
 * ```json
 * {
 *   "operation": "download" | "upload",
 *   "objects": [{ "oid": "sha256...", "size": 12345 }]
 * }
 * ```
 *
 * Response format:
 * ```json
 * {
 *   "transfer": "basic",
 *   "objects": [{
 *     "oid": "sha256...",
 *     "size": 12345,
 *     "actions": {
 *       "download": { "href": "...", "expires_in": 3600 }
 *     }
 *   }]
 * }
 * ```
 *
 * @param c - Hono context
 * @param instance - GitRepoDO instance
 * @returns LFS batch response
 */
export declare function handleLfsBatch(c: RouteContext, instance: GitRepoDOInstance): Promise<Response>;
/**
 * LFS object upload handler.
 *
 * @description
 * Handles PUT requests to upload LFS objects to R2 storage.
 * The OID (sha256 hash) is extracted from the URL path.
 *
 * @param c - Hono context
 * @param instance - GitRepoDO instance
 * @returns Empty response with 200 on success
 */
export declare function handleLfsUpload(c: RouteContext, instance: GitRepoDOInstance): Promise<Response>;
/**
 * LFS object download handler.
 *
 * @description
 * Handles GET requests to download LFS objects from R2 storage.
 * The OID (sha256 hash) is extracted from the URL path.
 *
 * @param c - Hono context
 * @param instance - GitRepoDO instance
 * @returns Binary response with object data
 */
export declare function handleLfsDownload(c: RouteContext, instance: GitRepoDOInstance): Promise<Response>;
/**
 * LFS object verification handler.
 *
 * @description
 * Handles POST requests to verify LFS object uploads.
 * This endpoint is called after upload to confirm the object was stored correctly.
 *
 * @param c - Hono context
 * @param instance - GitRepoDO instance
 * @returns Empty response with 200 on success, 404 if not found
 */
export declare function handleLfsVerify(c: RouteContext, instance: GitRepoDOInstance): Promise<Response>;
/**
 * Setup LFS routes on a Hono router.
 *
 * @description
 * Registers all LFS-related routes:
 * - POST /objects/batch - Batch API for checking availability
 * - PUT /lfs/objects/:oid - Upload LFS object
 * - GET /lfs/objects/:oid - Download LFS object
 * - POST /lfs/verify - Verify uploaded object
 *
 * @param router - Hono router instance
 * @param instance - GitRepoDO instance
 */
export declare function setupLfsRoutes(router: Hono<{
    Bindings: Record<string, unknown>;
}>, instance: GitRepoDOInstance): void;
//# sourceMappingURL=lfs-routes.d.ts.map