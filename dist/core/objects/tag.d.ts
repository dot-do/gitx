/**
 * Git Tag Object
 *
 * Represents a Git annotated tag object.
 *
 * Format:
 * object <sha>
 * type <object-type>
 * tag <name>
 * tagger <name> <email> <timestamp> <timezone> (optional)
 *
 * <message>
 */
import { type GitIdentity, type ObjectType, type TagData } from './types';
/**
 * Git annotated tag object
 */
export declare class GitTag {
    readonly type: "tag";
    readonly object: string;
    readonly objectType: ObjectType;
    readonly name: string;
    readonly tagger?: GitIdentity;
    readonly message: string;
    /**
     * Creates a new GitTag
     * @throws Error if object SHA or type is invalid
     */
    constructor(data: TagData);
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
     * Checks if this tag has a GPG signature (in the message)
     */
    hasSignature(): boolean;
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