/**
 * Git Tag Object
 *
 * Represents a Git annotated tag object with full support for:
 * - GPG signatures
 * - Extra headers (encoding, etc.)
 * - Validation
 *
 * Format:
 * object <sha>
 * type <object-type>
 * tag <name>
 * tagger <name> <email> <timestamp> <timezone> (optional)
 * gpgsig -----BEGIN PGP SIGNATURE----- (optional, multi-line)
 * encoding <encoding> (optional)
 *
 * <message>
 *
 * @module core/objects/tag
 */
import { type GitIdentity, type ObjectType, type TagData } from './types';
/**
 * Extra headers that can appear in a tag object.
 * These are Git-compatible but less commonly used headers.
 */
export interface TagExtraHeaders {
    /**
     * Text encoding for the tag message (e.g., 'UTF-8', 'ISO-8859-1')
     * Used when the message contains non-UTF-8 characters
     */
    encoding?: string;
    /**
     * Any other unknown headers preserved for round-trip compatibility
     * Maps header name to value(s)
     */
    [key: string]: string | string[] | undefined;
}
/**
 * Extended TagData interface with extra headers support
 */
export interface ExtendedTagData extends TagData {
    /**
     * GPG signature for the tag (separate from message)
     */
    gpgSignature?: string;
    /**
     * Extra headers beyond the standard object/type/tag/tagger
     */
    extraHeaders?: TagExtraHeaders;
}
/**
 * Result of tag validation
 */
export interface TagValidationResult {
    /** Whether the tag data is valid */
    isValid: boolean;
    /** Error message if validation failed */
    error?: string;
    /** Warning messages for non-critical issues */
    warnings?: string[];
}
/**
 * Validates tag data before creation.
 * Returns validation result with error/warning messages.
 *
 * @param data - Tag data to validate
 * @returns Validation result object
 *
 * @example
 * ```typescript
 * const result = validateTagData({
 *   object: 'abc123...',
 *   objectType: 'commit',
 *   name: 'v1.0.0',
 *   tagger: { ... },
 *   message: 'Release v1.0.0'
 * })
 * if (!result.isValid) {
 *   throw new Error(result.error)
 * }
 * ```
 */
export declare function validateTagData(data: TagData | ExtendedTagData): TagValidationResult;
/**
 * Git annotated tag object with support for GPG signatures and extra headers.
 *
 * Provides methods for serialization, deserialization, and inspection
 * of Git tag objects.
 *
 * @example
 * ```typescript
 * // Create a new tag
 * const tag = new GitTag({
 *   object: commitSha,
 *   objectType: 'commit',
 *   name: 'v1.0.0',
 *   tagger: { name: 'Alice', email: 'alice@example.com.ai', timestamp: 1704067200, timezone: '+0000' },
 *   message: 'Release v1.0.0'
 * })
 *
 * // Get the SHA
 * const sha = await tag.hash()
 *
 * // Parse from serialized data
 * const parsed = GitTag.parse(serializedData)
 * ```
 */
export declare class GitTag {
    readonly type: "tag";
    readonly object: string;
    readonly objectType: ObjectType;
    readonly name: string;
    readonly tagger?: GitIdentity;
    readonly message: string;
    readonly gpgSignature?: string;
    readonly extraHeaders?: TagExtraHeaders;
    /**
     * Creates a new GitTag
     * @param data - Tag data including object, objectType, name, tagger, message
     * @throws Error if validation fails
     */
    constructor(data: TagData | ExtendedTagData);
    /**
     * Creates a GitTag from raw tag content (without header)
     */
    static fromContent(content: string): GitTag;
    /**
     * Parses a GitTag from serialized Git object format
     * @param data - The serialized data including header
     * @throws Error if the header is invalid or type is not tag
     */
    static parse(data: Uint8Array): GitTag;
    /**
     * Checks if this tag has a GPG signature.
     * Signatures can be in the gpgsig header or embedded in the message.
     */
    hasSignature(): boolean;
    /**
     * Gets the GPG signature if present
     */
    getSignature(): string | undefined;
    /**
     * Gets extra headers (encoding, etc.) if present
     */
    getExtraHeaders(): TagExtraHeaders | undefined;
    /**
     * Gets the subject line (first line) of the tag message
     */
    getSubject(): string;
    /**
     * Gets the body of the tag message (after subject and blank line)
     */
    getBody(): string;
    /**
     * Serializes the tag to Git object format
     */
    serialize(): Uint8Array;
    /**
     * Serializes just the tag content (without header)
     */
    private serializeContent;
    /**
     * Calculates the SHA-1 hash of this tag object
     * @returns Promise resolving to 40-character hex string
     */
    hash(): Promise<string>;
}
//# sourceMappingURL=tag.d.ts.map