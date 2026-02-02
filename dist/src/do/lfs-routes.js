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
import { LfsInterop, } from '../storage/lfs-interop';
// ============================================================================
// LFS Instance Cache
// ============================================================================
// WeakMap to cache LfsInterop instances per GitRepoDO instance
const lfsInteropCache = new WeakMap();
/**
 * Get or create an LfsInterop instance for a GitRepoDO.
 *
 * @param instance - GitRepoDO instance
 * @param baseUrl - Base URL for generating LFS object URLs
 * @returns LfsInterop instance or null if R2 bucket is not configured
 */
function getLfsInterop(instance, baseUrl) {
    // Check cache first
    const cached = lfsInteropCache.get(instance);
    if (cached) {
        return cached;
    }
    // Get R2 bucket from instance
    const bucket = instance.getAnalyticsBucket();
    if (!bucket) {
        return null;
    }
    // Create and cache new LfsInterop instance
    const lfsInterop = new LfsInterop(bucket, {
        prefix: 'lfs',
        baseUrl,
    });
    lfsInteropCache.set(instance, lfsInterop);
    return lfsInterop;
}
// ============================================================================
// Route Handlers
// ============================================================================
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
export async function handleLfsBatch(c, instance) {
    try {
        // Set LFS-specific headers
        c.header('Content-Type', 'application/vnd.git-lfs+json');
        const body = await c.req.json();
        // Validate request
        if (!body.operation || !['download', 'upload'].includes(body.operation)) {
            return c.json({ message: 'Invalid operation. Must be "download" or "upload".' }, 422);
        }
        if (!body.objects || !Array.isArray(body.objects) || body.objects.length === 0) {
            return c.json({ message: 'Objects array is required and must not be empty.' }, 422);
        }
        // Validate each object has required fields
        for (const obj of body.objects) {
            if (!obj.oid || typeof obj.oid !== 'string' || obj.oid.length !== 64) {
                return c.json({ message: `Invalid oid: ${obj.oid}. Must be a 64-character SHA256 hash.` }, 422);
            }
            if (typeof obj.size !== 'number' || obj.size < 0) {
                return c.json({ message: `Invalid size for oid ${obj.oid}. Must be a non-negative number.` }, 422);
            }
        }
        // Build base URL for LFS object endpoints
        const url = new URL(c.req.url);
        const baseUrl = `${url.protocol}//${url.host}/lfs/objects`;
        // Get LfsInterop instance
        const lfsInterop = getLfsInterop(instance, baseUrl);
        if (!lfsInterop) {
            // R2 bucket not configured - return error for all objects
            const response = {
                transfer: 'basic',
                objects: body.objects.map(obj => ({
                    oid: obj.oid,
                    size: obj.size,
                    error: { code: 507, message: 'LFS storage not configured' },
                })),
            };
            return c.json(response, 507);
        }
        // Process batch request
        const response = await lfsInterop.handleBatchRequest(body);
        return c.json(response, 200);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'LFS batch request failed';
        return c.json({ message }, 500);
    }
}
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
export async function handleLfsUpload(c, instance) {
    try {
        const oid = c.req.param('oid');
        // Validate OID format (64-character SHA256 hex string)
        if (!oid || !/^[0-9a-f]{64}$/.test(oid)) {
            return c.json({ message: 'Invalid OID. Must be a 64-character lowercase hex SHA256 hash.' }, 400);
        }
        // Get LfsInterop instance
        const url = new URL(c.req.url);
        const baseUrl = `${url.protocol}//${url.host}/lfs/objects`;
        const lfsInterop = getLfsInterop(instance, baseUrl);
        if (!lfsInterop) {
            return c.json({ message: 'LFS storage not configured' }, 507);
        }
        // Read request body as binary data
        const data = new Uint8Array(await c.req.arrayBuffer());
        // Upload to R2
        await lfsInterop.uploadLfsObject(oid, data);
        // Return success with no content
        return new Response(null, { status: 200 });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'LFS upload failed';
        return c.json({ message }, 500);
    }
}
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
export async function handleLfsDownload(c, instance) {
    try {
        const oid = c.req.param('oid');
        // Validate OID format (64-character SHA256 hex string)
        if (!oid || !/^[0-9a-f]{64}$/.test(oid)) {
            return c.json({ message: 'Invalid OID. Must be a 64-character lowercase hex SHA256 hash.' }, 400);
        }
        // Get LfsInterop instance
        const url = new URL(c.req.url);
        const baseUrl = `${url.protocol}//${url.host}/lfs/objects`;
        const lfsInterop = getLfsInterop(instance, baseUrl);
        if (!lfsInterop) {
            return c.json({ message: 'LFS storage not configured' }, 507);
        }
        // Download from R2
        const data = await lfsInterop.downloadLfsObject(oid);
        if (!data) {
            return c.json({ message: 'Object not found' }, 404);
        }
        // Return binary data with appropriate headers
        return new Response(data, {
            status: 200,
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Length': data.length.toString(),
                'X-LFS-OID': oid,
            },
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'LFS download failed';
        return c.json({ message }, 500);
    }
}
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
export async function handleLfsVerify(c, instance) {
    try {
        const body = await c.req.json();
        // Validate request
        if (!body.oid || !/^[0-9a-f]{64}$/.test(body.oid)) {
            return c.json({ message: 'Invalid OID. Must be a 64-character lowercase hex SHA256 hash.' }, 400);
        }
        // Get LfsInterop instance
        const url = new URL(c.req.url);
        const baseUrl = `${url.protocol}//${url.host}/lfs/objects`;
        const lfsInterop = getLfsInterop(instance, baseUrl);
        if (!lfsInterop) {
            return c.json({ message: 'LFS storage not configured' }, 507);
        }
        // Check if object exists
        const exists = await lfsInterop.existsLfsObject(body.oid);
        if (!exists) {
            return c.json({ message: 'Object not found' }, 404);
        }
        // Return success with no content
        return new Response(null, { status: 200 });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'LFS verify failed';
        return c.json({ message }, 500);
    }
}
// ============================================================================
// Route Setup
// ============================================================================
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
export function setupLfsRoutes(router, instance) {
    // Batch API endpoint (required by Git LFS spec)
    router.post('/objects/batch', (c) => handleLfsBatch(c, instance));
    // Upload endpoint (PUT to store object)
    router.put('/lfs/objects/:oid', (c) => handleLfsUpload(c, instance));
    // Download endpoint (GET to retrieve object)
    router.get('/lfs/objects/:oid', (c) => handleLfsDownload(c, instance));
    // Verify endpoint (POST to confirm upload)
    router.post('/lfs/verify', (c) => handleLfsVerify(c, instance));
}
//# sourceMappingURL=lfs-routes.js.map