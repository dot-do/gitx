import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import path from 'path'

export default defineWorkersConfig({
  resolve: {
    alias: [
      { find: /^@dotdo\/gitx\/(.*)$/, replacement: path.resolve(__dirname, './core/$1') },
      { find: '@dotdo/gitx', replacement: path.resolve(__dirname, './core') },
    ],
  },
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    // Exclude tests that require Node.js APIs (vm, child_process, os, etc.)
    // These run in vitest.node.config.ts instead
    // Heavy dirs (do/, storage/, wire/) are split to vitest.config.2.ts to avoid OOM
    exclude: [
      'test/cli/**/*.test.ts',
      'test/mcp/**/*.test.ts',
      'test/do/**/*.test.ts',
      'test/storage/**/*.test.ts',
      'test/wire/**/*.test.ts',
      'test/pack/**/*.test.ts',
      'test/ops/**/*.test.ts',
      'test/tiered/**/*.test.ts',
      'test/integration/**/*.test.ts',
      'test/rpc/**/*.test.ts',
      'test/e2e/**/*.test.ts',
      'test/build/**/*.test.ts',
    ],
    // Memory optimization: run test files sequentially to prevent OOM
    fileParallelism: false,
    maxConcurrency: 1,
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.test.toml' },
        singleWorker: true,
        // Limit memory per worker
        miniflare: {
          compatibilityFlags: ['nodejs_compat'],
        },
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts'],
      thresholds: {
        statements: 75,
        branches: 60,
        functions: 60,
        lines: 75
      }
    },
    testTimeout: 30000
  }
})
