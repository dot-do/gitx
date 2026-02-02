import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'

describe('barrel exports', () => {
  it('root index.ts has no duplicate export names', () => {
    // Run tsc --noEmit and check for TS2308 errors in index.ts
    try {
      execSync('npx tsc --noEmit 2>&1', {
        cwd: '/Users/nathanclevenger/projects/gitx',
        encoding: 'utf-8',
        timeout: 60000
      })
    } catch (error: any) {
      const output = error.stdout || error.stderr || ''
      const ts2308Errors = output.split('\n').filter((line: string) =>
        line.includes('index.ts') && line.includes('TS2308')
      )
      expect(ts2308Errors, `Found ${ts2308Errors.length} duplicate export collisions in index.ts`).toHaveLength(0)
    }
  })
})
