import { describe, it, expect } from 'vitest'
import { typedQuery, validateRow, validateRowKeys } from '../../src/utils/sql-validate'
import type { SqlResult, RowValidator } from '../../src/utils/sql-validate'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fake SqlResult wrapping the given rows. */
function fakeResult(rows: unknown[]): SqlResult {
  return { toArray: () => rows }
}

// ---------------------------------------------------------------------------
// validateRowKeys
// ---------------------------------------------------------------------------

describe('validateRowKeys', () => {
  it('returns true when all keys are present', () => {
    expect(validateRowKeys({ a: 1, b: 'two' }, ['a', 'b'])).toBe(true)
  })

  it('returns true when extra keys exist', () => {
    expect(validateRowKeys({ a: 1, b: 2, c: 3 }, ['a', 'b'])).toBe(true)
  })

  it('returns false when a key is missing', () => {
    expect(validateRowKeys({ a: 1 }, ['a', 'b'])).toBe(false)
  })

  it('returns false for null', () => {
    expect(validateRowKeys(null, ['a'])).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(validateRowKeys(undefined, ['a'])).toBe(false)
  })

  it('returns false for non-objects', () => {
    expect(validateRowKeys(42, ['a'])).toBe(false)
    expect(validateRowKeys('string', ['a'])).toBe(false)
  })

  it('returns true for empty keys array (any object passes)', () => {
    expect(validateRowKeys({}, [])).toBe(true)
    expect(validateRowKeys({ a: 1 }, [])).toBe(true)
  })

  it('handles keys whose values are null or undefined', () => {
    expect(validateRowKeys({ a: null, b: undefined }, ['a', 'b'])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// validateRow
// ---------------------------------------------------------------------------

describe('validateRow', () => {
  it('returns a type-guard function', () => {
    const guard = validateRow<{ id: number; name: string }>(['id', 'name'])
    expect(typeof guard).toBe('function')
  })

  it('guard passes for matching rows', () => {
    const guard = validateRow<{ id: number }>(['id'])
    expect(guard({ id: 42 })).toBe(true)
  })

  it('guard fails for non-matching rows', () => {
    const guard = validateRow<{ id: number }>(['id'])
    expect(guard({ name: 'oops' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// typedQuery
// ---------------------------------------------------------------------------

describe('typedQuery', () => {
  it('returns typed rows from a result', () => {
    const result = fakeResult([{ id: 1 }, { id: 2 }])
    const rows = typedQuery<{ id: number }>(result)
    expect(rows).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('returns empty array for empty results', () => {
    const rows = typedQuery<{ id: number }>(fakeResult([]))
    expect(rows).toEqual([])
  })

  it('passes when validator succeeds on first row', () => {
    const result = fakeResult([{ id: 1, name: 'a' }, { id: 2, name: 'b' }])
    const guard = validateRow<{ id: number; name: string }>(['id', 'name'])
    const rows = typedQuery(result, guard)
    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe('a')
  })

  it('throws TypeError when validator fails on first row', () => {
    const result = fakeResult([{ wrong_key: 1 }])
    const guard = validateRow<{ id: number }>(['id'])
    expect(() => typedQuery(result, guard)).toThrow(TypeError)
    expect(() => typedQuery(result, guard)).toThrow('typedQuery: first row failed validation')
  })

  it('skips validation when no validator is provided', () => {
    const result = fakeResult([{ anything: true }])
    // No validator — should not throw
    const rows = typedQuery<{ anything: boolean }>(result)
    expect(rows).toEqual([{ anything: true }])
  })

  it('does not validate beyond the first row', () => {
    // Second row is malformed, but validation only checks the first row
    const result = fakeResult([{ id: 1 }, { bad: true }])
    const guard = validateRow<{ id: number }>(['id'])
    const rows = typedQuery(result, guard)
    expect(rows).toHaveLength(2)
  })

  it('includes the row sample in the error message', () => {
    const result = fakeResult([{ x: 99 }])
    const guard = validateRow<{ id: number }>(['id'])
    try {
      typedQuery(result, guard)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as Error).message).toContain('"x":99')
    }
  })

  it('works with a custom validator function', () => {
    const customValidator: RowValidator<{ count: number }> = (
      row: unknown,
    ): row is { count: number } => {
      return typeof row === 'object' && row !== null && 'count' in row && typeof (row as Record<string, unknown>).count === 'number'
    }

    const good = fakeResult([{ count: 5 }])
    expect(typedQuery(good, customValidator)).toEqual([{ count: 5 }])

    const bad = fakeResult([{ count: 'not a number' }])
    expect(() => typedQuery(bad, customValidator)).toThrow(TypeError)
  })
})
