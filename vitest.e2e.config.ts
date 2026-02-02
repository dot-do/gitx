import { defineConfig } from 'vitest/config'

/**
 * Vitest config for E2E tests.
 *
 * These tests run against real deployed workers and/or GitHub.
 * Run with: pnpm test:e2e
 */
export default defineConfig({
  test: {
    globals: true,
    include: ['test/e2e/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
    fileParallelism: false,
  },
})
