/**
 * @fileoverview FSX (Filesystem Extension) Service Binding Adapter
 *
 * Creates an FsCapability adapter that proxies filesystem operations
 * to the fsx-do worker service binding.
 *
 * @module do/fsx-adapter
 */
/**
 * Creates an FsCapability adapter that uses the FSX service binding.
 * All filesystem operations are proxied to the fsx-do worker.
 *
 * @param fsx - The FSX service binding
 * @param namespace - The namespace (typically DO ID) for FSX operations
 * @returns FsCapability interface for filesystem operations
 */
export function createFsxAdapter(fsx, namespace) {
    const baseUrl = `https://fsx.do/${namespace}`;
    return {
        readFile: (path) => fsxReadFile(fsx, baseUrl, path),
        writeFile: (path, content) => fsxWriteFile(fsx, baseUrl, path, content),
        readDir: (path) => fsxReadDir(fsx, baseUrl, path),
        exists: (path) => fsxExists(fsx, baseUrl, path),
        mkdir: (path, options) => fsxMkdir(fsx, baseUrl, path, options),
        rm: (path, options) => fsxRm(fsx, baseUrl, path, options),
        getFileId: (path) => fsxGetFileId(fsx, baseUrl, path),
    };
}
/**
 * Read a file from the FSX service.
 */
async function fsxReadFile(fsx, baseUrl, path) {
    const response = await fsx.fetch(`${baseUrl}${path}`, { method: 'GET' });
    if (!response.ok) {
        throw new Error(`Failed to read file: ${path} (${response.status})`);
    }
    return response.text();
}
/**
 * Write content to a file via the FSX service.
 */
async function fsxWriteFile(fsx, baseUrl, path, content) {
    const body = typeof content === 'string' ? content : new Uint8Array(content);
    const response = await fsx.fetch(`${baseUrl}${path}`, {
        method: 'PUT',
        body,
        headers: { 'Content-Type': 'application/octet-stream' },
    });
    if (!response.ok) {
        throw new Error(`Failed to write file: ${path} (${response.status})`);
    }
}
/**
 * Read directory entries from the FSX service.
 */
async function fsxReadDir(fsx, baseUrl, path) {
    const response = await fsx.fetch(`${baseUrl}${path}?list=true`, { method: 'GET' });
    if (!response.ok) {
        throw new Error(`Failed to read directory: ${path} (${response.status})`);
    }
    const data = (await response.json());
    return data.entries ?? [];
}
/**
 * Check if a path exists in the FSX service.
 */
async function fsxExists(fsx, baseUrl, path) {
    const response = await fsx.fetch(`${baseUrl}${path}`, { method: 'HEAD' });
    return response.ok;
}
/**
 * Create a directory via the FSX service.
 */
async function fsxMkdir(fsx, baseUrl, path, options) {
    const url = new URL(`${baseUrl}${path}`);
    if (options?.recursive)
        url.searchParams.set('recursive', 'true');
    const response = await fsx.fetch(url.toString(), {
        method: 'POST',
        headers: { 'X-Operation': 'mkdir' },
    });
    if (!response.ok && response.status !== 409) {
        throw new Error(`Failed to create directory: ${path} (${response.status})`);
    }
}
/**
 * Remove a file or directory via the FSX service.
 */
async function fsxRm(fsx, baseUrl, path, options) {
    const url = new URL(`${baseUrl}${path}`);
    if (options?.recursive)
        url.searchParams.set('recursive', 'true');
    if (options?.force)
        url.searchParams.set('force', 'true');
    const response = await fsx.fetch(url.toString(), { method: 'DELETE' });
    if (!response.ok && !(options?.force && response.status === 404)) {
        throw new Error(`Failed to remove: ${path} (${response.status})`);
    }
}
/**
 * Get the file ID for a path from the FSX service.
 */
async function fsxGetFileId(fsx, baseUrl, path) {
    const response = await fsx.fetch(`${baseUrl}${path}?meta=true`, { method: 'GET' });
    if (!response.ok)
        return null;
    const data = (await response.json());
    return data.id ?? null;
}
//# sourceMappingURL=fsx-adapter.js.map