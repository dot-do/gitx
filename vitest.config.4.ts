import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import path from 'path'

// Fourth shard of Workers tests — storage/
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
      'test/storage/**/*.test.ts',
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
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'core/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/index.ts',
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
