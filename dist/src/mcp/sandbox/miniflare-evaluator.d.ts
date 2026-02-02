/**
 * @fileoverview Miniflare-based Code Evaluator
 *
 * Provides secure V8 isolate evaluation using Miniflare/workerd sandboxing.
 * Based on patterns from ai-evaluate package.
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
/** Evaluates untrusted code in a Miniflare sandbox with network access blocked. */
export declare function evaluateWithMiniflare(code: string, config?: MiniflareEvaluatorConfig): Promise<EvaluatorResult>;
//# sourceMappingURL=miniflare-evaluator.d.ts.map