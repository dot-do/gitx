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
/** Minimal interface matching the return value of `sql.exec(...)`. */
export interface SqlResult {
    toArray(): unknown[];
}
/** A user-supplied type-guard that narrows an unknown row to `T`. */
export type RowValidator<T> = (row: unknown) => row is T;
/**
 * Check that `row` is a non-null object containing every key in `keys`.
 *
 * This is intentionally lightweight: it only asserts key presence, not
 * value types, which keeps the overhead minimal for hot paths.
 */
export declare function validateRowKeys(row: unknown, keys: string[]): boolean;
/**
 * Build a simple `RowValidator` that checks for the presence of `keys`.
 *
 * @example
 * ```ts
 * const isRefRow = validateRow<RefRow>(['name', 'target', 'type'])
 * const refs = typedQuery(result, isRefRow)
 * ```
 */
export declare function validateRow<T extends Record<string, unknown>>(keys: (keyof T & string)[]): RowValidator<T>;
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
export declare function typedQuery<T extends Record<string, unknown>>(result: SqlResult, validator?: RowValidator<T>): T[];
//# sourceMappingURL=sql-validate.d.ts.map