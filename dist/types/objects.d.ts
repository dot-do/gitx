export type ObjectType = 'blob' | 'tree' | 'commit' | 'tag';
export interface GitObject {
    type: ObjectType;
    data: Uint8Array;
}
export interface BlobObject extends GitObject {
    type: 'blob';
}
export interface TreeEntry {
    mode: string;
    name: string;
    sha: string;
}
export interface TreeObject extends GitObject {
    type: 'tree';
    entries: TreeEntry[];
}
export interface Author {
    name: string;
    email: string;
    timestamp: number;
    timezone: string;
}
export interface CommitObject extends GitObject {
    type: 'commit';
    tree: string;
    parents: string[];
    author: Author;
    committer: Author;
    message: string;
}
export interface TagObject extends GitObject {
    type: 'tag';
    object: string;
    objectType: ObjectType;
    tagger?: Author;
    message: string;
    name: string;
    tag?: string;
}
export declare function isBlob(obj: GitObject): obj is BlobObject;
export declare function isTree(obj: GitObject): obj is TreeObject;
export declare function isCommit(obj: GitObject): obj is CommitObject;
export declare function isTag(obj: GitObject): obj is TagObject;
export declare function serializeBlob(data: Uint8Array): Uint8Array;
export declare function serializeTree(entries: TreeEntry[]): Uint8Array;
export declare function serializeCommit(commit: Omit<CommitObject, 'type' | 'data'>): Uint8Array;
export declare function serializeTag(tag: Omit<TagObject, 'type' | 'data'>): Uint8Array;
export declare function parseBlob(data: Uint8Array): BlobObject;
export declare function parseTree(data: Uint8Array): TreeObject;
export declare function parseCommit(data: Uint8Array): CommitObject;
export declare function parseTag(data: Uint8Array): TagObject;
//# sourceMappingURL=objects.d.ts.map