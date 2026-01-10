import { ObjectStoreProxy } from '../sandbox/object-store-proxy';
export interface DoToolInput {
    code: string;
    timeout?: number;
}
export interface DoToolOutput {
    success: boolean;
    result?: unknown;
    error?: string;
    logs: string[];
    duration: number;
}
export declare function executeDo(input: DoToolInput, objectStore: ObjectStoreProxy): Promise<DoToolOutput>;
export declare const doToolDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            code: {
                type: string;
                description: string;
            };
            timeout: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
//# sourceMappingURL=do.d.ts.map