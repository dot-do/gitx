/**
 * @fileoverview Miniflare-based Code Evaluator
 *
 * Provides local V8 isolate evaluation using Miniflare for development.
 */
import { Worker } from 'node:worker_threads';
export async function evaluateWithMiniflare(code, config) {
    const timeout = config?.timeout ?? 5000;
    const startTime = performance.now();
    const objectStore = config?.objectStore;
    // Check for network calls (fetch, XMLHttpRequest, etc.)
    if (/\bfetch\s*\(/.test(code) || /XMLHttpRequest/.test(code)) {
        return {
            success: false,
            error: 'network requests are blocked',
            logs: [],
            duration: performance.now() - startTime,
        };
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
  `;
    return new Promise((resolve) => {
        const worker = new Worker(workerCode, { eval: true });
        const timeoutId = setTimeout(() => {
            worker.terminate();
            resolve({
                success: false,
                error: 'timeout exceeded',
                logs: [],
                duration: performance.now() - startTime,
            });
        }, timeout);
        worker.on('message', async (msg) => {
            if (msg.type === 'store_call' && objectStore) {
                // Handle store proxy calls from worker
                const { callId, method, args } = msg;
                try {
                    let result;
                    if (method === 'getObject') {
                        result = await objectStore.getObject(args[0]);
                    }
                    else if (method === 'putObject') {
                        // Convert array back to Uint8Array
                        const data = args[1] instanceof Array ? new Uint8Array(args[1]) : args[1];
                        result = await objectStore.putObject(args[0], data);
                    }
                    else if (method === 'listObjects') {
                        result = await objectStore.listObjects(args[0]);
                    }
                    worker.postMessage({ type: 'store_response', callId, result });
                }
                catch (error) {
                    const err = error;
                    worker.postMessage({ type: 'store_response', callId, error: err.message });
                }
            }
            else if (msg.type === 'result') {
                clearTimeout(timeoutId);
                worker.terminate();
                resolve({
                    success: msg.success,
                    value: msg.value,
                    error: msg.error,
                    logs: msg.logs,
                    duration: performance.now() - startTime,
                });
            }
        });
        worker.on('error', (error) => {
            clearTimeout(timeoutId);
            worker.terminate();
            resolve({
                success: false,
                error: error.message,
                logs: [],
                duration: performance.now() - startTime,
            });
        });
    });
}
//# sourceMappingURL=miniflare-evaluator.js.map