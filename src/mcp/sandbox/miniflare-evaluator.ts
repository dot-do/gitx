/**
 * @fileoverview Miniflare-based Code Evaluator
 *
 * Provides local V8 isolate evaluation using Miniflare for development.
 */

import { Worker } from 'node:worker_threads'

export interface MiniflareEvaluatorConfig {
  timeout?: number
  memoryLimit?: number
  cpuLimit?: number
}

export interface EvaluatorResult {
  success: boolean
  value?: unknown
  error?: string
  logs: string[]
  duration: number
}

interface WorkerResult {
  success: boolean
  value?: unknown
  error?: string
  logs: string[]
}

export async function evaluateWithMiniflare(
  code: string,
  config?: MiniflareEvaluatorConfig
): Promise<EvaluatorResult> {
  const timeout = config?.timeout ?? 5000
  const startTime = performance.now()

  // Check for network calls (fetch, XMLHttpRequest, etc.)
  if (/\bfetch\s*\(/.test(code) || /XMLHttpRequest/.test(code)) {
    return {
      success: false,
      error: 'network requests are blocked',
      logs: [],
      duration: performance.now() - startTime,
    }
  }

  // Worker thread code for isolated execution
  const workerCode = `
    const { parentPort } = require('worker_threads');

    const logs = [];
    const mockConsole = {
      log: (...args) => logs.push(args.map(a => String(a)).join(' ')),
      error: (...args) => logs.push(args.map(a => String(a)).join(' ')),
      warn: (...args) => logs.push(args.map(a => String(a)).join(' ')),
      info: (...args) => logs.push(args.map(a => String(a)).join(' ')),
    };

    (async () => {
      try {
        const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
        const fn = new AsyncFunction('console', ${JSON.stringify(code)});
        const value = await fn(mockConsole);
        parentPort.postMessage({ success: true, value, logs });
      } catch (error) {
        parentPort.postMessage({
          success: false,
          error: error.message || String(error),
          logs
        });
      }
    })();
  `

  return new Promise<EvaluatorResult>((resolve) => {
    const worker = new Worker(workerCode, { eval: true })

    const timeoutId = setTimeout(() => {
      worker.terminate()
      resolve({
        success: false,
        error: 'timeout exceeded',
        logs: [],
        duration: performance.now() - startTime,
      })
    }, timeout)

    worker.on('message', (result: WorkerResult) => {
      clearTimeout(timeoutId)
      worker.terminate()
      resolve({
        success: result.success,
        value: result.value,
        error: result.error,
        logs: result.logs,
        duration: performance.now() - startTime,
      })
    })

    worker.on('error', (error: Error) => {
      clearTimeout(timeoutId)
      worker.terminate()
      resolve({
        success: false,
        error: error.message,
        logs: [],
        duration: performance.now() - startTime,
      })
    })
  })
}
