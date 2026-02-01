/** Abstract SQL storage interface for storage layer modules. */
export interface SQLStorage {
  sql: {
    exec(query: string, ...params: unknown[]): { toArray(): unknown[] }
  }
}
