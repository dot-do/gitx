/**
 * Git wire protocol capability negotiation
 *
 * Capabilities are used during the initial handshake between git client and server
 * to determine what features are supported by both sides.
 *
 * Protocol v1: Capabilities are sent as a space-separated list after the first ref
 * Protocol v2: Capabilities are advertised line by line in the initial handshake
 *
 * Reference: https://git-scm.com/docs/protocol-capabilities
 * Reference: https://git-scm.com/docs/protocol-v2
 */
/** Git wire protocol version */
export type ProtocolVersion = 1 | 2;
/** Standard protocol v1 capabilities */
export type CapabilityV1 = 'multi_ack' | 'multi_ack_detailed' | 'thin-pack' | 'side-band' | 'side-band-64k' | 'ofs-delta' | 'shallow' | 'deepen-since' | 'deepen-not' | 'deepen-relative' | 'no-progress' | 'include-tag' | 'report-status' | 'report-status-v2' | 'delete-refs' | 'quiet' | 'atomic' | 'push-options' | 'allow-tip-sha1-in-want' | 'allow-reachable-sha1-in-want' | 'push-cert' | 'filter' | 'agent' | 'symref' | 'object-format';
/** Protocol v2 capabilities/commands */
export type CapabilityV2 = 'agent' | 'ls-refs' | 'fetch' | 'server-option' | 'object-format' | 'session-id' | 'wait-for-done' | 'object-info' | 'bundle-uri';
/** Capability with optional value (e.g., agent=git/2.30.0) */
export interface CapabilityEntry {
    name: string;
    value?: string;
}
/** Parsed capability set */
export interface CapabilitySet {
    /** Protocol version being used */
    version: ProtocolVersion;
    /** Map of capability name to optional value */
    capabilities: Map<string, string | undefined>;
}
/** Ref advertisement with capabilities (protocol v1) */
export interface RefAdvertisement {
    /** The SHA-1 of the ref */
    oid: string;
    /** The ref name (e.g., refs/heads/main) */
    name: string;
    /** Capabilities (only on first ref line) */
    capabilities?: CapabilitySet;
}
/** Protocol v2 server capabilities response */
export interface ServerCapabilitiesV2 {
    version: 2;
    /** List of supported commands */
    commands: string[];
    /** Agent string */
    agent?: string;
    /** Object format (sha1 or sha256) */
    objectFormat?: 'sha1' | 'sha256';
    /** Other capabilities */
    capabilities: Map<string, string | undefined>;
}
/** Want line with capabilities for fetch request */
export interface WantRequest {
    /** SHA-1s of objects we want */
    wants: string[];
    /** Capabilities to send */
    capabilities: CapabilityEntry[];
}
/** Have line for negotiation */
export interface HaveRequest {
    /** SHA-1s of objects we have */
    haves: string[];
    /** Whether this is the final batch */
    done?: boolean;
}
/** Version negotiation result */
export interface VersionNegotiationResult {
    /** Agreed upon version */
    version: ProtocolVersion;
    /** Whether the server supports v2 */
    serverSupportsV2: boolean;
    /** Common capabilities */
    commonCapabilities: string[];
}
/** Default client capabilities for fetch (protocol v1) */
export declare const DEFAULT_FETCH_CAPABILITIES_V1: CapabilityV1[];
/** Default client capabilities for push (protocol v1) */
export declare const DEFAULT_PUSH_CAPABILITIES_V1: CapabilityV1[];
/** Minimum required capabilities for basic fetch */
export declare const REQUIRED_FETCH_CAPABILITIES: CapabilityV1[];
/**
 * Parse a capability string from ref advertisement (protocol v1).
 *
 * Format: "<oid> <refname>\0<cap1> <cap2> cap3=value..."
 *
 * @param line - The ref advertisement line with capabilities
 * @returns Parsed capabilities
 */
export declare function parseCapabilityString(line: string): CapabilitySet;
/**
 * Parse individual capability entries from a space-separated string.
 *
 * @param capString - Space-separated capability string
 * @returns Array of capability entries
 */
export declare function parseCapabilities(capString: string): CapabilityEntry[];
/**
 * Parse a ref advertisement line (protocol v1).
 *
 * First line format: "<oid> <refname>\0<capabilities>"
 * Subsequent lines: "<oid> <refname>"
 *
 * @param line - The pkt-line data (without length prefix)
 * @param isFirst - Whether this is the first line (contains capabilities)
 * @returns Parsed ref advertisement
 */
export declare function parseRefAdvertisement(line: string, isFirst: boolean): RefAdvertisement;
/**
 * Parse protocol v2 capability advertisement.
 *
 * Format:
 *   version 2
 *   agent=git/2.30.0
 *   ls-refs
 *   fetch=...
 *   server-option
 *   object-format=sha1
 *
 * @param lines - Array of pkt-line data
 * @returns Parsed server capabilities
 */
export declare function parseServerCapabilitiesV2(lines: string[]): ServerCapabilitiesV2;
/**
 * Build a capability string for want/have request (protocol v1).
 *
 * @param capabilities - Capabilities to include
 * @returns Space-separated capability string
 */
export declare function buildCapabilityString(capabilities: CapabilityEntry[]): string;
/**
 * Build a want line with capabilities (first want only).
 *
 * Format: "want <oid> <capabilities>\n"
 *
 * @param oid - The object ID to want
 * @param capabilities - Capabilities to include
 * @returns Formatted want line
 */
export declare function buildWantLine(oid: string, capabilities?: CapabilityEntry[]): string;
/**
 * Build a have line for negotiation.
 *
 * Format: "have <oid>\n"
 *
 * @param oid - The object ID we have
 * @returns Formatted have line
 */
export declare function buildHaveLine(oid: string): string;
/**
 * Build a complete want/have request.
 *
 * @param request - The want request with capabilities
 * @returns Array of pkt-line format strings
 */
export declare function buildFetchRequest(request: WantRequest): string[];
/**
 * Build protocol v2 command request.
 *
 * Format:
 *   command=<cmd>
 *   capability1
 *   capability2=value
 *   0001 (delimiter)
 *   <command-specific args>
 *   0000 (flush)
 *
 * @param command - The v2 command (e.g., 'fetch', 'ls-refs')
 * @param capabilities - Client capabilities
 * @param args - Command-specific arguments
 * @returns Array of pkt-line format strings
 */
export declare function buildV2CommandRequest(command: string, capabilities: CapabilityEntry[], args?: string[]): string[];
/**
 * Negotiate protocol version with server.
 *
 * @param serverAdvertisement - First line from server
 * @param preferredVersion - Client's preferred version
 * @returns Negotiation result
 */
export declare function negotiateVersion(serverAdvertisement: string, preferredVersion?: ProtocolVersion): VersionNegotiationResult;
/**
 * Find common capabilities between client and server.
 *
 * @param clientCaps - Client capabilities
 * @param serverCaps - Server capabilities
 * @returns Array of common capability names
 */
export declare function findCommonCapabilities(clientCaps: CapabilityEntry[], serverCaps: CapabilitySet): string[];
/**
 * Check if a specific capability is supported.
 *
 * @param capSet - The capability set to check
 * @param name - The capability name
 * @returns True if capability is supported
 */
export declare function hasCapability(capSet: CapabilitySet, name: string): boolean;
/**
 * Get the value of a capability (if it has one).
 *
 * @param capSet - The capability set
 * @param name - The capability name
 * @returns The capability value or undefined
 */
export declare function getCapabilityValue(capSet: CapabilitySet, name: string): string | undefined;
/**
 * Create a capability set from entries.
 *
 * @param version - Protocol version
 * @param entries - Capability entries
 * @returns CapabilitySet
 */
export declare function createCapabilitySet(version: ProtocolVersion, entries: CapabilityEntry[]): CapabilitySet;
/**
 * Select optimal capabilities for a fetch operation.
 *
 * @param serverCaps - Server advertised capabilities
 * @param clientPrefs - Client preferred capabilities (in priority order)
 * @returns Selected capabilities to use
 */
export declare function selectFetchCapabilities(serverCaps: CapabilitySet, clientPrefs: CapabilityEntry[]): CapabilityEntry[];
/**
 * Validate that a capability name is well-formed.
 *
 * @param name - The capability name to validate
 * @returns True if valid
 */
export declare function isValidCapabilityName(name: string): boolean;
/**
 * Validate that required capabilities are present.
 *
 * @param capSet - The capability set to check
 * @param required - Required capability names
 * @returns Array of missing capability names
 */
export declare function validateRequiredCapabilities(capSet: CapabilitySet, required: string[]): string[];
//# sourceMappingURL=capabilities.d.ts.map