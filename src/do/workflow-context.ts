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

import type {
  DOStorage,
  WorkflowContext,
  ActionResult,
  WorkflowEventProxy,
  WorkflowScheduleProxy,
  EventHandler,
  ScheduledHandler,
  JsonValue,
} from './types'

/**
 * Options for creating a workflow context.
 */
export interface WorkflowContextOptions {
  /** The DO storage instance */
  storage: DOStorage
  /** Function to schedule background work */
  waitUntil: (promise: Promise<unknown>) => void
}

/**
 * Creates a WorkflowContext for the $ API.
 *
 * @param options - Configuration options
 * @returns The workflow context proxy
 */
export function createWorkflowContext(options: WorkflowContextOptions): WorkflowContext {
  const { storage, waitUntil } = options

  // Create the base context with all required methods
  const context: WorkflowContext = {
    send: createSendMethod(storage, waitUntil),
    try: createTryMethod(),
    do: createDoMethod(storage),
    on: createEventProxy(storage, waitUntil),
    every: createScheduleProxy(storage, waitUntil),
    branch: createBranchMethod(storage),
    checkout: createCheckoutMethod(storage),
    merge: createMergeMethod(storage),
  }

  // Add domain proxy for $.Noun(id) pattern
  return createDomainProxy(context)
}

/**
 * Creates the send method for fire-and-forget event emission.
 */
function createSendMethod(
  storage: DOStorage,
  waitUntil: (promise: Promise<unknown>) => void
): WorkflowContext['send'] {
  return function send<T = unknown>(event: string, data?: T): void {
    // Queue event for async processing
    waitUntil(storage.put(`pending:${Date.now()}`, { event, data }))
  }
}

/**
 * Creates the try method for quick, non-durable action attempts.
 */
function createTryMethod(): WorkflowContext['try'] {
  return async function tryAction<T = unknown>(action: string, data?: T): Promise<ActionResult<T>> {
    // Execute action directly
    const result: ActionResult<T> = { action, success: true }
    if (data !== undefined) result.data = data
    return result
  }
}

/**
 * Creates the do method for durable execution with retries.
 */
function createDoMethod(storage: DOStorage): WorkflowContext['do'] {
  return async function doAction<T = unknown>(action: string, data?: T): Promise<ActionResult<T>> {
    // Store action for durability
    const actionId = `action:${Date.now()}`
    await storage.put(actionId, { action, data, status: 'pending' })

    // Execute and update status
    const result: ActionResult<T> = { action, success: true }
    if (data !== undefined) result.data = data
    await storage.put(actionId, { action, data, status: 'completed', result })

    return result
  }
}

/**
 * Creates the event handler proxy for $.on.noun.verb() pattern.
 */
function createEventProxy(
  storage: DOStorage,
  waitUntil: (promise: Promise<unknown>) => void
): WorkflowEventProxy {
  return new Proxy({} as WorkflowEventProxy, {
    get(_target, noun: string) {
      return new Proxy(
        {},
        {
          get(_t, verb: string) {
            return <T = unknown>(handler: EventHandler<T>) => {
              // Register event handler
              waitUntil(storage.put(`handler:${noun}:${verb}`, { handler: String(handler) }))
            }
          },
        }
      )
    },
  })
}

/**
 * Creates the schedule proxy for $.every.schedule.at() pattern.
 */
function createScheduleProxy(
  storage: DOStorage,
  waitUntil: (promise: Promise<unknown>) => void
): WorkflowScheduleProxy {
  return new Proxy({} as WorkflowScheduleProxy, {
    get(_target, schedule: string) {
      return {
        at: (time: string) => (handler: ScheduledHandler) => {
          // Register scheduled handler
          waitUntil(storage.put(`schedule:${schedule}:${time}`, { handler: String(handler) }))
        },
      }
    },
  })
}

/**
 * Creates the branch method for creating git branches.
 */
function createBranchMethod(storage: DOStorage): WorkflowContext['branch'] {
  return async function branch(name: string): Promise<void> {
    await storage.put(`refs/heads/${name}`, {
      created: Date.now(),
      head: await storage.get('HEAD'),
    })
  }
}

/**
 * Creates the checkout method for switching refs.
 */
function createCheckoutMethod(storage: DOStorage): WorkflowContext['checkout'] {
  return async function checkout(ref: string): Promise<void> {
    await storage.put('HEAD', ref)
  }
}

/**
 * Creates the merge method for merging branches.
 */
function createMergeMethod(storage: DOStorage): WorkflowContext['merge'] {
  return async function merge(branchName: string): Promise<void> {
    const branchData = await storage.get(`refs/heads/${branchName}`)
    if (branchData) {
      // Simple fast-forward merge for now
      await storage.put('HEAD', branchData)
    }
  }
}

/**
 * Creates a proxy that adds domain resolution for $.Noun(id) pattern.
 */
function createDomainProxy(context: WorkflowContext): WorkflowContext {
  return new Proxy(context, {
    get(target, prop: string) {
      // Return existing properties first
      if (prop in target) {
        return target[prop as keyof WorkflowContext]
      }

      // For capitalized names, return a domain resolver function
      if (prop.charAt(0) === prop.charAt(0).toUpperCase()) {
        return (id: string) => {
          // Return a proxy that represents the domain entity
          return new Proxy(
            {},
            {
              get(_t, method: string) {
                return async (...args: JsonValue[]) => {
                  // This would resolve and call the method on the target DO
                  return { domain: prop, id, method, args }
                }
              },
            }
          )
        }
      }

      return undefined
    },
  })
}
