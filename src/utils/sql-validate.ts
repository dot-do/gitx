/**
 * @fileoverview Runtime validation for SQL result casting
 *
 * Provides a `typedQuery` utility that replaces raw `.toArray() as T[]`
 * casts with optional runtime shape validation. In development mode the
 * first row of each result set is checked against expected keys so that
 * schema drift is caught early.
 *
 * @module utils/sql-validate
 */

// ============================================================================
// Types
// ============================================================================

/** Minimal interface matching the return value of `sql.exec(...)`. */
export interface SqlResult {
  toArray(): unknown[]
}

/** A user-supplied type-guard that narrows an unknown row to `T`. */
export type RowValidator<T> = (row: unknown) => row is T

// ============================================================================
// Row validation helpers
// ============================================================================

/**
 * Check that `row` is a non-null object containing every key in `keys`.
 *
 * This is intentionally lightweight: it only asserts key presence, not
 * value types, which keeps the overhead minimal for hot paths.
 */
export function validateRowKeys(row: unknown, keys: string[]): boolean {
  if (row === null || row === undefined || typeof row !== 'object') {
    return false
  }
  const obj = row as Record<string, unknown>
  for (const key of keys) {
    if (!(key in obj)) {
      return false
    }
  }
  return true
}

/**
 * Build a simple `RowValidator` that checks for the presence of `keys`.
 *
 * @example
 * ```ts
 * const isRefRow = validateRow<RefRow>(['name', 'target', 'type'])
 * const refs = typedQuery(result, isRefRow)
 * ```
 */
export function validateRow<T extends Record<string, unknown>>(
  keys: (keyof T & string)[]
): RowValidator<T> {
  return (row: unknown): row is T => validateRowKeys(row, keys)
}

// ============================================================================
// Main utility
// ============================================================================

/**
 * Safely extract typed rows from a SQL query result.
 *
 * Replaces the common `result.toArray() as T[]` pattern with an optional
 * runtime check. When a `validator` is supplied the first row of the result
 * set is validated; a failing check throws immediately so that bugs caused
 * by schema drift surface during development rather than silently producing
 * corrupt data.
 *
 * @param result   - The object returned by `sql.exec(...)`.
 * @param validator - Optional type-guard. When omitted the cast is still
 *                    performed but no runtime check takes place (equivalent
 *                    to the old `as T[]` behaviour).
 * @returns The result rows typed as `T[]`.
 *
 * @example
 * ```ts
 * interface CountRow { cnt: number }
 * const rows = typedQuery<CountRow>(
 *   storage.sql.exec('SELECT COUNT(*) as cnt FROM table'),
 *   validateRow<CountRow>(['cnt']),
 * )
 * ```
 */
export function typedQuery<T extends Record<string, unknown>>(
  result: SqlResult,
  validator?: RowValidator<T>
): T[] {
  const rows = result.toArray()
  if (rows.length === 0) return [] as T[]

  if (validator && !validator(rows[0])) {
    const sample = JSON.stringify(rows[0])
    throw new TypeError(
      `typedQuery: first row failed validation. Got: ${sample}`
    )
  }

  return rows as T[]
}
