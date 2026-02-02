/**
 * @fileoverview Git receive-pack Protocol Implementation
 *
 * This module implements the server-side of Git's receive-pack service, which
 * handles `git-push` operations. It receives ref updates and packfile data
 * from clients and applies them to the repository.
 *
 * @module wire/receive-pack
 *
 * ## Protocol Flow
 *
 * 1. **Ref Advertisement**: Server advertises current refs and capabilities
 * 2. **Command Reception**: Client sends ref update commands (old-sha new-sha refname)
 * 3. **Packfile Reception**: Client sends packfile with new objects (if needed)
 * 4. **Validation**: Server validates packfile and ref updates
 * 5. **Application**: Server applies updates and sends status report
 *
 * ## Security Considerations
 *
 * - Validates all SHA-1 hashes before processing
 * - Checks fast-forward constraints for updates
 * - Supports atomic pushes for consistency
 * - Validates ref names according to Git rules
 * - Supports pre-receive, update, and post-receive hooks
 *
 * ## Hook System
 *
 * This module provides two hook APIs:
 *
 * ### Simple Hook Functions (backward compatible)
 * - `executePreReceiveHook()` - Run a single pre-receive hook
 * - `executeUpdateHook()` - Run update hooks per-ref
 * - `executePostReceiveHook()` - Run a single post-receive hook
 * - `executePostUpdateHook()` - Run a single post-update hook
 *
 * ### Advanced Hook System (via `./hooks` module)
 * - `HookRegistry` - Register multiple hooks with priorities
 * - `HookExecutor` - Execute hooks with streaming output
 * - Webhook support with HTTP POST, HMAC signatures, and retry logic
 * - Async/parallel hook execution
 * - Hook priority ordering
 *
 * @see {@link https://git-scm.com/docs/pack-protocol} Git Pack Protocol
 * @see {@link https://git-scm.com/docs/git-receive-pack} git-receive-pack Documentation
 *
 * @example Basic push handling
 * ```typescript
 * import {
 *   createReceiveSession,
 *   advertiseReceiveRefs,
 *   handleReceivePack
 * } from './wire/receive-pack'
 *
 * // Create session and advertise refs
 * const session = createReceiveSession('my-repo')
 * const advertisement = await advertiseReceiveRefs(store, { atomic: true })
 *
 * // Handle push request
 * const response = await handleReceivePack(session, requestBody, store)
 * ```
 *
 * @example Advanced hooks with webhooks and priorities
 * ```typescript
 * import {
 *   HookRegistry,
 *   HookExecutor,
 *   createPreReceiveHook,
 *   createWebhook,
 * } from './wire/receive-pack'
 *
 * const registry = new HookRegistry()
 *
 * // Add policy check hook (runs first)
 * registry.register(createPreReceiveHook({
 *   id: 'policy-check',
 *   priority: 10,
 *   handler: async (commands, env) => {
 *     // Validate commands against policy
 *     return { success: true }
 *   }
 * }))
 *
 * // Add CI webhook (runs after policy)
 * registry.register(createWebhook({
 *   id: 'ci-trigger',
 *   point: 'post-receive',
 *   priority: 100,
 *   url: 'https://ci.example.com/hooks/git',
 *   secret: 'webhook-secret',
 *   retry: { attempts: 3, delay: 1000 }
 * }))
 *
 * const executor = new HookExecutor(registry)
 * const result = await executor.executePreReceive(commands, env, {
 *   mode: 'sync',
 *   onOutput: (output) => console.log(`Hook ${output.hookId}: ${output.message}`)
 * })
 * ```
 */
import type { ObjectType } from '../types/objects';
export * from './hooks';
/**
 * Zero SHA - used for ref creation and deletion.
 *
 * @description
 * This 40-character string of zeros is used as a placeholder:
 * - In `oldSha`: indicates a ref is being created (doesn't exist yet)
 * - In `newSha`: indicates a ref is being deleted
 *
 * @example
 * ```typescript
 * // Check if this is a create operation
 * const isCreate = cmd.oldSha === ZERO_SHA
 *
 * // Check if this is a delete operation
 * const isDelete = cmd.newSha === ZERO_SHA
 * ```
 */
export declare const ZERO_SHA: string;
/**
 * A reference (branch, tag, etc.) with its SHA and optional peeled value.
 *
 * @description
 * Represents a Git reference that can be advertised to clients.
 * For annotated tags, the `peeled` field contains the SHA of the
 * underlying commit/object.
 *
 * @example
 * ```typescript
 * const branch: Ref = {
 *   name: 'refs/heads/main',
 *   sha: 'abc123def456...'
 * }
 *
 * const tag: Ref = {
 *   name: 'refs/tags/v1.0.0',
 *   sha: 'tag-object-sha...',
 *   peeled: 'target-commit-sha...'
 * }
 * ```
 */
export interface Ref {
    /** Full ref name (e.g., 'refs/heads/main') */
    name: string;
    /** SHA-1 hash of the object this ref points to */
    sha: string;
    /** For annotated tags, the SHA of the target object */
    peeled?: string;
}
/**
 * Capabilities supported by receive-pack.
 *
 * @description
 * These capabilities are advertised during ref advertisement and
 * negotiated with the client. They control what features are
 * available during the push operation.
 *
 * @example
 * ```typescript
 * const caps: ReceivePackCapabilities = {
 *   reportStatus: true,
 *   deleteRefs: true,
 *   atomic: true,
 *   agent: 'my-server/1.0'
 * }
 * ```
 */
export interface ReceivePackCapabilities {
    /** Client wants status report after push */
    reportStatus?: boolean;
    /** Client wants v2 status report (extended format) */
    reportStatusV2?: boolean;
    /** Allow ref deletion via push */
    deleteRefs?: boolean;
    /** Suppress progress messages */
    quiet?: boolean;
    /** Atomic push - all refs update or none */
    atomic?: boolean;
    /** Support push options (custom metadata) */
    pushOptions?: boolean;
    /** Side-band multiplexing for output */
    sideBand64k?: boolean;
    /** Push certificate nonce for signed pushes */
    pushCert?: string;
    /** Server agent identification string */
    agent?: string;
}
/**
 * Ref update command from client.
 *
 * @description
 * Each command describes a single ref update operation:
 * - **create**: oldSha is ZERO_SHA, newSha is the new value
 * - **update**: oldSha is current value, newSha is new value
 * - **delete**: oldSha is current value, newSha is ZERO_SHA
 *
 * The type is derived from the SHA values.
 *
 * @example
 * ```typescript
 * // Create a new branch
 * const createCmd: RefUpdateCommand = {
 *   oldSha: ZERO_SHA,
 *   newSha: 'abc123...',
 *   refName: 'refs/heads/feature',
 *   type: 'create'
 * }
 *
 * // Update existing branch
 * const updateCmd: RefUpdateCommand = {
 *   oldSha: 'abc123...',
 *   newSha: 'def456...',
 *   refName: 'refs/heads/main',
 *   type: 'update'
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
    /** Command type: create, update, or delete */
    type: 'create' | 'update' | 'delete';
    /** Capabilities from first command line (if any) */
    capabilities?: string[];
}
/**
 * Result of a ref update operation.
 *
 * @description
 * Contains the outcome of a single ref update, including
 * success/failure status and any error message.
 *
 * @example
 * ```typescript
 * const result: RefUpdateResult = {
 *   refName: 'refs/heads/main',
 *   success: true,
 *   oldTarget: 'abc123...',
 *   newTarget: 'def456...'
 * }
 * ```
 */
export interface RefUpdateResult {
    /** The ref that was updated */
    refName: string;
    /** Whether the update succeeded */
    success: boolean;
    /** Error message if update failed */
    error?: string;
    /** Previous ref value (for logging/hooks) */
    oldTarget?: string;
    /** New ref value (for logging/hooks) */
    newTarget?: string;
    /** Whether this was a force update (non-fast-forward) */
    forced?: boolean;
}
/**
 * Packfile validation result.
 *
 * @description
 * Contains the result of validating a packfile's structure,
 * checksum, and object count.
 */
export interface PackfileValidation {
    /** Whether the packfile is valid */
    valid: boolean;
    /** Number of objects in the packfile */
    objectCount?: number;
    /** Error message if validation failed */
    error?: string;
}
/**
 * Hook execution point.
 *
 * @description
 * The different points where hooks can be executed during receive-pack:
 * - `pre-receive`: Before any refs are updated (can reject entire push)
 * - `update`: Before each individual ref update (can reject per-ref)
 * - `post-receive`: After all refs are updated (for notifications)
 * - `post-update`: After refs are updated (simpler than post-receive)
 */
export type HookExecutionPoint = 'pre-receive' | 'update' | 'post-receive' | 'post-update';
/**
 * Hook execution result.
 *
 * @description
 * Contains the result of executing a server-side hook. For pre-receive
 * and update hooks, failure will reject the push.
 */
export interface HookResult {
    /** Whether the hook succeeded */
    success: boolean;
    /** Message from the hook (displayed to client) */
    message?: string;
    /** Whether the push operation succeeded (post-receive) */
    pushSuccess?: boolean;
    /** Whether the hook execution succeeded (post-receive) */
    hookSuccess?: boolean;
    /** Per-ref results from update hook */
    results?: RefUpdateResult[];
}
/**
 * Session state for receive-pack operation.
 *
 * @description
 * Maintains state across the receive-pack protocol phases.
 * This includes capabilities and commands received from the client.
 *
 * @example
 * ```typescript
 * const session = createReceiveSession('my-repo')
 * // session.capabilities and session.commands are populated
 * // as the request is processed
 * ```
 */
export interface ReceivePackSession {
    /** Repository identifier for logging/tracking */
    repoId: string;
    /** Negotiated capabilities */
    capabilities: ReceivePackCapabilities;
    /** Ref update commands from client */
    commands: RefUpdateCommand[];
}
/**
 * Object store interface for receive-pack operations.
 *
 * @description
 * Defines the methods required from an object store to support
 * receive-pack operations. Implementations typically wrap a Git
 * object database or similar storage.
 *
 * This interface shares `getObject` and `hasObject` with the canonical
 * {@link import('../types/storage').BasicObjectStore BasicObjectStore},
 * but differs in important ways:
 *
 * - `storeObject(sha, type, data)` takes the SHA as a parameter (the caller
 *   computes it during packfile unpacking), whereas the canonical
 *   `BasicObjectStore.storeObject(type, data)` computes and returns the SHA.
 * - `getRef` returns a `Ref` object (with `name`, `sha`, `peeled?`) rather
 *   than a plain `string | null`.
 * - `deleteRef` returns `void` rather than `boolean`.
 * - Adds wire-protocol-specific methods: `getCommitParents`, `getRefs`,
 *   `isAncestor`, and the optional `compareAndSwapRef`.
 *
 * Because of these signature differences, this interface cannot directly
 * extend BasicObjectStore. However, any object that implements
 * ReceivePackObjectStore is structurally compatible with BasicObjectStore
 * for its `getObject` and `hasObject` methods.
 *
 * @see {@link import('../types/storage').BasicObjectStore} for the canonical minimal store
 * @see {@link import('../types/storage').ObjectStore} for the canonical full-featured store
 * @see {@link import('./upload-pack').UploadPackObjectStore} for the upload-pack counterpart
 *
 * @example
 * ```typescript
 * class MyObjectStore implements ReceivePackObjectStore {
 *   async getObject(sha: string) {
 *     return this.database.get(sha)
 *   }
 *   async hasObject(sha: string) {
 *     return this.database.has(sha)
 *   }
 *   async setRef(name: string, sha: string) {
 *     await this.database.updateRef(name, sha)
 *   }
 *   // ... other methods
 * }
 * ```
 */
export interface ReceivePackObjectStore {
    /**
     * Get an object by its SHA.
     * @param sha - The SHA-1 hash of the object
     * @returns The object type and data, or null if not found
     */
    getObject(sha: string): Promise<{
        type: ObjectType;
        data: Uint8Array;
    } | null>;
    /**
     * Check if an object exists in the store.
     * @param sha - The SHA-1 hash to check
     * @returns true if the object exists
     */
    hasObject(sha: string): Promise<boolean>;
    /**
     * Get the parent commit SHAs for a commit.
     * @param sha - The commit SHA
     * @returns Array of parent commit SHAs
     */
    getCommitParents(sha: string): Promise<string[]>;
    /**
     * Get all refs in the repository.
     * @returns Array of Ref objects
     */
    getRefs(): Promise<Ref[]>;
    /**
     * Get a specific ref by name.
     * @param name - Full ref name (e.g., 'refs/heads/main')
     * @returns The ref, or null if not found
     */
    getRef(name: string): Promise<Ref | null>;
    /**
     * Set/update a ref to point to a SHA.
     * @param name - Full ref name
     * @param sha - SHA-1 hash to point to
     */
    setRef(name: string, sha: string): Promise<void>;
    /**
     * Delete a ref.
     * @param name - Full ref name to delete
     */
    deleteRef(name: string): Promise<void>;
    /**
     * Store an object in the database.
     * @param sha - The SHA-1 hash of the object
     * @param type - Object type (commit, tree, blob, tag)
     * @param data - Object data
     */
    storeObject(sha: string, type: string, data: Uint8Array): Promise<void>;
    /**
     * Check if one commit is an ancestor of another.
     * @param ancestor - Potential ancestor commit SHA
     * @param descendant - Potential descendant commit SHA
     * @returns true if ancestor is reachable from descendant
     */
    isAncestor(ancestor: string, descendant: string): Promise<boolean>;
    /**
     * Atomically update a ref using compare-and-swap semantics.
     *
     * Reads the current ref value and only writes the new value if the
     * current value matches `expectedOldTarget`. This prevents lost updates
     * from concurrent pushes.
     *
     * @param name - Full ref name (e.g., 'refs/heads/main')
     * @param expectedOldTarget - Expected current value:
     *   - A 40-char SHA means "ref must currently point to this SHA"
     *   - `null` means "ref must not exist" (create-only)
     *   - Empty string or ZERO_SHA means "ref must not exist"
     * @param newTarget - New SHA to set the ref to
     * @returns `true` if the swap succeeded, `false` if the current value didn't match
     */
    compareAndSwapRef?(name: string, expectedOldTarget: string | null, newTarget: string): Promise<boolean>;
}
/**
 * Parsed receive-pack request.
 *
 * @description
 * Contains all data parsed from a receive-pack request, including
 * ref update commands, capabilities, packfile data, and push options.
 */
export interface ReceivePackRequest {
    /** Ref update commands */
    commands: RefUpdateCommand[];
    /** Capabilities from first command */
    capabilities: string[];
    /** Packfile binary data */
    packfile: Uint8Array;
    /** Push options (if push-options capability enabled) */
    pushOptions: string[];
}
/**
 * Report status input.
 *
 * @description
 * Data needed to generate a status report response to the client.
 */
export interface ReportStatusInput {
    /** Status of packfile unpacking ('ok' or error message) */
    unpackStatus: string;
    /** Results for each ref update */
    refResults: RefUpdateResult[];
    /** Additional options (for report-status-v2) */
    options?: Record<string, string>;
}
/**
 * Unpack result.
 *
 * @description
 * Result of unpacking objects from a packfile into the object store.
 */
export interface UnpackResult {
    /** Whether unpacking succeeded */
    success: boolean;
    /** Number of objects unpacked */
    objectsUnpacked: number;
    /** SHAs of unpacked objects */
    unpackedShas: string[];
    /** Error message if unpacking failed */
    error?: string;
}
/**
 * Process commands result.
 *
 * @description
 * Result of processing ref update commands.
 */
export interface ProcessCommandsResult {
    /** Results for each ref update */
    results: RefUpdateResult[];
}
/**
 * Atomic ref update result.
 *
 * @description
 * Result of an atomic push operation where all refs update
 * together or none do.
 */
export interface AtomicRefUpdateResult {
    /** Whether all updates succeeded */
    success: boolean;
    /** Results for each ref */
    results: RefUpdateResult[];
}
/**
 * Permission check result.
 *
 * @description
 * Result of checking whether an operation is permitted.
 */
export interface PermissionCheckResult {
    /** Whether the operation is allowed */
    allowed: boolean;
    /** Reason for rejection (if not allowed) */
    reason?: string;
}
/**
 * Permission check options.
 *
 * @description
 * Options for configuring permission checks.
 */
export interface PermissionCheckOptions {
    /** Refs that cannot be modified */
    protectedRefs?: string[];
    /** Glob patterns of allowed refs */
    allowedRefPatterns?: string[];
}
/**
 * Process commands options.
 *
 * @description
 * Options for processing ref update commands.
 */
export interface ProcessCommandsOptions {
    /** Allow non-fast-forward updates */
    forcePush?: boolean;
}
/**
 * Packfile validation options.
 *
 * @description
 * Options for validating packfile structure and content.
 */
export interface PackfileValidationOptions {
    /** Verify SHA-1 checksum */
    verifyChecksum?: boolean;
    /** Allow empty packfile */
    allowEmpty?: boolean;
}
/**
 * Unpack options.
 *
 * @description
 * Options for unpacking objects from a packfile.
 */
export interface UnpackOptions {
    /** Resolve delta objects */
    resolveDelta?: boolean;
    /** Progress callback */
    onProgress?: (message: string) => void;
    /** Use quarantine area for unpacking (isolates objects until validation passes) */
    useQuarantine?: boolean;
}
/**
 * Quarantine environment for packfile unpacking.
 *
 * @description
 * Provides an isolated environment for unpacking objects before they're
 * committed to the main object store. This allows validation to fail
 * without polluting the repository with partial data.
 *
 * @example
 * ```typescript
 * const quarantine = createQuarantine('push-123')
 * try {
 *   await unpackObjects(packfile, quarantine.store, { useQuarantine: true })
 *   // Validate objects...
 *   await quarantine.commit(mainStore)
 * } catch (e) {
 *   await quarantine.abort()
 *   throw e
 * }
 * ```
 */
export interface QuarantineEnvironment {
    /** Unique quarantine ID */
    id: string;
    /** Isolated object store for quarantined objects */
    store: ReceivePackObjectStore;
    /** Commit quarantined objects to main store */
    commit: (mainStore: ReceivePackObjectStore) => Promise<void>;
    /** Abort and clean up quarantined objects */
    abort: () => Promise<void>;
    /** Get list of quarantined object SHAs */
    getObjectShas: () => string[];
}
/**
 * Hook options.
 *
 * @description
 * Options for hook execution.
 */
export interface HookOptions {
    /** Timeout in milliseconds */
    timeout?: number;
    /** Push options to pass to hooks */
    pushOptions?: string[];
}
/**
 * Build capability string for receive-pack advertisement.
 *
 * @description
 * Converts a capabilities object into a space-separated string suitable
 * for inclusion in the ref advertisement. Boolean capabilities become
 * simple names, while capabilities with values become "name=value".
 *
 * @param capabilities - Capabilities to advertise
 * @returns Space-separated capability string
 *
 * @example
 * ```typescript
 * const caps: ReceivePackCapabilities = {
 *   reportStatus: true,
 *   deleteRefs: true,
 *   atomic: true,
 *   agent: 'my-server/1.0'
 * }
 * const str = buildReceiveCapabilityString(caps)
 * // 'report-status delete-refs atomic agent=my-server/1.0'
 * ```
 */
export declare function buildReceiveCapabilityString(capabilities: ReceivePackCapabilities): string;
/**
 * Parse capabilities from string.
 *
 * @description
 * Parses a space-separated capability string into a structured
 * capabilities object.
 *
 * @param capsString - Space-separated capabilities
 * @returns Parsed capabilities object
 *
 * @example
 * ```typescript
 * const caps = parseReceiveCapabilities(
 *   'report-status delete-refs atomic agent=git/2.30.0'
 * )
 * // caps.reportStatus === true
 * // caps.deleteRefs === true
 * // caps.atomic === true
 * // caps.agent === 'git/2.30.0'
 * ```
 */
export declare function parseReceiveCapabilities(capsString: string): ReceivePackCapabilities;
/**
 * Create a new receive-pack session.
 *
 * @description
 * Initializes a new session for a receive-pack operation. The session
 * tracks state across the protocol phases.
 *
 * @param repoId - Repository identifier for logging/tracking
 * @returns New session object
 *
 * @example
 * ```typescript
 * const session = createReceiveSession('my-repo')
 * // session.capabilities === {}
 * // session.commands === []
 * ```
 */
export declare function createReceiveSession(repoId: string): ReceivePackSession;
/**
 * Advertise refs to client.
 *
 * @description
 * Generates the ref advertisement response for the initial phase of
 * receive-pack. This includes:
 * - HEAD reference with capabilities (or zero SHA for empty repos)
 * - All refs sorted alphabetically
 * - Peeled refs for annotated tags
 *
 * @param store - Object store to get refs from
 * @param capabilities - Optional server capabilities to advertise
 * @returns Pkt-line formatted ref advertisement
 *
 * @example
 * ```typescript
 * const advertisement = await advertiseReceiveRefs(store, {
 *   reportStatus: true,
 *   deleteRefs: true,
 *   atomic: true
 * })
 * // Send as response to GET /info/refs?service=git-receive-pack
 * ```
 */
export declare function advertiseReceiveRefs(store: ReceivePackObjectStore, capabilities?: ReceivePackCapabilities): Promise<string>;
/**
 * Parse a single command line.
 *
 * @description
 * Parses a ref update command line in the format:
 * `<old-sha> <new-sha> <refname>[NUL<capabilities>]`
 *
 * The first command line may include capabilities after a NUL byte.
 *
 * @param line - Command line to parse
 * @returns Parsed command object
 *
 * @throws {Error} If the line format is invalid or SHAs are malformed
 *
 * @example
 * ```typescript
 * // Simple command
 * const cmd = parseCommandLine(
 *   'abc123... def456... refs/heads/main'
 * )
 *
 * // Command with capabilities (first line)
 * const cmdWithCaps = parseCommandLine(
 *   'abc123... def456... refs/heads/main\0report-status atomic'
 * )
 * ```
 */
export declare function parseCommandLine(line: string): RefUpdateCommand;
/**
 * Parse complete receive-pack request.
 *
 * @description
 * Parses the full receive-pack request body, extracting:
 * - Ref update commands
 * - Capabilities (from first command)
 * - Push options (if enabled)
 * - Packfile data
 *
 * @param data - Raw request body as Uint8Array
 * @returns Parsed request object
 *
 * @throws {Error} If the request format is invalid
 *
 * @example
 * ```typescript
 * const request = parseReceivePackRequest(requestBody)
 * // request.commands - array of RefUpdateCommand
 * // request.capabilities - capabilities from first command
 * // request.packfile - packfile binary data
 * // request.pushOptions - push options (if enabled)
 * ```
 */
export declare function parseReceivePackRequest(data: Uint8Array): ReceivePackRequest;
/**
 * Validate packfile structure.
 *
 * @description
 * Validates a packfile's structure, including:
 * - PACK signature (4 bytes)
 * - Version number (must be 2 or 3)
 * - Object count
 * - Checksum (if verifyChecksum option is true)
 *
 * @param packfile - Packfile binary data
 * @param options - Validation options
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = await validatePackfile(packData, { verifyChecksum: true })
 * if (!result.valid) {
 *   console.error('Invalid packfile:', result.error)
 * } else {
 *   console.log('Objects in pack:', result.objectCount)
 * }
 * ```
 */
export declare function validatePackfile(packfile: Uint8Array, options?: PackfileValidationOptions): Promise<PackfileValidation>;
/**
 * Unpack objects from packfile.
 *
 * @description
 * Extracts and stores objects from a packfile into the object store.
 * Handles both regular objects and delta-compressed objects.
 *
 * @param packfile - Packfile binary data
 * @param _store - Object store to store unpacked objects
 * @param options - Unpack options
 * @returns Unpack result
 *
 * @example
 * ```typescript
 * const result = await unpackObjects(packfile, store, {
 *   resolveDelta: true,
 *   onProgress: (msg) => console.log(msg)
 * })
 * if (result.success) {
 *   console.log('Unpacked', result.objectsUnpacked, 'objects')
 * }
 * ```
 */
export declare function unpackObjects(packfile: Uint8Array, _store: ReceivePackObjectStore, options?: UnpackOptions): Promise<UnpackResult>;
/**
 * Create a quarantine environment for isolated packfile unpacking.
 *
 * @description
 * Creates an isolated environment for unpacking objects before committing
 * them to the main object store. This follows Git's quarantine pattern
 * which prevents partial or malicious data from polluting the repository
 * if validation fails.
 *
 * The quarantine environment:
 * - Maintains objects in an isolated store
 * - Falls back to the main store for reading existing objects (deltas)
 * - Can commit all quarantined objects atomically on success
 * - Cleans up on abort without affecting the main store
 *
 * @param mainStore - The main object store (for reading existing objects)
 * @param quarantineId - Optional unique ID for this quarantine session
 * @returns A quarantine environment
 *
 * @example
 * ```typescript
 * const quarantine = createQuarantine(mainStore, 'push-abc123')
 *
 * try {
 *   // Unpack to quarantine store
 *   const result = await unpackObjects(packfile, quarantine.store)
 *   if (!result.success) throw new Error(result.error)
 *
 *   // Validate objects in quarantine
 *   for (const sha of quarantine.getObjectShas()) {
 *     await validateObject(sha, quarantine.store)
 *   }
 *
 *   // Success - commit to main store
 *   await quarantine.commit(mainStore)
 * } catch (e) {
 *   // Failure - clean up quarantine
 *   await quarantine.abort()
 *   throw e
 * }
 * ```
 */
export declare function createQuarantine(mainStore: ReceivePackObjectStore, quarantineId?: string): QuarantineEnvironment;
/**
 * Unpack options with quarantine support.
 */
export interface UnpackWithQuarantineOptions extends UnpackOptions {
    /** Session ID for quarantine (for logging/debugging) */
    sessionId?: string;
}
/**
 * Unpack packfile with quarantine support.
 *
 * @description
 * High-level helper that unpacks a packfile using the quarantine pattern.
 * Objects are first unpacked to an isolated quarantine environment, then
 * committed to the main store only if unpacking succeeds.
 *
 * This is the recommended way to unpack pushes as it prevents partial
 * or corrupt data from being committed to the repository.
 *
 * @param packfile - Packfile binary data
 * @param store - Main object store
 * @param options - Unpack options
 * @returns Unpack result
 *
 * @example
 * ```typescript
 * // Safe unpacking with automatic quarantine
 * const result = await unpackWithQuarantine(packfile, store, {
 *   sessionId: 'push-123',
 *   onProgress: (msg) => console.log(msg)
 * })
 *
 * if (result.success) {
 *   console.log(`Unpacked ${result.objectsUnpacked} objects`)
 * } else {
 *   console.error(`Unpack failed: ${result.error}`)
 * }
 * ```
 */
export declare function unpackWithQuarantine(packfile: Uint8Array, store: ReceivePackObjectStore, options?: UnpackWithQuarantineOptions): Promise<UnpackResult>;
/**
 * Validate ref name according to git rules.
 *
 * @description
 * Validates a ref name against Git's naming rules:
 * - Must not be empty
 * - Must not start or end with `/`
 * - Must not contain `//` or `..`
 * - Must not contain control characters
 * - Must not contain spaces, `~`, `^`, `:`, or `@{`
 * - Must not end with `.lock`
 * - Components must not start with `.`
 *
 * Security considerations:
 * - Prevents path traversal attacks via `../` sequences
 * - Rejects absolute paths
 * - Validates ref is within refs/ namespace or is HEAD
 * - Blocks URL-encoded traversal attempts
 *
 * @param refName - Ref name to validate
 * @returns true if the ref name is valid
 *
 * @example
 * ```typescript
 * validateRefName('refs/heads/main')      // true
 * validateRefName('refs/heads/feature')   // true
 * validateRefName('refs/heads/.hidden')   // false (starts with .)
 * validateRefName('refs/heads/a..b')      // false (contains ..)
 * validateRefName('refs/heads/a b')       // false (contains space)
 * validateRefName('refs/../../../etc/passwd')  // false (path traversal)
 * ```
 */
export declare function validateRefName(refName: string): boolean;
/**
 * Validate fast-forward update.
 *
 * @description
 * Checks if updating a ref from oldSha to newSha is a fast-forward.
 * A fast-forward means oldSha is an ancestor of newSha.
 *
 * Creation and deletion are always allowed (not fast-forward questions).
 *
 * @param oldSha - Current ref value (or ZERO_SHA for create)
 * @param newSha - New ref value (or ZERO_SHA for delete)
 * @param store - Object store to check ancestry
 * @returns true if the update is allowed
 *
 * @example
 * ```typescript
 * // Fast-forward update
 * const ok = await validateFastForward(parent, child, store)  // true
 *
 * // Non-fast-forward update
 * const notOk = await validateFastForward(child, parent, store)  // false
 *
 * // Creation always allowed
 * const create = await validateFastForward(ZERO_SHA, sha, store)  // true
 * ```
 */
export declare function validateFastForward(oldSha: string, newSha: string, store: ReceivePackObjectStore): Promise<boolean>;
/**
 * Check ref permissions.
 *
 * @description
 * Checks whether a ref operation is allowed based on:
 * - Protected refs (cannot be modified)
 * - Allowed ref patterns (must match at least one)
 * - Force push restrictions on protected branches
 *
 * @param refName - Ref being modified
 * @param operation - Type of operation
 * @param options - Permission check options
 * @returns Permission check result
 *
 * @example
 * ```typescript
 * const result = await checkRefPermissions(
 *   'refs/heads/main',
 *   'force-update',
 *   { protectedRefs: ['refs/heads/main'] }
 * )
 * // result.allowed === false
 * // result.reason === 'force push not allowed on protected branch'
 * ```
 */
export declare function checkRefPermissions(refName: string, operation: 'create' | 'update' | 'delete' | 'force-update', options: PermissionCheckOptions): Promise<PermissionCheckResult>;
/**
 * Process ref update commands.
 *
 * @description
 * Validates and processes ref update commands without actually
 * applying them. Checks:
 * - Ref name validity
 * - Current ref state matches expected old SHA
 * - Fast-forward constraints (unless force push)
 * - Delete-refs capability for deletions
 *
 * @param session - Current session state
 * @param commands - Commands to process
 * @param store - Object store
 * @param options - Processing options
 * @returns Processing result with per-ref status
 *
 * @example
 * ```typescript
 * const result = await processCommands(session, commands, store)
 * for (const refResult of result.results) {
 *   if (!refResult.success) {
 *     console.error(`Failed to update ${refResult.refName}: ${refResult.error}`)
 *   }
 * }
 * ```
 */
export declare function processCommands(session: ReceivePackSession, commands: RefUpdateCommand[], store: ReceivePackObjectStore, options?: ProcessCommandsOptions): Promise<ProcessCommandsResult>;
/**
 * Update refs in the store.
 *
 * @description
 * Actually applies ref updates to the object store. Should only be
 * called after validation via processCommands.
 *
 * @param commands - Commands to apply
 * @param store - Object store
 *
 * @example
 * ```typescript
 * // After validation
 * await updateRefs(commands, store)
 * ```
 */
export declare function updateRefs(commands: RefUpdateCommand[], store: ReceivePackObjectStore): Promise<void>;
/**
 * Atomic ref update - all or nothing.
 *
 * @description
 * Applies all ref updates atomically. If any update fails, all
 * changes are rolled back to the original state.
 *
 * @param commands - Commands to apply
 * @param store - Object store
 * @returns Atomic update result
 *
 * @example
 * ```typescript
 * const result = await atomicRefUpdate(commands, store)
 * if (result.success) {
 *   console.log('All refs updated successfully')
 * } else {
 *   console.error('Atomic push failed, all changes rolled back')
 * }
 * ```
 */
export declare function atomicRefUpdate(commands: RefUpdateCommand[], store: ReceivePackObjectStore): Promise<AtomicRefUpdateResult>;
/**
 * Pre-receive hook function signature.
 *
 * Called before any refs are updated. Can reject the entire push by
 * returning `{ success: false }`.
 *
 * @param commands - Array of ref update commands to be executed
 * @param env - Environment variables (e.g., GIT_PUSH_OPTION_*)
 * @returns Hook result indicating success or failure
 */
type PreReceiveHookFn = (commands: RefUpdateCommand[], env: Record<string, string>) => Promise<HookResult>;
/**
 * Update hook function signature.
 *
 * Called once for each ref being updated. Can reject individual refs
 * by returning `{ success: false }`.
 *
 * @param refName - Full ref name being updated (e.g., 'refs/heads/main')
 * @param oldSha - Current SHA of the ref (ZERO_SHA for new refs)
 * @param newSha - New SHA for the ref (ZERO_SHA for deletions)
 * @param env - Environment variables
 * @returns Hook result indicating success or failure
 */
type UpdateHookFn = (refName: string, oldSha: string, newSha: string, env: Record<string, string>) => Promise<HookResult>;
/**
 * Post-receive hook function signature.
 *
 * Called after all refs have been updated. Cannot affect the push result
 * but useful for notifications, CI triggers, etc.
 *
 * @param commands - Array of ref update commands that were executed
 * @param results - Results for each ref update
 * @param env - Environment variables (includes GIT_PUSH_OPTION_* if enabled)
 * @returns Hook result (failure does not affect push success)
 */
type PostReceiveHookFn = (commands: RefUpdateCommand[], results: RefUpdateResult[], env: Record<string, string>) => Promise<HookResult>;
/**
 * Post-update hook function signature.
 *
 * Simplified version of post-receive that only receives ref names.
 * Called after refs are updated.
 *
 * @param refNames - Array of successfully updated ref names
 * @returns Hook result
 */
type PostUpdateHookFn = (refNames: string[]) => Promise<HookResult>;
/**
 * Execute pre-receive hook.
 *
 * @description
 * Runs the pre-receive hook before any refs are updated.
 * The hook receives all commands and can reject the entire push.
 *
 * @param commands - Commands to be executed
 * @param _store - Object store
 * @param hookFn - Hook function to execute
 * @param env - Environment variables for the hook
 * @param options - Hook options
 * @returns Hook result
 *
 * @example
 * ```typescript
 * const result = await executePreReceiveHook(
 *   commands,
 *   store,
 *   async (cmds, env) => {
 *     // Validate commands
 *     return { success: true }
 *   },
 *   { GIT_DIR: '/path/to/repo' },
 *   { timeout: 30000 }
 * )
 * ```
 */
export declare function executePreReceiveHook(commands: RefUpdateCommand[], _store: ReceivePackObjectStore, hookFn: PreReceiveHookFn, env?: Record<string, string>, options?: HookOptions): Promise<HookResult>;
/**
 * Execute update hook for each ref.
 *
 * @description
 * Runs the update hook for each ref being updated.
 * Unlike pre-receive, this hook can reject individual refs.
 *
 * @param commands - Commands being executed
 * @param _store - Object store
 * @param hookFn - Hook function to execute per-ref
 * @param env - Environment variables for the hook
 * @returns Results for each ref
 *
 * @example
 * ```typescript
 * const { results } = await executeUpdateHook(
 *   commands,
 *   store,
 *   async (refName, oldSha, newSha, env) => {
 *     // Check if update is allowed for this ref
 *     return { success: true }
 *   },
 *   { GIT_DIR: '/path/to/repo' }
 * )
 * ```
 */
export declare function executeUpdateHook(commands: RefUpdateCommand[], _store: ReceivePackObjectStore, hookFn: UpdateHookFn, env?: Record<string, string>): Promise<{
    results: RefUpdateResult[];
}>;
/**
 * Execute post-receive hook.
 *
 * @description
 * Runs the post-receive hook after all refs are updated.
 * This hook cannot affect the push result but is useful for
 * notifications, CI triggers, etc.
 *
 * @param commands - Commands that were executed
 * @param results - Results of ref updates
 * @param _store - Object store
 * @param hookFn - Hook function to execute
 * @param options - Hook options
 * @returns Hook execution result
 *
 * @example
 * ```typescript
 * const { hookSuccess } = await executePostReceiveHook(
 *   commands,
 *   results,
 *   store,
 *   async (cmds, results, env) => {
 *     // Trigger CI, send notifications, etc.
 *     return { success: true }
 *   },
 *   { pushOptions: ['ci.skip'] }
 * )
 * ```
 */
export declare function executePostReceiveHook(commands: RefUpdateCommand[], results: RefUpdateResult[], _store: ReceivePackObjectStore, hookFn: PostReceiveHookFn, options?: HookOptions): Promise<{
    pushSuccess: boolean;
    hookSuccess: boolean;
}>;
/**
 * Execute post-update hook.
 *
 * @description
 * Runs the post-update hook with the names of successfully updated refs.
 * Simpler than post-receive, takes only ref names as arguments.
 *
 * @param _commands - Commands that were executed
 * @param results - Results of ref updates
 * @param hookFn - Hook function to execute
 *
 * @example
 * ```typescript
 * await executePostUpdateHook(
 *   commands,
 *   results,
 *   async (refNames) => {
 *     console.log('Updated refs:', refNames)
 *     return { success: true }
 *   }
 * )
 * ```
 */
export declare function executePostUpdateHook(_commands: RefUpdateCommand[], results: RefUpdateResult[], hookFn: PostUpdateHookFn): Promise<void>;
/**
 * Format report-status response.
 *
 * @description
 * Creates a pkt-line formatted status report response to send
 * to the client after processing the push. The format is:
 * 1. Unpack status: "unpack ok" or "unpack <error>"
 * 2. Ref status lines: "ok <refname>" or "ng <refname> <error>"
 * 3. Flush packet
 *
 * @param input - Status report data
 * @returns Pkt-line formatted status report
 *
 * @example
 * ```typescript
 * const report = formatReportStatus({
 *   unpackStatus: 'ok',
 *   refResults: [
 *     { refName: 'refs/heads/main', success: true },
 *     { refName: 'refs/heads/feature', success: false, error: 'non-fast-forward' }
 *   ]
 * })
 * // "0010unpack ok\n0019ok refs/heads/main\n002cng refs/heads/feature non-fast-forward\n0000"
 * ```
 */
export declare function formatReportStatus(input: ReportStatusInput): string;
/**
 * Format report-status-v2 response.
 *
 * @description
 * Creates an extended status report for report-status-v2 capability.
 * Adds option lines before the unpack status and supports forced
 * update indication.
 *
 * @param input - Status report data
 * @returns Pkt-line formatted v2 status report
 *
 * @example
 * ```typescript
 * const report = formatReportStatusV2({
 *   unpackStatus: 'ok',
 *   refResults: [
 *     { refName: 'refs/heads/main', success: true, forced: true }
 *   ],
 *   options: { 'object-format': 'sha1' }
 * })
 * ```
 */
export declare function formatReportStatusV2(input: ReportStatusInput): string;
/**
 * Format rejection message.
 *
 * @description
 * Creates a rejection message in the appropriate format based
 * on the client's capabilities (side-band or report-status).
 *
 * @param refName - Ref that was rejected
 * @param reason - Reason for rejection
 * @param options - Formatting options
 * @returns Formatted rejection message
 *
 * @example
 * ```typescript
 * // Side-band format
 * const msg = rejectPush('refs/heads/main', 'protected branch', { sideBand: true })
 * // Returns Uint8Array with side-band channel 3 message
 *
 * // Report-status format
 * const msg = rejectPush('refs/heads/main', 'protected branch', { reportStatus: true })
 * // Returns "ng refs/heads/main protected branch"
 * ```
 */
export declare function rejectPush(refName: string, reason: string, options: {
    reportStatus?: boolean;
    sideBand?: boolean;
}): string | Uint8Array;
/**
 * Handle complete receive-pack request.
 *
 * @description
 * This is the main entry point that handles the full receive-pack
 * protocol flow:
 * 1. Parse request (commands, capabilities, packfile)
 * 2. Validate and unpack packfile (if present)
 * 3. Process each ref update command
 * 4. Return status report (if requested)
 *
 * @param session - Receive pack session
 * @param request - Raw request data
 * @param store - Object store
 * @returns Response data (status report or empty)
 *
 * @example
 * ```typescript
 * const session = createReceiveSession('my-repo')
 * const response = await handleReceivePack(session, requestBody, store)
 * // response contains status report if report-status was enabled
 * ```
 */
export declare function handleReceivePack(session: ReceivePackSession, request: Uint8Array, store: ReceivePackObjectStore): Promise<Uint8Array>;
//# sourceMappingURL=receive-pack.d.ts.map