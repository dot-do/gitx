/**
 * @fileoverview Miniflare-based Code Evaluator
 *
 * Provides local V8 isolate evaluation using Miniflare for development.
 */

import { Worker } from 'node:worker_threads'
import { ObjectStoreProxy } from './object-store-proxy'

export interface MiniflareEvaluatorConfig {
  timeout?: number
  memoryLimit?: number
  cpuLimit?: number
  objectStore?: ObjectStoreProxy
}

export interface EvaluatorResult {
  success: boolean
  value?: unknown
  error?: string
  logs: string[]
  duration: number
}

interface WorkerResult {
  type: 'result'
  success: boolean
  value?: unknown
  error?: string
  logs: string[]
}

interface StoreCallMessage {
  type: 'store_call'
  callId: string
  method: string
  args: unknown[]
}

interface StoreResponseMessage {
  type: 'store_response'
  callId: string
  result?: unknown
  error?: string
}

type WorkerMessage = WorkerResult | StoreCallMessage

export async function evaluateWithMiniflare(
  code: string,
  config?: MiniflareEvaluatorConfig
): Promise<EvaluatorResult> {
  const timeout = config?.timeout ?? 5000
  const startTime = performance.now()
  const objectStore = config?.objectStore

  // Check for network calls (fetch, XMLHttpRequest, etc.)
  if (/\bfetch\s*\(/.test(code) || /XMLHttpRequest/.test(code)) {
    return {
      success: false,
      error: 'network requests are blocked',
      logs: [],
      duration: performance.now() - startTime,
    }
  }

  // Worker thread code for isolated execution with store support
  const workerCode = `
    const { parentPort } = require('worker_threads');

    const logs = [];

    // Helper to stringify objects properly
    const stringify = (val) => {
      if (val === null) return 'null';
      if (val === undefined) return 'undefined';
      if (typeof val === 'object') {
        try {
          return JSON.stringify(val);
        } catch {
          return String(val);
        }
      }
      return String(val);
    };

    const mockConsole = {
      log: (...args) => logs.push(args.map(stringify).join(' ')),
      error: (...args) => logs.push(args.map(stringify).join(' ')),
      warn: (...args) => logs.push(args.map(stringify).join(' ')),
      info: (...args) => logs.push(args.map(stringify).join(' ')),
    };

    // Store proxy that communicates with parent thread
    let callId = 0;
    const pendingCalls = new Map();

    const store = {
      async getObject(sha) {
        return new Promise((resolve, reject) => {
          const id = String(++callId);
          pendingCalls.set(id, { resolve, reject });
          parentPort.postMessage({ type: 'store_call', callId: id, method: 'getObject', args: [sha] });
        });
      },
      async putObject(type, data) {
        return new Promise((resolve, reject) => {
          const id = String(++callId);
          pendingCalls.set(id, { resolve, reject });
          // Convert Uint8Array to array for serialization
          const serializedData = data instanceof Uint8Array ? Array.from(data) : data;
          parentPort.postMessage({ type: 'store_call', callId: id, method: 'putObject', args: [type, serializedData] });
        });
      },
      async listObjects(options) {
        return new Promise((resolve, reject) => {
          const id = String(++callId);
          pendingCalls.set(id, { resolve, reject });
          parentPort.postMessage({ type: 'store_call', callId: id, method: 'listObjects', args: [options] });
        });
      }
    };

    // Listen for store responses
    parentPort.on('message', (msg) => {
      if (msg.type === 'store_response') {
        const pending = pendingCalls.get(msg.callId);
        if (pending) {
          pendingCalls.delete(msg.callId);
          if (msg.error) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve(msg.result);
          }
        }
      }
    });

    (async () => {
      try {
        const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
        const fn = new AsyncFunction('console', 'store', ${JSON.stringify(code)});
        const value = await fn(mockConsole, store);
        parentPort.postMessage({ type: 'result', success: true, value, logs });
      } catch (error) {
        parentPort.postMessage({
          type: 'result',
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

    worker.on('message', async (msg: WorkerMessage) => {
      if (msg.type === 'store_call' && objectStore) {
        // Handle store proxy calls from worker
        const { callId, method, args } = msg
        try {
          let result: unknown
          if (method === 'getObject') {
            result = await objectStore.getObject(args[0] as string)
          } else if (method === 'putObject') {
            // Convert array back to Uint8Array
            const data = args[1] instanceof Array ? new Uint8Array(args[1] as number[]) : args[1] as Uint8Array
            result = await objectStore.putObject(args[0] as string, data)
          } else if (method === 'listObjects') {
            result = await objectStore.listObjects(args[0] as { type?: string; limit?: number } | undefined)
          }
          worker.postMessage({ type: 'store_response', callId, result } as StoreResponseMessage)
        } catch (error) {
          const err = error as Error
          worker.postMessage({ type: 'store_response', callId, error: err.message } as StoreResponseMessage)
        }
      } else if (msg.type === 'result') {
        clearTimeout(timeoutId)
        worker.terminate()
        resolve({
          success: msg.success,
          value: msg.value,
          error: msg.error,
          logs: msg.logs,
          duration: performance.now() - startTime,
        })
      }
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
