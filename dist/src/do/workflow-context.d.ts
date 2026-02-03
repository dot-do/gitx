/**
 * @fileoverview Workflow Context Factory
 *
 * Creates the WorkflowContext ($) API for GitRepoDO instances.
 * The workflow context provides:
 * - Event emission (send)
 * - Quick actions (try)
 * - Durable execution (do)
 * - Event handlers (on)
 * - Scheduling (every)
 * - Git operations (branch, checkout, merge)
 *
 * @module do/workflow-context
 */
import type { DOStorage, WorkflowContext } from './types';
/**
 * Options for creating a workflow context.
 */
export interface WorkflowContextOptions {
    /** The DO storage instance */
    storage: DOStorage;
    /** Function to schedule background work */
    waitUntil: (promise: Promise<unknown>) => void;
}
/**
 * Creates a WorkflowContext for the $ API.
 *
 * @param options - Configuration options
 * @returns The workflow context proxy
 */
export declare function createWorkflowContext(options: WorkflowContextOptions): WorkflowContext;
//# sourceMappingURL=workflow-context.d.ts.map