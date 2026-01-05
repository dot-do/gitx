/**
 * ObjectStore - Git object storage implementation
 *
 * Handles CRUD operations for git objects (blob, tree, commit, tag)
 * with SHA-1 hash computation and proper git object format.
 */
import { DurableObjectStorage } from './schema';
import { ObjectType, BlobObject, TreeObject, CommitObject, TagObject, TreeEntry, Author } from '../types/objects';
/**
 * Stored object record in SQLite
 */
export interface StoredObject {
    sha: string;
    type: ObjectType;
    size: number;
    data: Uint8Array;
    createdAt: number;
}
/**
 * ObjectStore class for managing git objects in SQLite storage
 */
export declare class ObjectStore {
    private storage;
    constructor(storage: DurableObjectStorage);
    /**
     * Store a raw object and return its SHA
     */
    putObject(type: ObjectType, data: Uint8Array): Promise<string>;
    /**
     * Store a tree object with entries
     */
    putTreeObject(entries: TreeEntry[]): Promise<string>;
    /**
     * Store a commit object
     */
    putCommitObject(commit: {
        tree: string;
        parents: string[];
        author: Author;
        committer: Author;
        message: string;
    }): Promise<string>;
    /**
     * Store a tag object
     */
    putTagObject(tag: {
        object: string;
        objectType: ObjectType;
        tagger: Author;
        message: string;
        name: string;
    }): Promise<string>;
    /**
     * Retrieve an object by SHA
     */
    getObject(sha: string): Promise<StoredObject | null>;
    /**
     * Delete an object by SHA
     */
    deleteObject(sha: string): Promise<boolean>;
    /**
     * Check if an object exists
     */
    hasObject(sha: string): Promise<boolean>;
    /**
     * Verify an object's integrity by recomputing its hash
     */
    verifyObject(sha: string): Promise<boolean>;
    /**
     * Get object type by SHA
     */
    getObjectType(sha: string): Promise<ObjectType | null>;
    /**
     * Get object size by SHA
     */
    getObjectSize(sha: string): Promise<number | null>;
    /**
     * Store multiple objects in a batch
     */
    putObjects(objects: {
        type: ObjectType;
        data: Uint8Array;
    }[]): Promise<string[]>;
    /**
     * Retrieve multiple objects by SHA
     */
    getObjects(shas: string[]): Promise<(StoredObject | null)[]>;
    /**
     * Get a blob object with parsed content
     */
    getBlobObject(sha: string): Promise<BlobObject | null>;
    /**
     * Get a tree object with parsed entries
     */
    getTreeObject(sha: string): Promise<TreeObject | null>;
    /**
     * Get a commit object with parsed fields
     */
    getCommitObject(sha: string): Promise<CommitObject | null>;
    /**
     * Get a tag object with parsed fields
     */
    getTagObject(sha: string): Promise<TagObject | null>;
    /**
     * Get raw serialized object with git header
     */
    getRawObject(sha: string): Promise<Uint8Array | null>;
    /**
     * Log operation to WAL
     */
    private logToWAL;
}
//# sourceMappingURL=object-store.d.ts.map