/**
 * @fileoverview Async Mutex for Concurrent Operation Synchronization
 *
 * Provides a simple async mutex implementation for coordinating concurrent
 * access to shared resources in async/await contexts. Works in both
 * Cloudflare Workers and Node.js environments.
 *
 * @module utils/async-mutex
 *
 * @example
 * ```typescript
 * const mutex = new AsyncMutex()
 *
 * // Exclusive access to a resource
 * const release = await mutex.acquire()
 * try {
 *   await performCriticalOperation()
 * } finally {
 *   release()
 * }
 *
 * // Or use the convenience method
 * const result = await mutex.withLock(async () => {
 *   return await performCriticalOperation()
 * })
 * ```
 */
/**
 * Release function returned by acquire().
 * Call this to release the mutex lock.
 */
export type ReleaseFn = () => void;
/**
 * Async mutex for coordinating exclusive access to shared resources.
 *
 * @description
 * Provides mutual exclusion for async operations. Only one operation
 * can hold the lock at a time. Other operations queue up and are
 * processed in FIFO order.
 *
 * This implementation is:
 * - Non-blocking: acquire() returns a promise that resolves when the lock is available
 * - Fair: waiters are processed in order
 * - Reentrant-safe: Does NOT support reentrant locking (will deadlock if called recursively)
 *
 * @example
 * ```typescript
 * class DataStore {
 *   private mutex = new AsyncMutex()
 *   private data: Map<string, string> = new Map()
 *
 *   async update(key: string, value: string): Promise<void> {
 *     await this.mutex.withLock(async () => {
 *       // Critical section - only one update at a time
 *       const existing = this.data.get(key)
 *       await this.validateUpdate(existing, value)
 *       this.data.set(key, value)
 *     })
 *   }
 * }
 * ```
 */
export declare class AsyncMutex {
    /** Whether the mutex is currently held */
    private locked;
    /** Queue of waiters for the lock */
    private waiters;
    /**
     * Acquire the mutex lock.
     *
     * @description
     * Returns a promise that resolves to a release function when the lock
     * is acquired. The caller MUST call the release function when done
     * to allow other waiters to proceed.
     *
     * **Important**: Always use try/finally to ensure the lock is released:
     * ```typescript
     * const release = await mutex.acquire()
     * try {
     *   // Critical section
     * } finally {
     *   release()
     * }
     * ```
     *
     * @returns Promise resolving to a release function
     *
     * @example
     * ```typescript
     * const release = await mutex.acquire()
     * try {
     *   await criticalOperation()
     * } finally {
     *   release()
     * }
     * ```
     */
    acquire(): Promise<ReleaseFn>;
    /**
     * Create a release function that unlocks the mutex.
     * @private
     */
    private createReleaseFn;
    /**
     * Execute a function while holding the mutex lock.
     *
     * @description
     * Convenience method that acquires the lock, executes the function,
     * and releases the lock. Handles exceptions properly.
     *
     * @param fn - Async function to execute while holding the lock
     * @returns Promise resolving to the function's return value
     *
     * @example
     * ```typescript
     * const result = await mutex.withLock(async () => {
     *   return await performCriticalOperation()
     * })
     * ```
     */
    withLock<T>(fn: () => Promise<T>): Promise<T>;
    /**
     * Check if the mutex is currently locked.
     *
     * @description
     * Returns whether the mutex is currently held by someone.
     * Note: This is for informational purposes only. The lock state
     * can change immediately after this check returns.
     *
     * @returns True if the mutex is locked, false otherwise
     */
    isLocked(): boolean;
    /**
     * Get the number of waiters in the queue.
     *
     * @description
     * Returns the number of operations waiting to acquire the lock.
     * Useful for monitoring and debugging.
     *
     * @returns Number of waiters
     */
    getWaiterCount(): number;
}
/**
 * Read-Write Lock for concurrent read access with exclusive write access.
 *
 * @description
 * Allows multiple concurrent readers OR a single exclusive writer.
 * Writers have priority: new readers will wait if a writer is waiting.
 *
 * Use this when:
 * - Reads are more common than writes
 * - Multiple concurrent reads are safe
 * - Writes need exclusive access
 *
 * @example
 * ```typescript
 * const rwLock = new ReadWriteLock()
 *
 * // Multiple readers can run concurrently
 * async function readData(): Promise<Data> {
 *   return await rwLock.withReadLock(async () => {
 *     return await fetchData()
 *   })
 * }
 *
 * // Writers have exclusive access
 * async function updateData(data: Data): Promise<void> {
 *   await rwLock.withWriteLock(async () => {
 *     await saveData(data)
 *   })
 * }
 * ```
 */
export declare class ReadWriteLock {
    /** Number of active readers */
    private readers;
    /** Whether a writer currently holds the lock */
    private writing;
    /** Queue of waiting writers */
    private writeWaiters;
    /** Queue of waiting readers */
    private readWaiters;
    /**
     * Acquire a read lock.
     *
     * @description
     * Multiple readers can hold the lock simultaneously.
     * Readers wait if a writer is active or waiting.
     *
     * @returns Promise resolving to a release function
     */
    acquireRead(): Promise<ReleaseFn>;
    /**
     * Create a release function for read locks.
     * @private
     */
    private createReadReleaseFn;
    /**
     * Acquire a write lock.
     *
     * @description
     * Only one writer can hold the lock, and no readers can be active.
     * Writers have priority over new readers.
     *
     * @returns Promise resolving to a release function
     */
    acquireWrite(): Promise<ReleaseFn>;
    /**
     * Create a release function for write locks.
     * @private
     */
    private createWriteReleaseFn;
    /**
     * Execute a function while holding a read lock.
     *
     * @param fn - Async function to execute
     * @returns Promise resolving to the function's return value
     */
    withReadLock<T>(fn: () => Promise<T>): Promise<T>;
    /**
     * Execute a function while holding a write lock.
     *
     * @param fn - Async function to execute
     * @returns Promise resolving to the function's return value
     */
    withWriteLock<T>(fn: () => Promise<T>): Promise<T>;
    /**
     * Check if there are active readers.
     */
    hasReaders(): boolean;
    /**
     * Check if a writer is active.
     */
    hasWriter(): boolean;
}
//# sourceMappingURL=async-mutex.d.ts.map