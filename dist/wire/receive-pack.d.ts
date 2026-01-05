/**
 * Git receive-pack protocol implementation
 *
 * The receive-pack service is the server-side of git push. It:
 * 1. Advertises refs and capabilities
 * 2. Receives ref updates and pack data
 * 3. Validates and applies the updates
 *
 * Protocol flow:
 * 1. Server advertises refs with capabilities
 * 2. Client sends ref update commands (old-sha new-sha refname)
 * 3. Client sends packfile with new objects
 * 4. Server validates packfile and updates refs
 * 5. Server sends status report (if report-status enabled)
 *
 * Reference: https://git-scm.com/docs/pack-protocol
 *            https://git-scm.com/docs/git-receive-pack
 */
import type { ObjectType } from '../types/objects';
/** Zero SHA - used for ref creation and deletion */
export declare const ZERO_SHA: string;
/**
 * A reference (branch, tag, etc.) with its SHA and optional peeled value
 */
export interface Ref {
    name: string;
    sha: string;
    peeled?: string;
}
/**
 * Capabilities supported by receive-pack
 */
export interface ReceivePackCapabilities {
    /** Client wants status report */
    reportStatus?: boolean;
    /** Client wants v2 status report */
    reportStatusV2?: boolean;
    /** Allow ref deletion */
    deleteRefs?: boolean;
    /** Suppress progress messages */
    quiet?: boolean;
    /** Atomic push (all or nothing) */
    atomic?: boolean;
    /** Support push options */
    pushOptions?: boolean;
    /** Side-band multiplexing */
    sideBand64k?: boolean;
    /** Push certificate nonce */
    pushCert?: string;
    /** Agent string */
    agent?: string;
}
/**
 * Ref update command from client
 */
export interface RefUpdateCommand {
    oldSha: string;
    newSha: string;
    refName: string;
    type: 'create' | 'update' | 'delete';
    capabilities?: string[];
}
/**
 * Result of a ref update operation
 */
export interface RefUpdateResult {
    refName: string;
    success: boolean;
    error?: string;
    oldTarget?: string;
    newTarget?: string;
    forced?: boolean;
}
/**
 * Packfile validation result
 */
export interface PackfileValidation {
    valid: boolean;
    objectCount?: number;
    error?: string;
}
/**
 * Hook execution point
 */
export type HookExecutionPoint = 'pre-receive' | 'update' | 'post-receive' | 'post-update';
/**
 * Hook execution result
 */
export interface HookResult {
    success: boolean;
    message?: string;
    pushSuccess?: boolean;
    hookSuccess?: boolean;
    results?: RefUpdateResult[];
}
/**
 * Session state for receive-pack operation
 */
export interface ReceivePackSession {
    repoId: string;
    capabilities: ReceivePackCapabilities;
    commands: RefUpdateCommand[];
}
/**
 * Object store interface
 */
export interface ObjectStore {
    getObject(sha: string): Promise<{
        type: ObjectType;
        data: Uint8Array;
    } | null>;
    hasObject(sha: string): Promise<boolean>;
    getCommitParents(sha: string): Promise<string[]>;
    getRefs(): Promise<Ref[]>;
    getRef(name: string): Promise<Ref | null>;
    setRef(name: string, sha: string): Promise<void>;
    deleteRef(name: string): Promise<void>;
    storeObject(sha: string, type: string, data: Uint8Array): Promise<void>;
    isAncestor(ancestor: string, descendant: string): Promise<boolean>;
}
/**
 * Parsed receive-pack request
 */
export interface ReceivePackRequest {
    commands: RefUpdateCommand[];
    capabilities: string[];
    packfile: Uint8Array;
    pushOptions: string[];
}
/**
 * Report status input
 */
export interface ReportStatusInput {
    unpackStatus: string;
    refResults: RefUpdateResult[];
    options?: Record<string, string>;
}
/**
 * Unpack result
 */
export interface UnpackResult {
    success: boolean;
    objectsUnpacked: number;
    unpackedShas: string[];
    error?: string;
}
/**
 * Process commands result
 */
export interface ProcessCommandsResult {
    results: RefUpdateResult[];
}
/**
 * Atomic ref update result
 */
export interface AtomicRefUpdateResult {
    success: boolean;
    results: RefUpdateResult[];
}
/**
 * Permission check result
 */
export interface PermissionCheckResult {
    allowed: boolean;
    reason?: string;
}
/**
 * Permission check options
 */
export interface PermissionCheckOptions {
    protectedRefs?: string[];
    allowedRefPatterns?: string[];
}
/**
 * Process commands options
 */
export interface ProcessCommandsOptions {
    forcePush?: boolean;
}
/**
 * Packfile validation options
 */
export interface PackfileValidationOptions {
    verifyChecksum?: boolean;
    allowEmpty?: boolean;
}
/**
 * Unpack options
 */
export interface UnpackOptions {
    resolveDelta?: boolean;
    onProgress?: (message: string) => void;
}
/**
 * Hook options
 */
export interface HookOptions {
    timeout?: number;
    pushOptions?: string[];
}
/**
 * Build capability string for receive-pack
 */
export declare function buildReceiveCapabilityString(capabilities: ReceivePackCapabilities): string;
/**
 * Parse capabilities from string
 */
export declare function parseReceiveCapabilities(capsString: string): ReceivePackCapabilities;
/**
 * Create a new receive-pack session
 */
export declare function createReceiveSession(repoId: string): ReceivePackSession;
/**
 * Advertise refs to client
 */
export declare function advertiseReceiveRefs(store: ObjectStore, capabilities?: ReceivePackCapabilities): Promise<string>;
/**
 * Parse a single command line
 */
export declare function parseCommandLine(line: string): RefUpdateCommand;
/**
 * Parse complete receive-pack request
 */
export declare function parseReceivePackRequest(data: Uint8Array): ReceivePackRequest;
/**
 * Validate packfile structure
 */
export declare function validatePackfile(packfile: Uint8Array, options?: PackfileValidationOptions): Promise<PackfileValidation>;
/**
 * Unpack objects from packfile
 */
export declare function unpackObjects(packfile: Uint8Array, _store: ObjectStore, options?: UnpackOptions): Promise<UnpackResult>;
/**
 * Validate ref name according to git rules
 */
export declare function validateRefName(refName: string): boolean;
/**
 * Validate fast-forward update
 */
export declare function validateFastForward(oldSha: string, newSha: string, store: ObjectStore): Promise<boolean>;
/**
 * Check ref permissions
 */
export declare function checkRefPermissions(refName: string, operation: 'create' | 'update' | 'delete' | 'force-update', options: PermissionCheckOptions): Promise<PermissionCheckResult>;
/**
 * Process ref update commands
 */
export declare function processCommands(session: ReceivePackSession, commands: RefUpdateCommand[], store: ObjectStore, options?: ProcessCommandsOptions): Promise<ProcessCommandsResult>;
/**
 * Update refs in the store
 */
export declare function updateRefs(commands: RefUpdateCommand[], store: ObjectStore): Promise<void>;
/**
 * Atomic ref update - all or nothing
 */
export declare function atomicRefUpdate(commands: RefUpdateCommand[], store: ObjectStore): Promise<AtomicRefUpdateResult>;
type PreReceiveHookFn = (commands: RefUpdateCommand[], env: Record<string, string>) => Promise<HookResult>;
type UpdateHookFn = (refName: string, oldSha: string, newSha: string, env: Record<string, string>) => Promise<HookResult>;
type PostReceiveHookFn = (commands: RefUpdateCommand[], results: RefUpdateResult[], env: Record<string, string>) => Promise<HookResult>;
type PostUpdateHookFn = (refNames: string[]) => Promise<HookResult>;
/**
 * Execute pre-receive hook
 */
export declare function executePreReceiveHook(commands: RefUpdateCommand[], _store: ObjectStore, hookFn: PreReceiveHookFn, env?: Record<string, string>, options?: HookOptions): Promise<HookResult>;
/**
 * Execute update hook for each ref
 */
export declare function executeUpdateHook(commands: RefUpdateCommand[], _store: ObjectStore, hookFn: UpdateHookFn, env?: Record<string, string>): Promise<{
    results: RefUpdateResult[];
}>;
/**
 * Execute post-receive hook
 */
export declare function executePostReceiveHook(commands: RefUpdateCommand[], results: RefUpdateResult[], _store: ObjectStore, hookFn: PostReceiveHookFn, options?: HookOptions): Promise<{
    pushSuccess: boolean;
    hookSuccess: boolean;
}>;
/**
 * Execute post-update hook
 */
export declare function executePostUpdateHook(_commands: RefUpdateCommand[], results: RefUpdateResult[], hookFn: PostUpdateHookFn): Promise<void>;
/**
 * Format report-status response
 */
export declare function formatReportStatus(input: ReportStatusInput): string;
/**
 * Format report-status-v2 response
 */
export declare function formatReportStatusV2(input: ReportStatusInput): string;
/**
 * Format rejection message
 */
export declare function rejectPush(refName: string, reason: string, options: {
    reportStatus?: boolean;
    sideBand?: boolean;
}): string | Uint8Array;
/**
 * Handle complete receive-pack request
 */
export declare function handleReceivePack(session: ReceivePackSession, request: Uint8Array, store: ObjectStore): Promise<Uint8Array>;
export {};
//# sourceMappingURL=receive-pack.d.ts.map