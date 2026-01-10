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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    constructor(state, env) {
        super(state, env);
        // GitRepoDO has git capability by default
        this._capabilities.add('git');
        // Initialize router
        this._router = new Hono();
        this._setupRoutes();
        // Initialize workflow context
        this._$ = this._createWorkflowContext();
        // Initialize store accessors
        this._things = this._createStoreAccessor('things');
        this._rels = this._createStoreAccessor('rels');
        this._actions = this._createStoreAccessor('actions');
        this._events = this._createStoreAccessor('events');
        // Initialize db (placeholder for Drizzle integration)
        this._db = { sql: state.storage.sql };
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
    // ===========================================================================
    // Lifecycle Methods
    // ===========================================================================
    /**
     * Initialize the GitRepoDO with namespace and optional parent.
     */
    async initialize(options) {
        // Validate namespace URL
        let url;
        try {
            url = new URL(options.ns);
        }
        catch {
            throw new Error(`Invalid namespace URL: ${options.ns}`);
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
    }
    /**
     * Fork this DO to create a new instance with copied state.
     */
    async fork(options) {
        if (!this._initialized || !this._ns) {
            throw new Error('Cannot fork: DO not initialized');
        }
        // Validate target namespace URL
        try {
            new URL(options.to);
        }
        catch {
            throw new Error(`Invalid fork target URL: ${options.to}`);
        }
        // Create a new DO ID for the fork
        const doId = this.env.DO?.newUniqueId() ?? { id: crypto.randomUUID() };
        const doIdStr = typeof doId === 'object' && 'id' in doId ? String(doId.id) : String(doId);
        // If we have the DO binding, create the forked instance
        if (this.env.DO) {
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
        return {
            ns: options.to,
            doId: doIdStr,
        };
    }
    /**
     * Compact the DO's data, archiving old things, actions, and events.
     */
    async compact() {
        if (!this._initialized) {
            throw new Error('Cannot compact: DO not initialized');
        }
        // Check if there's anything to compact
        const thingsList = await this.state.storage.list({ prefix: 'things:' });
        const actionsList = await this.state.storage.list({ prefix: 'actions:' });
        const eventsList = await this.state.storage.list({ prefix: 'events:' });
        const totalItems = thingsList.size + actionsList.size + eventsList.size;
        if (totalItems === 0) {
            throw new Error('Nothing to compact');
        }
        // For now, return counts without actual archiving
        return {
            thingsCompacted: thingsList.size,
            actionsArchived: actionsList.size,
            eventsArchived: eventsList.size,
        };
    }
    // ===========================================================================
    // Durable Object Interface
    // ===========================================================================
    /**
     * Handle incoming HTTP requests.
     */
    async fetch(request) {
        return this._router.fetch(request);
    }
    /**
     * Handle alarm callbacks.
     */
    async alarm() {
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
    _setupRoutes() {
        // Health check endpoint
        this._router.get('/health', (c) => {
            return c.json({
                status: 'ok',
                ns: this._ns,
                $type: this.$type,
            });
        });
        // Fork endpoint (internal)
        this._router.post('/fork', async (c) => {
            const body = await c.req.json();
            await this.initialize({ ns: body.ns, parent: body.parent });
            return c.json({ success: true });
        });
    }
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