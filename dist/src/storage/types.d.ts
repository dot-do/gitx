/** Abstract SQL storage interface for storage layer modules. */
export interface SQLStorage {
    sql: {
        exec(query: string, ...params: unknown[]): {
            toArray(): unknown[];
        };
    };
}
/**
 * Interface representing Durable Object storage with SQL capabilities.
 *
 * @description
 * Abstraction over Cloudflare's Durable Object storage that provides
 * SQLite access. This interface allows for easy mocking in tests.
 * Extends the abstract SQLStorage interface used by storage layer modules.
 *
 * @example
 * ```typescript
 * const storage: DurableObjectStorage = {
 *   sql: {
 *     exec(query: string, ...params: unknown[]) {
 *       // Execute SQL and return results
 *       return { toArray: () => [] }
 *     }
 *   }
 * }
 * ```
 */
export interface DurableObjectStorage extends SQLStorage {
}
//# sourceMappingURL=types.d.ts.map