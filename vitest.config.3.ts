import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import path from 'path'

// Third shard of Workers tests — storage/, pack/, ops/
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
      'test/ops/**/*.test.ts',
      'test/tiered/**/*.test.ts',
      'test/integration/**/*.test.ts',
      'test/rpc/**/*.test.ts',
      'test/pack/**/*.test.ts',
    ],
    exclude: [
      'test/cli/**/*.test.ts',
      'test/mcp/**/*.test.ts',
      'test/e2e/**/*.test.ts',
      'test/build/**/*.test.ts',
      // This test OOMs in workerd due to heavy parquet imports; skip for now
      'test/tiered/migration.test.ts',
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
    testTimeout: 30000
  }
})
