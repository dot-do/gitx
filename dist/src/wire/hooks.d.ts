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
import type { RefUpdateCommand, RefUpdateResult, HookResult } from './receive-pack';
/**
 * Hook execution type determines how the hook is invoked.
 */
export type HookType = 'function' | 'webhook';
/**
 * Hook execution mode.
 * - 'sync': Hooks run sequentially, each must complete before the next
 * - 'async': Hooks run in parallel (results collected at end)
 */
export type HookMode = 'sync' | 'async';
/**
 * Hook execution point in the receive-pack flow.
 */
export type HookPoint = 'pre-receive' | 'update' | 'post-receive' | 'post-update';
/**
 * Base configuration for all hook types.
 */
export interface BaseHookConfig {
    /** Unique identifier for the hook */
    id: string;
    /** Hook execution point */
    point: HookPoint;
    /** Priority (lower runs first, default: 100) */
    priority?: number;
    /** Timeout in milliseconds (default: 30000) */
    timeout?: number;
    /** Whether hook is enabled */
    enabled?: boolean;
    /** Description for logging/debugging */
    description?: string;
}
/**
 * Function-based hook configuration.
 */
export interface FunctionHookConfig extends BaseHookConfig {
    type: 'function';
    /** The hook function to execute */
    handler: PreReceiveHookHandler | UpdateHookHandler | PostReceiveHookHandler | PostUpdateHookHandler;
}
/**
 * Webhook configuration for HTTP POST hooks.
 */
export interface WebhookConfig extends BaseHookConfig {
    type: 'webhook';
    /** URL to POST hook data to */
    url: string;
    /** HTTP method (default: POST) */
    method?: 'POST' | 'PUT';
    /** Additional headers to send */
    headers?: Record<string, string>;
    /** Secret for signing the payload (HMAC-SHA256) */
    secret?: string;
    /** Whether to include full command data (default: true) */
    includePayload?: boolean;
    /** Retry configuration */
    retry?: {
        /** Number of retry attempts (default: 0) */
        attempts?: number;
        /** Delay between retries in ms (default: 1000) */
        delay?: number;
        /** Backoff multiplier (default: 2) */
        backoff?: number;
    };
}
/**
 * Union type for all hook configurations.
 */
export type HookConfig = FunctionHookConfig | WebhookConfig;
/**
 * Hook handler function signatures.
 */
export type PreReceiveHookHandler = (commands: RefUpdateCommand[], env: Record<string, string>) => Promise<HookResult>;
export type UpdateHookHandler = (refName: string, oldSha: string, newSha: string, env: Record<string, string>) => Promise<HookResult>;
export type PostReceiveHookHandler = (commands: RefUpdateCommand[], results: RefUpdateResult[], env: Record<string, string>) => Promise<HookResult>;
export type PostUpdateHookHandler = (refNames: string[]) => Promise<HookResult>;
/**
 * Webhook payload structure.
 */
export interface WebhookPayload {
    /** Hook execution point */
    hook: HookPoint;
    /** Timestamp (ISO 8601) */
    timestamp: string;
    /** Repository identifier */
    repository?: string;
    /** Commands being processed */
    commands?: RefUpdateCommand[];
    /** Results (for post-receive) */
    results?: RefUpdateResult[];
    /** Environment variables */
    env?: Record<string, string>;
    /** For update hook: specific ref info */
    ref?: {
        name: string;
        oldSha: string;
        newSha: string;
    };
}
/**
 * Output from a hook execution.
 */
export interface HookOutput {
    /** Hook identifier */
    hookId: string;
    /** Whether the hook succeeded */
    success: boolean;
    /** Output message from the hook */
    message?: string;
    /** Duration in milliseconds */
    duration: number;
    /** Timestamp when hook started */
    startedAt: Date;
    /** Timestamp when hook completed */
    completedAt: Date;
}
/**
 * Stream callback for real-time hook output.
 */
export type HookOutputCallback = (output: HookOutput) => void;
/**
 * Aggregated result from running multiple hooks.
 */
export interface HookExecutionResult {
    /** Overall success (all hooks passed) */
    success: boolean;
    /** Results from each hook */
    outputs: HookOutput[];
    /** Combined message from all hooks */
    message?: string;
    /** Total execution time in ms */
    totalDuration: number;
}
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
export declare class HookRegistry {
    private hooks;
    /**
     * Register a hook configuration.
     */
    register(config: HookConfig): void;
    /**
     * Unregister a hook by ID.
     */
    unregister(id: string): boolean;
    /**
     * Get hooks for a specific execution point, sorted by priority.
     */
    getHooksForPoint(point: HookPoint): HookConfig[];
    /**
     * Get a specific hook by ID.
     */
    getHook(id: string): HookConfig | undefined;
    /**
     * Enable/disable a hook.
     */
    setEnabled(id: string, enabled: boolean): boolean;
    /**
     * Get all registered hooks.
     */
    getAllHooks(): HookConfig[];
    /**
     * Clear all hooks.
     */
    clear(): void;
}
/**
 * Options for hook execution.
 */
export interface HookExecutorOptions {
    /** Execution mode: sync (sequential) or async (parallel) */
    mode?: HookMode;
    /** Callback for streaming hook output */
    onOutput?: HookOutputCallback;
    /** Repository ID for logging */
    repoId?: string;
    /** Fetch implementation for webhooks (default: global fetch) */
    fetch?: typeof fetch;
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
export declare class HookExecutor {
    private registry;
    private defaultOptions;
    constructor(registry: HookRegistry, defaultOptions?: HookExecutorOptions);
    /**
     * Execute pre-receive hooks.
     */
    executePreReceive(commands: RefUpdateCommand[], env?: Record<string, string>, options?: HookExecutorOptions): Promise<HookExecutionResult>;
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
    executeUpdate(commands: RefUpdateCommand[], env?: Record<string, string>, options?: HookExecutorOptions): Promise<{
        results: RefUpdateResult[];
    }>;
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
    private executeUpdateHooksForRef;
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
    private executeSingleUpdateHook;
    /**
     * Invoke an update hook (function or webhook) with timeout.
     *
     * @param hook - The hook configuration
     * @param command - The ref update command
     * @param env - Environment variables
     * @param options - Execution options including repoId for webhooks
     * @returns The hook result indicating success or failure
     */
    private invokeUpdateHook;
    /**
     * Execute post-receive hooks.
     */
    executePostReceive(commands: RefUpdateCommand[], results: RefUpdateResult[], env?: Record<string, string>, options?: HookExecutorOptions): Promise<{
        pushSuccess: boolean;
        hookSuccess: boolean;
    }>;
    /**
     * Execute post-update hooks.
     */
    executePostUpdate(results: RefUpdateResult[], options?: HookExecutorOptions): Promise<void>;
    /**
     * Creates a HookOutput object from execution results.
     *
     * @param hookId - The unique identifier of the hook
     * @param success - Whether the hook execution succeeded
     * @param message - Optional message from the hook
     * @param startTime - Timestamp when execution started
     * @returns A fully populated HookOutput object
     */
    private createHookOutput;
    /**
     * Executes a single hook and returns its output.
     *
     * @param hook - The hook configuration to execute
     * @param executor - Function that performs the actual hook execution
     * @param onOutput - Optional callback for streaming output
     * @returns The hook output result
     */
    private executeSingleHook;
    /**
     * Execute a list of hooks with the given executor function.
     *
     * @param hooks - Array of hook configurations to execute
     * @param point - The hook execution point (pre-receive, post-receive, etc.)
     * @param executor - Function that executes a single hook
     * @param options - Execution options including mode and callbacks
     * @returns Aggregated result from all hook executions
     */
    private executeHooks;
    /**
     * Executes hooks in parallel (async mode).
     *
     * @param hooks - Array of hook configurations to execute
     * @param executor - Function that executes a single hook
     * @param onOutput - Optional callback for streaming output
     * @returns Array of hook outputs
     */
    private executeHooksInParallel;
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
    private executeHooksSequentially;
    /**
     * Builds the final execution result from hook outputs.
     *
     * @param outputs - Array of hook outputs
     * @param totalStart - Timestamp when execution started
     * @returns Aggregated execution result
     */
    private buildExecutionResult;
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
    private executeWebhook;
    /**
     * Builds HTTP headers for a webhook request.
     *
     * @param config - Webhook configuration
     * @param payload - Webhook payload (for hook point header)
     * @param body - Serialized request body (for HMAC signing)
     * @returns Headers object ready for the HTTP request
     */
    private buildWebhookHeaders;
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
    private executeWebhookWithRetry;
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
    private attemptWebhookRequest;
    /**
     * Extracts message from webhook response body.
     *
     * @param response - HTTP response object
     * @param webhookId - Webhook identifier for default message
     * @returns Extracted message or default success message
     */
    private extractWebhookResponseMessage;
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
    private signPayload;
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
    private executeWithTimeout;
    /**
     * Delays execution for the specified duration.
     *
     * @param ms - Duration to delay in milliseconds
     */
    private delay;
}
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
export declare function createPreReceiveHook(config: Omit<FunctionHookConfig, 'type' | 'point'> & {
    handler: PreReceiveHookHandler;
}): FunctionHookConfig;
/**
 * Create an update hook configuration.
 */
export declare function createUpdateHook(config: Omit<FunctionHookConfig, 'type' | 'point'> & {
    handler: UpdateHookHandler;
}): FunctionHookConfig;
/**
 * Create a post-receive hook configuration.
 */
export declare function createPostReceiveHook(config: Omit<FunctionHookConfig, 'type' | 'point'> & {
    handler: PostReceiveHookHandler;
}): FunctionHookConfig;
/**
 * Create a post-update hook configuration.
 */
export declare function createPostUpdateHook(config: Omit<FunctionHookConfig, 'type' | 'point'> & {
    handler: PostUpdateHookHandler;
}): FunctionHookConfig;
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
export declare function createWebhook(config: Omit<WebhookConfig, 'type'>): WebhookConfig;
/**
 * Default global hook registry.
 * Can be used for simple cases where a single registry is sufficient.
 */
export declare const DEFAULT_REGISTRY: HookRegistry;
/**
 * @deprecated Use DEFAULT_REGISTRY instead. This alias is provided for backward compatibility.
 */
export declare const defaultRegistry: HookRegistry;
//# sourceMappingURL=hooks.d.ts.map