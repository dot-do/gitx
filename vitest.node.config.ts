import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Vitest config for Node.js-specific tests.
 *
 * These tests require Node.js APIs (vm, child_process, os, etc.)
 * and cannot run in the Cloudflare Workers pool.
 *
 * Run with: npx vitest run --config vitest.node.config.ts
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@dotdo\/gitx\/(.*)$/, replacement: path.resolve(__dirname, './core/$1') },
      { find: '@dotdo/gitx', replacement: path.resolve(__dirname, './core') },
    ],
  },
  test: {
    globals: true,
    include: [
      'test/build/**/*.test.ts',
      'test/cli/**/*.test.ts',
      'test/mcp/**/*.test.ts',
      'test/core/**/*.test.ts',
      'test/do/rpc.test.ts',
      'test/e2e/**/*.test.ts',
      'test/integration/**/*.test.ts',
    ],
    environment: 'node',
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/cli/**/*.ts', 'src/mcp/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        '**/*.test.ts',
        '**/test/**',
        '**/mocks/**',
        '**/dist/**',
      ],
      thresholds: {
        lines: 70,
        branches: 60,
        functions: 70,
        statements: 70,
      },
    },
  }
})
