/**
 * Git MCP Server Factory
 *
 * Creates MCP server instances for git operations.
 * Provides a high-level API compatible with the MCP specification.
 *
 * ## Architecture
 *
 * The MCP server exposes git operations through three primitives:
 *
 * 1. **search** - Search git history, branches, tags
 * 2. **fetch** - Fetch specific commits, files, or refs
 * 3. **do** - Execute git operations via sandboxed TypeScript
 *
 * Plus individual git tools (git_status, git_commit, etc.) for direct access.
 *
 * ## Usage
 *
 * ```typescript
 * import { createGitMCPServer } from 'gitx.do/mcp'
 *
 * const server = createGitMCPServer({
 *   name: 'my-git-server',
 *   auth: {
 *     introspectionUrl: 'https://oauth.do/introspect',
 *     clientId: env.OAUTH_CLIENT_ID,
 *     clientSecret: env.OAUTH_CLIENT_SECRET,
 *   },
 *   repository: gitRepo, // GitRepoDO instance or context
 * })
 *
 * // Start server with transport
 * await server.connect(transport)
 * ```
 *
 * @module mcp/server
 */
import { Hono } from 'hono';
import { gitAuthMiddleware, requireGitWrite } from './auth';
import { getToolRegistry, invokeTool } from './tool-registry';
import { requiresWriteAccess } from './tools';
/**
 * Create a Git MCP server
 */
export function createGitMCPServer(options = {}) {
    const { name = 'gitx.do', version = '1.0.0', auth, repository } = options;
    const app = new Hono();
    // Apply auth middleware if configured
    if (auth) {
        app.use('/*', gitAuthMiddleware(auth));
    }
    // ==========================================================================
    // MCP Protocol Endpoints
    // ==========================================================================
    // MCP Initialize
    app.post('/mcp/initialize', async (c) => {
        return c.json({
            protocolVersion: '2024-11-05',
            serverInfo: { name, version },
            capabilities: {
                tools: {},
                resources: {},
            },
        });
    });
    // MCP List Tools
    app.post('/mcp/tools/list', async (c) => {
        const registry = getToolRegistry();
        return c.json({
            tools: registry.schemas().map(schema => ({
                name: schema.name,
                description: schema.description,
                inputSchema: schema.inputSchema,
            })),
        });
    });
    // MCP Call Tool
    app.post('/mcp/tools/call', async (c) => {
        const body = await c.req.json();
        const { name: toolName, arguments: args = {} } = body;
        const gitAuth = auth ? c.get('gitAuth') : undefined;
        // Check write access
        if (gitAuth && requiresWriteAccess(toolName, args) && gitAuth.readonly) {
            return c.json({
                content: [{ type: 'text', text: `Tool "${toolName}" requires write access` }],
                isError: true,
            });
        }
        const result = await invokeTool(toolName, args, repository, { auth: gitAuth });
        return c.json(result);
    });
    // ==========================================================================
    // REST API Endpoints (for direct HTTP access)
    // ==========================================================================
    // Health check
    app.get('/health', (c) => {
        return c.json({ status: 'ok', name, version });
    });
    // Get repository status
    app.get('/api/status', async (c) => {
        if (!repository) {
            return c.json({ error: 'No repository configured' }, 500);
        }
        const short = c.req.query('short') === 'true';
        const result = await repository.status({ short });
        return c.json(result);
    });
    // Get commit log
    app.get('/api/log', async (c) => {
        if (!repository) {
            return c.json({ error: 'No repository configured' }, 500);
        }
        const maxCount = parseInt(c.req.query('max') || '20');
        const oneline = c.req.query('oneline') === 'true';
        const ref = c.req.query('ref');
        const result = await repository.log({ maxCount, oneline, ref: ref || undefined });
        return c.json(result);
    });
    // Get diff
    app.get('/api/diff', async (c) => {
        if (!repository) {
            return c.json({ error: 'No repository configured' }, 500);
        }
        const staged = c.req.query('staged') === 'true';
        const commit1 = c.req.query('commit1');
        const commit2 = c.req.query('commit2');
        const result = await repository.diff({
            staged,
            commit1: commit1 || undefined,
            commit2: commit2 || undefined,
        });
        return c.json(result);
    });
    // Show object
    app.get('/api/show/:revision', async (c) => {
        if (!repository) {
            return c.json({ error: 'No repository configured' }, 500);
        }
        const revision = c.req.param('revision');
        const path = c.req.query('path');
        const result = await repository.show(revision, { path: path || undefined });
        return c.json(result);
    });
    // Create commit (requires write access)
    app.post('/api/commit', requireGitWrite(), async (c) => {
        if (!repository) {
            return c.json({ error: 'No repository configured' }, 500);
        }
        const body = await c.req.json();
        const { message, author, email, amend } = body;
        const result = await repository.commit(message, { author, email, amend });
        return c.json(result);
    });
    // Branch operations
    app.get('/api/branches', async (c) => {
        if (!repository) {
            return c.json({ error: 'No repository configured' }, 500);
        }
        const all = c.req.query('all') === 'true';
        const result = await repository.branch({ list: true, all });
        return c.json(result);
    });
    app.post('/api/branches', requireGitWrite(), async (c) => {
        if (!repository) {
            return c.json({ error: 'No repository configured' }, 500);
        }
        const body = await c.req.json();
        const { name: branchName } = body;
        const result = await repository.branch({ name: branchName });
        return c.json(result);
    });
    app.delete('/api/branches/:name', requireGitWrite(), async (c) => {
        if (!repository) {
            return c.json({ error: 'No repository configured' }, 500);
        }
        const branchName = c.req.param('name');
        const result = await repository.branch({ name: branchName, delete: true });
        return c.json(result);
    });
    // Checkout (requires write access)
    app.post('/api/checkout', requireGitWrite(), async (c) => {
        if (!repository) {
            return c.json({ error: 'No repository configured' }, 500);
        }
        const body = await c.req.json();
        const { ref, createBranch } = body;
        await repository.checkout(ref, { createBranch });
        return c.json({ success: true, ref });
    });
    // Add files (requires write access)
    app.post('/api/add', requireGitWrite(), async (c) => {
        if (!repository) {
            return c.json({ error: 'No repository configured' }, 500);
        }
        const body = await c.req.json();
        const { files, all } = body;
        await repository.add({ files, all });
        return c.json({ success: true });
    });
    // Reset (requires write access)
    app.post('/api/reset', requireGitWrite(), async (c) => {
        if (!repository) {
            return c.json({ error: 'No repository configured' }, 500);
        }
        const body = await c.req.json();
        const { mode, commit } = body;
        await repository.reset({ mode, commit });
        return c.json({ success: true });
    });
    // Merge (requires write access)
    app.post('/api/merge', requireGitWrite(), async (c) => {
        if (!repository) {
            return c.json({ error: 'No repository configured' }, 500);
        }
        const body = await c.req.json();
        const { branch, noFf, squash } = body;
        const result = await repository.merge(branch, { noFf, squash });
        return c.json(result);
    });
    // Blame
    app.get('/api/blame/*', async (c) => {
        if (!repository) {
            return c.json({ error: 'No repository configured' }, 500);
        }
        const path = c.req.path.replace('/api/blame/', '');
        const startLine = parseInt(c.req.query('start') || '1');
        const endLine = c.req.query('end') ? parseInt(c.req.query('end')) : undefined;
        const result = await repository.blame(path, { startLine, endLine });
        return c.json(result);
    });
    // ==========================================================================
    // OAuth 2.1 Endpoints (served by MCP server)
    // ==========================================================================
    // OAuth Authorization Server Metadata (RFC 8414)
    app.get('/.well-known/oauth-authorization-server', (c) => {
        const issuer = new URL(c.req.url).origin;
        return c.json({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            registration_endpoint: `${issuer}/register`,
            token_introspection_endpoint: `${issuer}/introspect`,
            token_revocation_endpoint: `${issuer}/revoke`,
            scopes_supported: ['read', 'write', 'admin', 'git:read', 'git:write', 'git:admin'],
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        });
    });
    // OAuth Protected Resource Metadata (RFC 9728)
    app.get('/.well-known/oauth-protected-resource', (c) => {
        const resource = new URL(c.req.url).origin;
        return c.json({
            resource,
            authorization_servers: [resource], // Self-issued
            scopes_supported: ['read', 'write', 'admin', 'git:read', 'git:write', 'git:admin'],
            bearer_methods_supported: ['header'],
        });
    });
    // Note: Actual /authorize, /token, /register endpoints would be implemented
    // by oauth.do or @cloudflare/workers-oauth-provider
    // These are placeholders that redirect to the upstream auth provider
    return {
        app,
        info: { name, version },
        getTools() {
            return getToolRegistry().list();
        },
        async invokeTool(toolName, params, authContext) {
            return invokeTool(toolName, params, repository, { auth: authContext });
        },
    };
}
//# sourceMappingURL=server.js.map