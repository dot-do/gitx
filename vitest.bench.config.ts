import { defineConfig } from 'vitest/config'

/**
 * Vitest config for benchmark tests.
 *
 * Run with: pnpm bench
 *
 * This configuration is optimized for running performance benchmarks
 * outside of the Cloudflare Workers environment.
 */
export default defineConfig({
  test: {
    globals: true,
    include: ['bench/**/*.bench.ts'],
    benchmark: {
      include: ['bench/**/*.bench.ts'],
      // Reporter options
      reporters: ['default'],
      // Output results to JSON for tracking over time
      outputJson: './bench/results.json',
    },
    environment: 'node',
    testTimeout: 120000, // 2 minutes for benchmarks
  },
})
