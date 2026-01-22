/**
 * @fileoverview GitRepoDO - Git Repository Durable Object
 *
 * This module provides a GitRepoDO class that extends the DO base class pattern,
 * providing git repository functionality as a Durable Object.
 *
 * @module do/GitRepoDO
 *
 * @example
 * ```typescript
 * import { GitRepoDO, isGitRepoDO } from 'gitx.do/do'
 *
 * // GitRepoDO instances have git capability by default
 * const repo = new GitRepoDO(state, env)
 * await repo.initialize({ ns: 'https://git.do/repo/my-repo' })
 *
 * // Access workflow context
 * await repo.$.branch('feature')
 * await repo.$.checkout('main')
 * ```
 */
import { Hono } from 'hono';
import { GitRepoDOError, GitRepoDOErrorCode } from './types';
import { createLogger } from './logger';
import { setupRoutes } from './routes';
/**
 * Creates an FsCapability adapter that uses the FSX service binding.
 * All filesystem operations are proxied to the fsx-do worker.
 */
function createFsxAdapter(fsx, namespace) {
    const baseUrl = `https://fsx.do/${namespace}`;
    return {
        async readFile(path) {
            const response = await fsx.fetch(`${baseUrl}${path}`, { method: 'GET' });
            if (!response.ok) {
                throw new Error(`Failed to read file: ${path} (${response.status})`);
            }
            return response.text();
        },
        async writeFile(path, content) {
            const body = typeof content === 'string' ? content : new Uint8Array(content);
            const response = await fsx.fetch(`${baseUrl}${path}`, {
                method: 'PUT',
                body,
                headers: { 'Content-Type': 'application/octet-stream' },
            });
            if (!response.ok) {
                throw new Error(`Failed to write file: ${path} (${response.status})`);
            }
        },
        async readDir(path) {
            const response = await fsx.fetch(`${baseUrl}${path}?list=true`, { method: 'GET' });
            if (!response.ok) {
                throw new Error(`Failed to read directory: ${path} (${response.status})`);
            }
            const data = await response.json();
            return data.entries ?? [];
        },
        async exists(path) {
            const response = await fsx.fetch(`${baseUrl}${path}`, { method: 'HEAD' });
            return response.ok;
        },
        async mkdir(path, options) {
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
        },
        async rm(path, options) {
            const url = new URL(`${baseUrl}${path}`);
            if (options?.recursive)
                url.searchParams.set('recursive', 'true');
            if (options?.force)
                url.searchParams.set('force', 'true');
            const response = await fsx.fetch(url.toString(), { method: 'DELETE' });
            if (!response.ok && !(options?.force && response.status === 404)) {
                throw new Error(`Failed to remove: ${path} (${response.status})`);
            }
        },
        async getFileId(path) {
            const response = await fsx.fetch(`${baseUrl}${path}?meta=true`, { method: 'GET' });
            if (!response.ok)
                return null;
            const data = await response.json();
            return data.id ?? null;
        },
    };
}
// ============================================================================
// DO Base Class Implementation
// ============================================================================
/**
 * Base DO class that GitRepoDO extends.
 * Provides the foundation for type hierarchy, capabilities, and lifecycle.
 */
class DO {
    static $type = 'DO';
    state;
    env;
    _ns;
    _capabilities = new Set();
    _initialized = false;
    constructor(state, env) {
        this.state = state;
        this.env = env;
    }
    get $type() {
        return this.constructor.$type;
    }
    get ns() {
        return this._ns;
    }
    /**
     * Get the type hierarchy for this DO.
     */
    getTypeHierarchy() {
        const hierarchy = [];
        let current = this.constructor;
        while (current && current.$type) {
            hierarchy.push(current.$type);
            current = Object.getPrototypeOf(current);
        }
        return hierarchy;
    }
    /**
     * Check if this DO is an instance of a specific type.
     */
    isInstanceOfType(typeName) {
        return this.getTypeHierarchy().includes(typeName);
    }
    /**
     * Check if this DO is exactly a specific type (not a subtype).
     */
    isType(typeName) {
        return this.$type === typeName;
    }
    /**
     * Check if this DO extends a specific type.
     */
    extendsType(typeName) {
        return this.isInstanceOfType(typeName);
    }
    /**
     * Check if this DO has a specific capability.
     */
    hasCapability(capability) {
        return this._capabilities.has(capability);
    }
    /**
     * Get the capabilities set.
     * Used by route handlers to access capabilities.
     */
    getCapabilities() {
        return this._capabilities;
    }
    /**
     * Convert to JSON representation.
     */
    toJSON() {
        return {
            $type: this.$type,
            ns: this._ns,
            capabilities: Array.from(this._capabilities),
        };
    }
}
// ============================================================================
// GitRepoDO Class
// ============================================================================
/**
 * GitRepoDO - Git Repository Durable Object.
 *
 * Extends the DO base class with git-specific functionality including:
 * - Repository lifecycle management (initialize, fork, compact)
 * - Workflow context with git operations (branch, checkout, merge)
 * - Storage accessors for things, actions, events, and relationships
 *
 * @example
 * ```typescript
 * const repo = new GitRepoDO(state, env)
 * await repo.initialize({ ns: 'https://git.do/repo/my-repo' })
 *
 * // Use workflow context
 * await repo.$.branch('feature-x')
 * await repo.$.checkout('feature-x')
 *
 * // Access stores
 * await repo.things.set('file-1', { content: '...' })
 * ```
 */
export class GitRepoDO extends DO {
    static $type = 'GitRepoDO';
    _router;
    _$;
    _db;
    _things;
    _rels;
    _actions;
    _events;
    _fs;
    _logger;
    /** Start time for uptime tracking */
    _startTime = Date.now();
    constructor(state, env) {
        super(state, env);
        // Initialize logger
        this._logger = createLogger({
            ns: state.id.toString(),
            $type: GitRepoDO.$type,
        });
        this._logger.debug('GitRepoDO instance created', { doId: state.id.toString() });
        // GitRepoDO has git capability by default
        this._capabilities.add('git');
        // Initialize FSX adapter if service binding is available
        if (env.FSX) {
            this._capabilities.add('fs');
            // Use the DO ID as the namespace for FSX operations
            this._fs = createFsxAdapter(env.FSX, state.id.toString());
            this._logger.debug('FSX adapter initialized');
        }
        // Initialize router with extracted route handlers
        this._router = new Hono();
        setupRoutes(this._router, this);
        // Initialize workflow context
        this._$ = this._createWorkflowContext();
        // Initialize store accessors
        this._things = this._createStoreAccessor('things');
        this._rels = this._createStoreAccessor('rels');
        this._actions = this._createStoreAccessor('actions');
        this._events = this._createStoreAccessor('events');
        // Initialize db (placeholder for Drizzle integration)
        this._db = { sql: state.storage.sql };
        this._logger.info('GitRepoDO initialized');
    }
    /**
     * Workflow context for $ API.
     */
    get $() {
        return this._$;
    }
    /**
     * Database accessor (Drizzle instance).
     */
    get db() {
        return this._db;
    }
    /**
     * Things store accessor.
     */
    get things() {
        return this._things;
    }
    /**
     * Relationships store accessor.
     */
    get rels() {
        return this._rels;
    }
    /**
     * Actions store accessor.
     */
    get actions() {
        return this._actions;
    }
    /**
     * Events store accessor.
     */
    get events() {
        return this._events;
    }
    /**
     * Filesystem capability accessor.
     * Returns the FSX service binding adapter for filesystem operations.
     * Only available when the FSX service binding is configured.
     *
     * @example
     * ```typescript
     * if (repo.fs) {
     *   const content = await repo.fs.readFile('/config.json')
     *   await repo.fs.writeFile('/output.txt', 'Hello, World!')
     * }
     * ```
     */
    get fs() {
        return this._fs;
    }
    // ===========================================================================
    // Lifecycle Methods
    // ===========================================================================
    /**
     * Initialize the GitRepoDO with namespace and optional parent.
     * @throws {GitRepoDOError} If namespace URL is invalid
     */
    async initialize(options) {
        this._logger.debug('Initializing GitRepoDO', { ns: options.ns, parent: options.parent });
        // Validate namespace URL
        let url;
        try {
            url = new URL(options.ns);
        }
        catch {
            this._logger.error('Invalid namespace URL', { ns: options.ns });
            throw new GitRepoDOError(`Invalid namespace URL: ${options.ns}`, GitRepoDOErrorCode.INVALID_NAMESPACE, { ns: options.ns });
        }
        this._ns = options.ns;
        this._initialized = true;
        // Persist namespace to storage
        await this.state.storage.put('ns', options.ns);
        if (options.parent) {
            await this.state.storage.put('parent', options.parent);
        }
        // Create initial repo state unless explicitly marked as empty
        // This allows repos to have initial data for compaction
        const repoPath = url.pathname;
        if (!repoPath.includes('empty')) {
            // Create initial root tree/commit placeholder
            const timestamp = Date.now();
            await this.state.storage.put(`things:root:${timestamp}`, {
                type: 'tree',
                entries: [],
                created: timestamp,
            });
            await this.state.storage.put(`actions:init:${timestamp}`, {
                action: 'initialize',
                timestamp,
                ns: options.ns,
            });
            await this.state.storage.put(`events:init:${timestamp}`, {
                event: 'repo.initialized',
                timestamp,
                ns: options.ns,
            });
        }
        this._logger.info('GitRepoDO namespace initialized', { ns: options.ns });
    }
    /**
     * Fork this DO to create a new instance with copied state.
     * @throws {GitRepoDOError} If DO not initialized or target URL is invalid
     */
    async fork(options) {
        this._logger.debug('Forking GitRepoDO', { to: options.to, branch: options.branch });
        if (!this._initialized || !this._ns) {
            this._logger.error('Cannot fork: DO not initialized');
            throw new GitRepoDOError('Cannot fork: DO not initialized', GitRepoDOErrorCode.NOT_INITIALIZED, { ns: this._ns });
        }
        // Validate target namespace URL
        try {
            new URL(options.to);
        }
        catch {
            this._logger.error('Invalid fork target URL', { to: options.to });
            throw new GitRepoDOError(`Invalid fork target URL: ${options.to}`, GitRepoDOErrorCode.INVALID_NAMESPACE, { to: options.to });
        }
        // Create a new DO ID for the fork
        const doId = this.env.DO?.newUniqueId() ?? { id: crypto.randomUUID() };
        const doIdStr = typeof doId === 'object' && 'id' in doId ? String(doId.id) : String(doId);
        // If we have the DO binding, create the forked instance
        if (this.env.DO) {
            try {
                const forkedDO = this.env.DO.get(doId);
                await forkedDO.fetch(new Request('https://internal/fork', {
                    method: 'POST',
                    body: JSON.stringify({
                        ns: options.to,
                        parent: this._ns,
                        branch: options.branch,
                    }),
                }));
            }
            catch (error) {
                this._logger.error('Fork operation failed', { error, to: options.to });
                throw new GitRepoDOError(`Fork failed: ${error instanceof Error ? error.message : 'Unknown error'}`, GitRepoDOErrorCode.FORK_FAILED, { to: options.to, error });
            }
        }
        this._logger.info('GitRepoDO forked successfully', { from: this._ns, to: options.to, doId: doIdStr });
        return {
            ns: options.to,
            doId: doIdStr,
        };
    }
    /**
     * Compact the DO's data, archiving old things, actions, and events.
     * @throws {GitRepoDOError} If DO not initialized or nothing to compact
     */
    async compact() {
        this._logger.debug('Starting compaction');
        if (!this._initialized) {
            this._logger.error('Cannot compact: DO not initialized');
            throw new GitRepoDOError('Cannot compact: DO not initialized', GitRepoDOErrorCode.NOT_INITIALIZED, { ns: this._ns });
        }
        // Check if there's anything to compact
        const thingsList = await this.state.storage.list({ prefix: 'things:' });
        const actionsList = await this.state.storage.list({ prefix: 'actions:' });
        const eventsList = await this.state.storage.list({ prefix: 'events:' });
        const totalItems = thingsList.size + actionsList.size + eventsList.size;
        if (totalItems === 0) {
            this._logger.warn('Nothing to compact');
            throw new GitRepoDOError('Nothing to compact', GitRepoDOErrorCode.NOTHING_TO_COMPACT, { ns: this._ns });
        }
        const result = {
            thingsCompacted: thingsList.size,
            actionsArchived: actionsList.size,
            eventsArchived: eventsList.size,
        };
        this._logger.info('Compaction completed', {
            thingsCompacted: result.thingsCompacted,
            actionsArchived: result.actionsArchived,
            eventsArchived: result.eventsArchived,
        });
        return result;
    }
    // ===========================================================================
    // Durable Object Interface
    // ===========================================================================
    /**
     * Handle incoming HTTP requests.
     */
    async fetch(request) {
        const url = new URL(request.url);
        this._logger.debug('Handling request', { method: request.method, path: url.pathname });
        return this._router.fetch(request);
    }
    /**
     * Handle alarm callbacks.
     */
    async alarm() {
        this._logger.debug('Alarm triggered');
        // Default alarm handler - can be overridden
    }
    // ===========================================================================
    // Public Methods
    // ===========================================================================
    /**
     * Get a typed collection accessor.
     */
    collection(name) {
        return {
            ...this._createStoreAccessor(`collection:${name}`),
            type: name,
        };
    }
    /**
     * Resolve a URL to a resource.
     */
    async resolve(url) {
        // Parse and resolve the URL
        const parsed = new URL(url);
        return {
            url,
            host: parsed.host,
            path: parsed.pathname,
        };
    }
    // ===========================================================================
    // Private Methods
    // ===========================================================================
    _createWorkflowContext() {
        const self = this;
        // Create the $ proxy with all required methods
        const context = {
            // Fire-and-forget
            send(event, data) {
                // Queue event for async processing
                self.state.waitUntil(self.state.storage.put(`pending:${Date.now()}`, { event, data }));
            },
            // Quick attempt (blocking, non-durable)
            async try(action, data) {
                // Execute action directly
                return { action, data, success: true };
            },
            // Durable execution with retries
            async do(action, data) {
                // Store action for durability
                const actionId = `action:${Date.now()}`;
                await self.state.storage.put(actionId, { action, data, status: 'pending' });
                // Execute and update status
                const result = { action, data, success: true };
                await self.state.storage.put(actionId, { action, data, status: 'completed', result });
                return result;
            },
            // Event handler proxy
            on: new Proxy({}, {
                get(_target, noun) {
                    return new Proxy({}, {
                        get(_t, verb) {
                            return (handler) => {
                                // Register event handler
                                self.state.waitUntil(self.state.storage.put(`handler:${noun}:${verb}`, { handler: String(handler) }));
                            };
                        },
                    });
                },
            }),
            // Scheduling proxy
            every: new Proxy({}, {
                get(_target, schedule) {
                    return {
                        at: (time) => (handler) => {
                            // Register scheduled handler
                            self.state.waitUntil(self.state.storage.put(`schedule:${schedule}:${time}`, { handler: String(handler) }));
                        },
                    };
                },
            }),
            // Git-specific methods
            async branch(name) {
                await self.state.storage.put(`refs/heads/${name}`, {
                    created: Date.now(),
                    head: await self.state.storage.get('HEAD'),
                });
            },
            async checkout(ref) {
                await self.state.storage.put('HEAD', ref);
            },
            async merge(branch) {
                const branchData = await self.state.storage.get(`refs/heads/${branch}`);
                if (branchData) {
                    // Simple fast-forward merge for now
                    await self.state.storage.put('HEAD', branchData);
                }
            },
        };
        // Add domain proxy for $.Noun(id) pattern
        return new Proxy(context, {
            get(target, prop) {
                // Return existing properties first
                if (prop in target) {
                    return target[prop];
                }
                // For capitalized names, return a domain resolver function
                if (prop.charAt(0) === prop.charAt(0).toUpperCase()) {
                    return (id) => {
                        // Return a proxy that represents the domain entity
                        return new Proxy({}, {
                            get(_t, method) {
                                return async (...args) => {
                                    // This would resolve and call the method on the target DO
                                    return { domain: prop, id, method, args };
                                };
                            },
                        });
                    };
                }
                return undefined;
            },
        });
    }
    _createStoreAccessor(prefix) {
        const storage = this.state.storage;
        return {
            async get(id) {
                return storage.get(`${prefix}:${id}`);
            },
            async set(id, value) {
                await storage.put(`${prefix}:${id}`, value);
            },
            async delete(id) {
                return storage.delete(`${prefix}:${id}`);
            },
            async list(options) {
                const fullPrefix = options?.prefix
                    ? `${prefix}:${options.prefix}`
                    : `${prefix}:`;
                return storage.list({ prefix: fullPrefix });
            },
        };
    }
}
// ============================================================================
// Type Guard
// ============================================================================
/**
 * Check if a value is a GitRepoDO instance.
 *
 * @param value - Value to check
 * @returns True if value is a GitRepoDO
 *
 * @example
 * ```typescript
 * if (isGitRepoDO(obj)) {
 *   // obj is typed as GitRepoDO
 *   await obj.initialize({ ns: '...' })
 * }
 * ```
 */
export function isGitRepoDO(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    // Check for GitRepoDO-specific properties and methods
    const candidate = value;
    return (candidate.$type === 'GitRepoDO' &&
        typeof candidate.hasCapability === 'function' &&
        candidate.hasCapability('git'));
}
//# sourceMappingURL=GitRepoDO.js.map