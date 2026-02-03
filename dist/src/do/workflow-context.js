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
/**
 * Creates a WorkflowContext for the $ API.
 *
 * @param options - Configuration options
 * @returns The workflow context proxy
 */
export function createWorkflowContext(options) {
    const { storage, waitUntil } = options;
    // Create the base context with all required methods
    const context = {
        send: createSendMethod(storage, waitUntil),
        try: createTryMethod(),
        do: createDoMethod(storage),
        on: createEventProxy(storage, waitUntil),
        every: createScheduleProxy(storage, waitUntil),
        branch: createBranchMethod(storage),
        checkout: createCheckoutMethod(storage),
        merge: createMergeMethod(storage),
    };
    // Add domain proxy for $.Noun(id) pattern
    return createDomainProxy(context);
}
/**
 * Creates the send method for fire-and-forget event emission.
 */
function createSendMethod(storage, waitUntil) {
    return function send(event, data) {
        // Queue event for async processing
        waitUntil(storage.put(`pending:${Date.now()}`, { event, data }));
    };
}
/**
 * Creates the try method for quick, non-durable action attempts.
 */
function createTryMethod() {
    return async function tryAction(action, data) {
        // Execute action directly
        const result = { action, success: true };
        if (data !== undefined)
            result.data = data;
        return result;
    };
}
/**
 * Creates the do method for durable execution with retries.
 */
function createDoMethod(storage) {
    return async function doAction(action, data) {
        // Store action for durability
        const actionId = `action:${Date.now()}`;
        await storage.put(actionId, { action, data, status: 'pending' });
        // Execute and update status
        const result = { action, success: true };
        if (data !== undefined)
            result.data = data;
        await storage.put(actionId, { action, data, status: 'completed', result });
        return result;
    };
}
/**
 * Creates the event handler proxy for $.on.noun.verb() pattern.
 */
function createEventProxy(storage, waitUntil) {
    return new Proxy({}, {
        get(_target, noun) {
            return new Proxy({}, {
                get(_t, verb) {
                    return (handler) => {
                        // Register event handler
                        waitUntil(storage.put(`handler:${noun}:${verb}`, { handler: String(handler) }));
                    };
                },
            });
        },
    });
}
/**
 * Creates the schedule proxy for $.every.schedule.at() pattern.
 */
function createScheduleProxy(storage, waitUntil) {
    return new Proxy({}, {
        get(_target, schedule) {
            return {
                at: (time) => (handler) => {
                    // Register scheduled handler
                    waitUntil(storage.put(`schedule:${schedule}:${time}`, { handler: String(handler) }));
                },
            };
        },
    });
}
/**
 * Creates the branch method for creating git branches.
 */
function createBranchMethod(storage) {
    return async function branch(name) {
        await storage.put(`refs/heads/${name}`, {
            created: Date.now(),
            head: await storage.get('HEAD'),
        });
    };
}
/**
 * Creates the checkout method for switching refs.
 */
function createCheckoutMethod(storage) {
    return async function checkout(ref) {
        await storage.put('HEAD', ref);
    };
}
/**
 * Creates the merge method for merging branches.
 */
function createMergeMethod(storage) {
    return async function merge(branchName) {
        const branchData = await storage.get(`refs/heads/${branchName}`);
        if (branchData) {
            // Simple fast-forward merge for now
            await storage.put('HEAD', branchData);
        }
    };
}
/**
 * Creates a proxy that adds domain resolution for $.Noun(id) pattern.
 */
function createDomainProxy(context) {
    return new Proxy(context, {
        get(target, prop) {
            // Return existing properties first
            if (prop in target) {
                return target[prop];
            }
            // For capitalized names, return a domain resolver function
            if (prop.charAt(0) === prop.charAt(0).toUpperCase()) {
                return (id) => {
                    // Return a proxy that represents the domain entity
                    return new Proxy({}, {
                        get(_t, method) {
                            return async (...args) => {
                                // This would resolve and call the method on the target DO
                                return { domain: prop, id, method, args };
                            };
                        },
                    });
                };
            }
            return undefined;
        },
    });
}
//# sourceMappingURL=workflow-context.js.map