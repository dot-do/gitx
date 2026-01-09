import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        singleWorker: true,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts']
    },
    testTimeout: 10000
  }
})
