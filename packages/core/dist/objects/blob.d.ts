/**
 * Git Blob Object
 *
 * Represents a Git blob object which stores file content.
 * Format: "blob <size>\0<content>"
 */
/**
 * Git blob object - stores raw file content
 */
export declare class GitBlob {
    readonly type: "blob";
    readonly content: Uint8Array;
    /**
     * Creates a new GitBlob from raw content
     * @param content - The raw file content as bytes
     */
    constructor(content: Uint8Array);
    /**
     * Creates a GitBlob from a string
     * @param str - The string content
     */
    static fromString(str: string): GitBlob;
    /**
     * Parses a GitBlob from serialized Git object format
     * @param data - The serialized data including header
     * @throws Error if the header is invalid or type is not blob
     */
    static parse(data: Uint8Array): GitBlob;
    /**
     * Returns the size of the content in bytes
     */
    get size(): number;
    /**
     * Checks if the blob is empty
     */
    isEmpty(): boolean;
    /**
     * Checks if the content appears to be binary (contains null bytes)
     */
    isBinary(): boolean;
    /**
     * Converts the content to a string (UTF-8)
     */
    toString(): string;
    /**
     * Serializes the blob to Git object format
     * Format: "blob <size>\0<content>"
     */
    serialize(): Uint8Array;
    /**
     * Calculates the SHA-1 hash of this blob object
     * @returns Promise resolving to 40-character hex string
     */
    hash(): Promise<string>;
}
//# sourceMappingURL=blob.d.ts.map