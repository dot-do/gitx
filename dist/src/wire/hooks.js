/**
 * @fileoverview Git Server-Side Hooks System
 *
 * Production-ready hook execution with:
 * - Webhook support (HTTP POST)
 * - Async/parallel hook execution
 * - Hook output streaming
 * - Priority-based hook ordering
 *
 * @module wire/hooks
 */
// ============================================================================
// Hook Registry
// ============================================================================
/**
 * Registry for managing hooks.
 *
 * @example
 * ```typescript
 * const registry = new HookRegistry()
 *
 * // Add a function hook
 * registry.register({
 *   id: 'policy-check',
 *   type: 'function',
 *   point: 'pre-receive',
 *   priority: 10,
 *   handler: async (commands, env) => {
 *     // Validate commands
 *     return { success: true }
 *   }
 * })
 *
 * // Add a webhook
 * registry.register({
 *   id: 'ci-trigger',
 *   type: 'webhook',
 *   point: 'post-receive',
 *   priority: 100,
 *   url: 'https://ci.example.com/hooks/git',
 *   secret: 'webhook-secret'
 * })
 * ```
 */
export class HookRegistry {
    hooks = new Map();
    /**
     * Register a hook configuration.
     */
    register(config) {
        if (this.hooks.has(config.id)) {
            throw new Error(`Hook with id '${config.id}' already registered`);
        }
        this.hooks.set(config.id, {
            ...config,
            priority: config.priority ?? 100,
            timeout: config.timeout ?? 30000,
            enabled: config.enabled ?? true,
        });
    }
    /**
     * Unregister a hook by ID.
     */
    unregister(id) {
        return this.hooks.delete(id);
    }
    /**
     * Get hooks for a specific execution point, sorted by priority.
     */
    getHooksForPoint(point) {
        return Array.from(this.hooks.values())
            .filter((h) => h.point === point && h.enabled !== false)
            .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    }
    /**
     * Get a specific hook by ID.
     */
    getHook(id) {
        return this.hooks.get(id);
    }
    /**
     * Enable/disable a hook.
     */
    setEnabled(id, enabled) {
        const hook = this.hooks.get(id);
        if (hook) {
            hook.enabled = enabled;
            return true;
        }
        return false;
    }
    /**
     * Get all registered hooks.
     */
    getAllHooks() {
        return Array.from(this.hooks.values());
    }
    /**
     * Clear all hooks.
     */
    clear() {
        this.hooks.clear();
    }
}
/**
 * Executes hooks from a registry.
 *
 * @example
 * ```typescript
 * const executor = new HookExecutor(registry)
 *
 * // Execute pre-receive hooks
 * const result = await executor.executePreReceive(commands, env, {
 *   mode: 'sync',
 *   onOutput: (output) => console.log(`Hook ${output.hookId}: ${output.message}`)
 * })
 *
 * if (!result.success) {
 *   console.error('Pre-receive hooks failed:', result.message)
 * }
 * ```
 */
export class HookExecutor {
    registry;
    defaultOptions;
    constructor(registry, defaultOptions = {}) {
        this.registry = registry;
        this.defaultOptions = defaultOptions;
    }
    /**
     * Execute pre-receive hooks.
     */
    async executePreReceive(commands, env = {}, options) {
        const hooks = this.registry.getHooksForPoint('pre-receive');
        const opts = { ...this.defaultOptions, ...options };
        return this.executeHooks(hooks, 'pre-receive', async (hook) => {
            if (hook.type === 'function') {
                return hook.handler(commands, env);
            }
            else {
                return this.executeWebhook(hook, {
                    hook: 'pre-receive',
                    timestamp: new Date().toISOString(),
                    repository: opts.repoId,
                    commands,
                    env,
                }, opts);
            }
        }, opts);
    }
    /**
     * Execute update hooks for each ref.
     *
     * Unlike pre-receive hooks which validate all refs together, update hooks
     * run per-ref and can selectively reject individual ref updates while
     * allowing others to proceed.
     *
     * @param commands - The ref update commands to validate
     * @param env - Environment variables to pass to hooks
     * @param options - Execution options (mode, callbacks, etc.)
     * @returns Results for each ref indicating success or failure
     *
     * @example
     * ```typescript
     * const { results } = await executor.executeUpdate(commands, env, {
     *   onOutput: (output) => console.log(`Hook ${output.hookId}: ${output.success}`)
     * })
     *
     * // Check which refs were accepted
     * const accepted = results.filter(r => r.success)
     * const rejected = results.filter(r => !r.success)
     * ```
     */
    async executeUpdate(commands, env = {}, options) {
        const hooks = this.registry.getHooksForPoint('update');
        const mergedOptions = { ...this.defaultOptions, ...options };
        const results = [];
        for (const command of commands) {
            const refResult = await this.executeUpdateHooksForRef(command, hooks, env, mergedOptions);
            results.push(refResult);
        }
        return { results };
    }
    /**
     * Execute all update hooks for a single ref.
     *
     * Runs hooks sequentially until one fails or all succeed.
     * On failure, returns immediately with the error message.
     *
     * @param command - The ref update command being validated
     * @param hooks - Array of update hooks to execute
     * @param env - Environment variables to pass to hooks
     * @param options - Execution options
     * @returns Result indicating whether the ref update is allowed
     */
    async executeUpdateHooksForRef(command, hooks, env, options) {
        for (const hook of hooks) {
            if (!hook.enabled)
                continue;
            const hookOutcome = await this.executeSingleUpdateHook(hook, command, env, options);
            // Report hook output if callback provided
            if (hookOutcome.output) {
                options.onOutput?.(hookOutcome.output);
            }
            // Stop on first hook failure
            if (!hookOutcome.success) {
                return {
                    refName: command.refName,
                    success: false,
                    error: hookOutcome.errorMessage,
                };
            }
        }
        // All hooks passed
        return {
            refName: command.refName,
            success: true,
        };
    }
    /**
     * Execute a single update hook for a ref.
     *
     * Handles both function and webhook types with proper timeout and error handling.
     *
     * @param hook - The hook configuration to execute
     * @param command - The ref update command being validated
     * @param env - Environment variables to pass to the hook
     * @param options - Execution options
     * @returns Object containing success status, optional error message, and hook output
     */
    async executeSingleUpdateHook(hook, command, env, options) {
        const startTime = Date.now();
        try {
            const result = await this.invokeUpdateHook(hook, command, env, options);
            const output = this.createHookOutput(hook.id, result.success, result.message, startTime);
            if (!result.success) {
                return {
                    success: false,
                    errorMessage: result.message,
                    output,
                };
            }
            return { success: true, output };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const output = this.createHookOutput(hook.id, false, errorMessage, startTime);
            return {
                success: false,
                errorMessage,
                output,
            };
        }
    }
    /**
     * Invoke an update hook (function or webhook) with timeout.
     *
     * @param hook - The hook configuration
     * @param command - The ref update command
     * @param env - Environment variables
     * @param options - Execution options including repoId for webhooks
     * @returns The hook result indicating success or failure
     */
    async invokeUpdateHook(hook, command, env, options) {
        const timeout = hook.timeout ?? 30000;
        if (hook.type === 'function') {
            const handler = hook.handler;
            return this.executeWithTimeout(handler(command.refName, command.oldSha, command.newSha, env), timeout);
        }
        // Webhook type
        const payload = {
            hook: 'update',
            timestamp: new Date().toISOString(),
            repository: options.repoId,
            ref: {
                name: command.refName,
                oldSha: command.oldSha,
                newSha: command.newSha,
            },
            env,
        };
        return this.executeWebhook(hook, payload, options);
    }
    /**
     * Execute post-receive hooks.
     */
    async executePostReceive(commands, results, env = {}, options) {
        const hooks = this.registry.getHooksForPoint('post-receive');
        const opts = { ...this.defaultOptions, ...options };
        // Filter to only successful commands
        const successfulCommands = commands.filter((_, idx) => results[idx]?.success);
        const execResult = await this.executeHooks(hooks, 'post-receive', async (hook) => {
            if (hook.type === 'function') {
                return hook.handler(successfulCommands, results, env);
            }
            else {
                return this.executeWebhook(hook, {
                    hook: 'post-receive',
                    timestamp: new Date().toISOString(),
                    repository: opts.repoId,
                    commands: successfulCommands,
                    results,
                    env,
                }, opts);
            }
        }, { ...opts, mode: 'async' }); // Post-receive is typically async
        return {
            pushSuccess: true, // post-receive doesn't affect push success
            hookSuccess: execResult.success,
        };
    }
    /**
     * Execute post-update hooks.
     */
    async executePostUpdate(results, options) {
        const hooks = this.registry.getHooksForPoint('post-update');
        const opts = { ...this.defaultOptions, ...options };
        const successfulRefs = results.filter((r) => r.success).map((r) => r.refName);
        if (successfulRefs.length === 0)
            return;
        await this.executeHooks(hooks, 'post-update', async (hook) => {
            if (hook.type === 'function') {
                return hook.handler(successfulRefs);
            }
            else {
                return this.executeWebhook(hook, {
                    hook: 'post-update',
                    timestamp: new Date().toISOString(),
                    repository: opts.repoId,
                    commands: successfulRefs.map((name) => ({ refName: name })),
                }, opts);
            }
        }, { ...opts, mode: 'async' });
    }
    // ========================================================================
    // Private Methods
    // ========================================================================
    /**
     * Creates a HookOutput object from execution results.
     *
     * @param hookId - The unique identifier of the hook
     * @param success - Whether the hook execution succeeded
     * @param message - Optional message from the hook
     * @param startTime - Timestamp when execution started
     * @returns A fully populated HookOutput object
     */
    createHookOutput(hookId, success, message, startTime) {
        return {
            hookId,
            success,
            message,
            duration: Date.now() - startTime,
            startedAt: new Date(startTime),
            completedAt: new Date(),
        };
    }
    /**
     * Executes a single hook and returns its output.
     *
     * @param hook - The hook configuration to execute
     * @param executor - Function that performs the actual hook execution
     * @param onOutput - Optional callback for streaming output
     * @returns The hook output result
     */
    async executeSingleHook(hook, executor, onOutput) {
        const startTime = Date.now();
        try {
            const result = await this.executeWithTimeout(executor(hook), hook.timeout ?? 30000);
            const output = this.createHookOutput(hook.id, result.success, result.message, startTime);
            onOutput?.(output);
            return output;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const output = this.createHookOutput(hook.id, false, errorMessage, startTime);
            onOutput?.(output);
            return output;
        }
    }
    /**
     * Execute a list of hooks with the given executor function.
     *
     * @param hooks - Array of hook configurations to execute
     * @param point - The hook execution point (pre-receive, post-receive, etc.)
     * @param executor - Function that executes a single hook
     * @param options - Execution options including mode and callbacks
     * @returns Aggregated result from all hook executions
     */
    async executeHooks(hooks, point, executor, options) {
        const totalStart = Date.now();
        const mode = options.mode ?? 'sync';
        if (hooks.length === 0) {
            return {
                success: true,
                outputs: [],
                totalDuration: 0,
            };
        }
        const outputs = mode === 'async'
            ? await this.executeHooksInParallel(hooks, executor, options.onOutput)
            : await this.executeHooksSequentially(hooks, point, executor, options.onOutput);
        return this.buildExecutionResult(outputs, totalStart);
    }
    /**
     * Executes hooks in parallel (async mode).
     *
     * @param hooks - Array of hook configurations to execute
     * @param executor - Function that executes a single hook
     * @param onOutput - Optional callback for streaming output
     * @returns Array of hook outputs
     */
    async executeHooksInParallel(hooks, executor, onOutput) {
        const promises = hooks.map((hook) => this.executeSingleHook(hook, executor, onOutput));
        return Promise.all(promises);
    }
    /**
     * Executes hooks sequentially (sync mode).
     * For pre-receive hooks, stops on first failure.
     *
     * @param hooks - Array of hook configurations to execute
     * @param point - The hook execution point
     * @param executor - Function that executes a single hook
     * @param onOutput - Optional callback for streaming output
     * @returns Array of hook outputs
     */
    async executeHooksSequentially(hooks, point, executor, onOutput) {
        const outputs = [];
        const shouldStopOnFailure = point === 'pre-receive';
        for (const hook of hooks) {
            if (!hook.enabled)
                continue;
            const output = await this.executeSingleHook(hook, executor, onOutput);
            outputs.push(output);
            // For pre-receive, stop on first failure or error
            if (shouldStopOnFailure && !output.success) {
                break;
            }
        }
        return outputs;
    }
    /**
     * Builds the final execution result from hook outputs.
     *
     * @param outputs - Array of hook outputs
     * @param totalStart - Timestamp when execution started
     * @returns Aggregated execution result
     */
    buildExecutionResult(outputs, totalStart) {
        const allSuccess = outputs.every((o) => o.success);
        const failedMessages = outputs
            .filter((o) => !o.success && o.message)
            .map((o) => o.message);
        return {
            success: allSuccess,
            outputs,
            message: failedMessages.length > 0 ? failedMessages.join('; ') : undefined,
            totalDuration: Date.now() - totalStart,
        };
    }
    /**
     * Execute a webhook with optional retry logic.
     *
     * Sends an HTTP request to the webhook URL with the payload. Supports:
     * - HMAC-SHA256 payload signing
     * - Custom headers
     * - Configurable retry with exponential backoff
     * - Timeout handling
     *
     * @param config - Webhook configuration including URL, headers, and retry settings
     * @param payload - Data to send to the webhook
     * @param options - Execution options including custom fetch implementation
     * @returns Hook result with success status and optional message
     */
    async executeWebhook(config, payload, options) {
        const fetchFn = options.fetch ?? fetch;
        const body = JSON.stringify(payload);
        const headers = await this.buildWebhookHeaders(config, payload, body);
        const maxAttempts = (config.retry?.attempts ?? 0) + 1;
        const initialDelay = config.retry?.delay ?? 1000;
        const backoffMultiplier = config.retry?.backoff ?? 2;
        const timeout = config.timeout ?? 30000;
        return this.executeWebhookWithRetry(config, fetchFn, headers, body, maxAttempts, initialDelay, backoffMultiplier, timeout);
    }
    /**
     * Builds HTTP headers for a webhook request.
     *
     * @param config - Webhook configuration
     * @param payload - Webhook payload (for hook point header)
     * @param body - Serialized request body (for HMAC signing)
     * @returns Headers object ready for the HTTP request
     */
    async buildWebhookHeaders(config, payload, body) {
        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'gitx.do/1.0',
            'X-Hook-Point': payload.hook,
            ...(config.headers ?? {}),
        };
        if (config.secret) {
            const signature = await this.signPayload(body, config.secret);
            headers['X-Webhook-Signature'] = `sha256=${signature}`;
        }
        return headers;
    }
    /**
     * Executes webhook request with retry logic.
     *
     * @param config - Webhook configuration
     * @param fetchFn - Fetch function to use
     * @param headers - HTTP headers
     * @param body - Request body
     * @param maxAttempts - Maximum number of attempts
     * @param initialDelay - Initial delay between retries in ms
     * @param backoffMultiplier - Multiplier for exponential backoff
     * @param timeout - Request timeout in ms
     * @returns Hook result
     */
    async executeWebhookWithRetry(config, fetchFn, headers, body, maxAttempts, initialDelay, backoffMultiplier, timeout) {
        const method = config.method ?? 'POST';
        let lastError = null;
        let currentDelay = initialDelay;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const result = await this.attemptWebhookRequest(config, fetchFn, method, headers, body, timeout);
            if (result.success) {
                return result;
            }
            lastError = new Error(result.message ?? 'Webhook failed');
            // Don't retry on client errors (4xx)
            if (result.isClientError) {
                break;
            }
            // Wait before retry (except on last attempt)
            if (attempt < maxAttempts) {
                await this.delay(currentDelay);
                currentDelay *= backoffMultiplier;
            }
        }
        return {
            success: false,
            message: lastError?.message ?? 'Webhook failed',
        };
    }
    /**
     * Attempts a single webhook request.
     *
     * @param config - Webhook configuration
     * @param fetchFn - Fetch function to use
     * @param method - HTTP method
     * @param headers - HTTP headers
     * @param body - Request body
     * @param timeout - Request timeout in ms
     * @returns Result with success status and optional client error flag
     */
    async attemptWebhookRequest(config, fetchFn, method, headers, body, timeout) {
        try {
            const response = await this.executeWithTimeout(fetchFn(config.url, { method, headers, body }), timeout);
            if (response.ok) {
                const message = await this.extractWebhookResponseMessage(response, config.id);
                return { success: true, message };
            }
            const errorText = await response.text().catch(() => response.statusText);
            const isClientError = response.status >= 400 && response.status < 500;
            return {
                success: false,
                message: `Webhook returned ${response.status}: ${errorText}`,
                isClientError,
            };
        }
        catch (error) {
            return {
                success: false,
                message: error instanceof Error ? error.message : String(error),
            };
        }
    }
    /**
     * Extracts message from webhook response body.
     *
     * @param response - HTTP response object
     * @param webhookId - Webhook identifier for default message
     * @returns Extracted message or default success message
     */
    async extractWebhookResponseMessage(response, webhookId) {
        try {
            const data = await response.json();
            return data.message ?? `Webhook ${webhookId} succeeded`;
        }
        catch {
            return `Webhook ${webhookId} succeeded`;
        }
    }
    /**
     * Sign payload using HMAC-SHA256.
     *
     * Creates a cryptographic signature of the payload using the provided
     * secret key. This allows webhook receivers to verify the request
     * originated from a trusted source.
     *
     * @param payload - The payload string to sign
     * @param secret - The secret key for signing
     * @returns Hexadecimal signature string
     */
    async signPayload(payload, secret) {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
        const bytes = new Uint8Array(signature);
        return Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
    }
    /**
     * Execute a promise with timeout.
     *
     * Wraps a promise with a timeout that rejects if the original promise
     * doesn't resolve within the specified duration.
     *
     * @param promise - The promise to execute
     * @param timeoutMs - Timeout duration in milliseconds
     * @returns The resolved value of the promise
     * @throws Error with message 'timeout' if the timeout is exceeded
     */
    async executeWithTimeout(promise, timeoutMs) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
        ]);
    }
    /**
     * Delays execution for the specified duration.
     *
     * @param ms - Duration to delay in milliseconds
     */
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
// ============================================================================
// Factory Functions
// ============================================================================
/**
 * Create a pre-receive hook configuration.
 *
 * @example
 * ```typescript
 * const hook = createPreReceiveHook({
 *   id: 'policy-check',
 *   priority: 10,
 *   handler: async (commands, env) => {
 *     for (const cmd of commands) {
 *       if (cmd.refName === 'refs/heads/main' && cmd.type === 'delete') {
 *         return { success: false, message: 'Cannot delete main branch' }
 *       }
 *     }
 *     return { success: true }
 *   }
 * })
 * ```
 */
export function createPreReceiveHook(config) {
    return {
        ...config,
        type: 'function',
        point: 'pre-receive',
    };
}
/**
 * Create an update hook configuration.
 */
export function createUpdateHook(config) {
    return {
        ...config,
        type: 'function',
        point: 'update',
    };
}
/**
 * Create a post-receive hook configuration.
 */
export function createPostReceiveHook(config) {
    return {
        ...config,
        type: 'function',
        point: 'post-receive',
    };
}
/**
 * Create a post-update hook configuration.
 */
export function createPostUpdateHook(config) {
    return {
        ...config,
        type: 'function',
        point: 'post-update',
    };
}
/**
 * Create a webhook configuration.
 *
 * @example
 * ```typescript
 * const webhook = createWebhook({
 *   id: 'ci-trigger',
 *   point: 'post-receive',
 *   url: 'https://ci.example.com/hooks/git',
 *   secret: 'webhook-secret',
 *   retry: { attempts: 3, delay: 1000, backoff: 2 }
 * })
 * ```
 */
export function createWebhook(config) {
    return {
        ...config,
        type: 'webhook',
    };
}
// ============================================================================
// Default Export
// ============================================================================
/**
 * Default global hook registry.
 * Can be used for simple cases where a single registry is sufficient.
 */
export const DEFAULT_REGISTRY = new HookRegistry();
/**
 * @deprecated Use DEFAULT_REGISTRY instead. This alias is provided for backward compatibility.
 */
export const defaultRegistry = DEFAULT_REGISTRY;
//# sourceMappingURL=hooks.js.map