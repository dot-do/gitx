/**
 * @fileoverview Miniflare-based Code Evaluator
 *
 * Provides local V8 isolate evaluation using Miniflare for development.
 */
import { ObjectStoreProxy } from './object-store-proxy';
export interface MiniflareEvaluatorConfig {
    timeout?: number;
    memoryLimit?: number;
    cpuLimit?: number;
    objectStore?: ObjectStoreProxy;
}
export interface EvaluatorResult {
    success: boolean;
    value?: unknown;
    error?: string;
    logs: string[];
    duration: number;
}
export declare function evaluateWithMiniflare(code: string, config?: MiniflareEvaluatorConfig): Promise<EvaluatorResult>;
//# sourceMappingURL=miniflare-evaluator.d.ts.map