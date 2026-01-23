import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import path from 'path'

export default defineWorkersConfig({
  resolve: {
    alias: {
      '@dotdo/gitx': path.resolve(__dirname, './packages/core'),
      'core': path.resolve(__dirname, './packages/core'),
    },
  },
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    // Exclude tests that require Node.js APIs (vm, child_process, os, etc.)
    // These run in vitest.node.config.ts instead
    exclude: [
      'test/cli/**/*.test.ts',
      'test/mcp/**/*.test.ts',
    ],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.test.toml' },
        singleWorker: true,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts'],
      thresholds: {
        statements: 65,
        branches: 50,
        functions: 50,
        lines: 65
      }
    },
    testTimeout: 30000
  }
})
