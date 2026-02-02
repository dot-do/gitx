import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import path from 'path'

// Second shard of Workers tests — heavier dirs: do/, storage/, wire/
export default defineWorkersConfig({
  resolve: {
    alias: [
      { find: /^@dotdo\/gitx\/(.*)$/, replacement: path.resolve(__dirname, './core/$1') },
      { find: '@dotdo/gitx', replacement: path.resolve(__dirname, './core') },
    ],
  },
  test: {
    globals: true,
    include: [
      'test/do/**/*.test.ts',
      'test/storage/**/*.test.ts',
      'test/wire/**/*.test.ts',
    ],
    exclude: [
      'test/cli/**/*.test.ts',
      'test/mcp/**/*.test.ts',
      'test/do/rpc.test.ts',
      'test/e2e/**/*.test.ts',
      'test/build/**/*.test.ts',
    ],
    fileParallelism: false,
    maxConcurrency: 1,
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.test.toml' },
        singleWorker: true,
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
