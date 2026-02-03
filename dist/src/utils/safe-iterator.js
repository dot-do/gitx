/**
 * @fileoverview Safe Async Iterator Utilities
 *
 * Provides utilities for safely consuming async generators with proper cleanup.
 * These utilities ensure that resources acquired by generators are released
 * even when iteration is terminated early (via break, return, or throw).
 *
 * ## Problem
 *
 * Async generators can acquire resources (file handles, database cursors,
 * streams, etc.) that must be cleaned up when iteration ends. If a consumer
 * terminates iteration early without calling `.return()`, the generator's
 * `finally` block may not execute, causing resource leaks.
 *
 * ## Solution
 *
 * These utilities wrap async iterators to ensure proper cleanup:
 * - `safeIterate`: Wraps an async iterable for safe consumption
 * - `collectAsync`: Safely collects all items with optional limit
 * - `findAsync`: Safely finds the first matching item
 * - `takeAsync`: Safely takes first N items
 *
 * @module utils/safe-iterator
 *
 * @example
 * ```typescript
 * import { safeIterate, collectAsync } from './utils/safe-iterator'
 *
 * // Safe iteration with automatic cleanup
 * for await (const item of safeIterate(asyncGenerator)) {
 *   if (shouldStop(item)) break  // Cleanup happens automatically
 * }
 *
 * // Collect with limit
 * const items = await collectAsync(asyncGenerator, { limit: 10 })
 * ```
 */
/**
 * Wraps an async iterable to ensure proper cleanup on early termination.
 *
 * @description
 * Creates a wrapper around an async iterable that guarantees the underlying
 * iterator's `.return()` method is called when iteration ends, whether by
 * completion, break, return, throw, or reaching a limit.
 *
 * This is particularly important for async generators that acquire resources
 * in their body, as the `finally` block only executes when the generator
 * is properly closed.
 *
 * @typeParam T - The type of items yielded by the iterator
 * @param iterable - The async iterable to wrap
 * @param options - Optional configuration
 * @returns A new async iterable with guaranteed cleanup
 *
 * @example
 * ```typescript
 * // Without safeIterate - potential leak if we break early
 * for await (const commit of walkCommits(provider, sha)) {
 *   if (found) break  // Generator's finally may not run!
 * }
 *
 * // With safeIterate - guaranteed cleanup
 * for await (const commit of safeIterate(walkCommits(provider, sha))) {
 *   if (found) break  // Generator is properly closed
 * }
 * ```
 */
export async function* safeIterate(iterable, options = {}) {
    const { limit = Infinity, onCleanup } = options;
    const iterator = iterable[Symbol.asyncIterator]();
    let count = 0;
    try {
        while (count < limit) {
            const { done, value } = await iterator.next();
            if (done)
                break;
            yield value;
            count++;
        }
    }
    finally {
        // Ensure the underlying iterator is closed
        // This triggers the generator's finally block
        if (iterator.return) {
            await iterator.return(undefined);
        }
        onCleanup?.();
    }
}
/**
 * Collects items from an async iterable into an array with guaranteed cleanup.
 *
 * @description
 * Safely consumes an async iterable, collecting items into an array.
 * Ensures the iterator is properly closed even if an error occurs
 * or a limit is reached.
 *
 * @typeParam T - The type of items in the iterable
 * @param iterable - The async iterable to collect from
 * @param options - Optional configuration including limit
 * @returns Promise resolving to an array of collected items
 *
 * @example
 * ```typescript
 * // Collect first 10 commits
 * const commits = await collectAsync(walkCommits(provider, sha), { limit: 10 })
 * ```
 */
export async function collectAsync(iterable, options = {}) {
    const { limit = Infinity, onCleanup } = options;
    const results = [];
    const iterator = iterable[Symbol.asyncIterator]();
    try {
        while (results.length < limit) {
            const { done, value } = await iterator.next();
            if (done)
                break;
            results.push(value);
        }
        return results;
    }
    finally {
        if (iterator.return) {
            await iterator.return(undefined);
        }
        onCleanup?.();
    }
}
/**
 * Finds the first item matching a predicate with guaranteed cleanup.
 *
 * @description
 * Searches an async iterable for the first item matching the predicate.
 * Ensures the iterator is properly closed as soon as a match is found
 * or all items have been checked.
 *
 * @typeParam T - The type of items in the iterable
 * @param iterable - The async iterable to search
 * @param predicate - Function that returns true for matching items
 * @param options - Optional configuration
 * @returns Promise resolving to the matching item or undefined
 *
 * @example
 * ```typescript
 * // Find a specific commit
 * const commit = await findAsync(
 *   walkCommits(provider, sha),
 *   c => c.commit.message.includes('fix')
 * )
 * ```
 */
export async function findAsync(iterable, predicate, options = {}) {
    const { onCleanup } = options;
    const iterator = iterable[Symbol.asyncIterator]();
    try {
        while (true) {
            const { done, value } = await iterator.next();
            if (done)
                return undefined;
            if (await predicate(value)) {
                return value;
            }
        }
    }
    finally {
        if (iterator.return) {
            await iterator.return(undefined);
        }
        onCleanup?.();
    }
}
/**
 * Takes the first N items from an async iterable with guaranteed cleanup.
 *
 * @description
 * Returns an array of up to N items from the beginning of an async iterable.
 * The iterator is properly closed after taking the items.
 *
 * @typeParam T - The type of items in the iterable
 * @param iterable - The async iterable to take from
 * @param count - Maximum number of items to take
 * @param options - Optional configuration
 * @returns Promise resolving to an array of items
 *
 * @example
 * ```typescript
 * // Get the 5 most recent commits
 * const recent = await takeAsync(walkCommits(provider, sha), 5)
 * ```
 */
export async function takeAsync(iterable, count, options = {}) {
    return collectAsync(iterable, { ...options, limit: count });
}
/**
 * Processes items from an async iterable with guaranteed cleanup.
 *
 * @description
 * Calls a processor function for each item in the iterable.
 * If the processor returns `false`, iteration stops early.
 * The iterator is always properly closed.
 *
 * @typeParam T - The type of items in the iterable
 * @param iterable - The async iterable to process
 * @param processor - Function called for each item; return false to stop
 * @param options - Optional configuration
 * @returns Promise resolving to the number of items processed
 *
 * @example
 * ```typescript
 * // Process commits until we find what we're looking for
 * const processed = await forEachAsync(
 *   walkCommits(provider, sha),
 *   async (commit) => {
 *     await saveCommit(commit)
 *     return !isTargetCommit(commit)  // Continue if not target
 *   }
 * )
 * ```
 */
export async function forEachAsync(iterable, processor, options = {}) {
    const { limit = Infinity, onCleanup } = options;
    const iterator = iterable[Symbol.asyncIterator]();
    let index = 0;
    try {
        while (index < limit) {
            const { done, value } = await iterator.next();
            if (done)
                break;
            const shouldContinue = await processor(value, index);
            index++;
            if (!shouldContinue)
                break;
        }
        return index;
    }
    finally {
        if (iterator.return) {
            await iterator.return(undefined);
        }
        onCleanup?.();
    }
}
/**
 * Creates a disposable wrapper for an async iterator.
 *
 * @description
 * Wraps an async iterator with explicit dispose capability.
 * Useful when you need manual control over iterator lifecycle.
 *
 * @typeParam T - The type of items yielded by the iterator
 * @param iterable - The async iterable to wrap
 * @returns Object with iterator and dispose method
 *
 * @example
 * ```typescript
 * const { iterator, dispose } = createDisposableIterator(walkCommits(provider, sha))
 * try {
 *   const first = await iterator.next()
 *   // ... process first
 *   const second = await iterator.next()
 *   // ... process second
 * } finally {
 *   await dispose()  // Always clean up
 * }
 * ```
 */
export function createDisposableIterator(iterable) {
    const iterator = iterable[Symbol.asyncIterator]();
    let disposed = false;
    return {
        iterator,
        dispose: async () => {
            if (disposed)
                return;
            disposed = true;
            if (iterator.return) {
                await iterator.return(undefined);
            }
        }
    };
}
/**
 * Wraps an async generator function to automatically add cleanup tracking.
 *
 * @description
 * Higher-order function that wraps an async generator to ensure proper cleanup.
 * The returned generator will log when cleanup occurs (useful for debugging).
 *
 * @typeParam Args - The argument types of the generator function
 * @typeParam T - The type of items yielded by the generator
 * @param generatorFn - The async generator function to wrap
 * @param name - Optional name for debugging
 * @returns Wrapped generator function with cleanup tracking
 *
 * @example
 * ```typescript
 * const safeWalkCommits = withCleanup(walkCommits, 'walkCommits')
 *
 * // Usage is the same, but cleanup is tracked
 * for await (const commit of safeWalkCommits(provider, sha)) {
 *   // ...
 * }
 * ```
 */
export function withCleanup(generatorFn, name) {
    const label = name ?? generatorFn.name ?? 'anonymous';
    return function (...args) {
        const generator = generatorFn(...args);
        async function* wrapper() {
            try {
                yield* generator;
            }
            finally {
                // This runs when the generator is closed (via return() or throw())
                // Useful for debugging resource management
                if (typeof globalThis !== 'undefined' && 'DEBUG_GENERATORS' in globalThis) {
                    console.debug(`[${label}] Generator cleanup completed`);
                }
            }
        }
        return wrapper();
    };
}
//# sourceMappingURL=safe-iterator.js.map