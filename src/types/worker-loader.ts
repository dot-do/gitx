/**
 * @fileoverview Worker Loader Types
 *
 * This module defines types for loading and interacting with Cloudflare Workers
 * in the gitdo environment. Based on patterns from mongo.do research.
 *
 * @module types/worker-loader
 */

/**
 * WorkerLoader interface for managing worker instances.
 */
export interface WorkerLoader {
  get(id: string, getCode: () => Promise<WorkerCode>): WorkerStub
}

/**
 * WorkerCode defines the configuration and modules for a worker.
 */
export interface WorkerCode {
  compatibilityDate: string
  compatibilityFlags?: string[]
  mainModule: string
  modules: Record<string, string | { js: string } | { text: string }>
  globalOutbound?: null
  env?: Record<string, unknown>
}

/**
 * WorkerStub provides methods to interact with a worker instance.
 */
export interface WorkerStub {
  fetch?(request: Request): Promise<Response>
  getEntrypoint?(name?: string): WorkerEntrypoint
}

/**
 * WorkerEntrypoint represents a worker's entrypoint.
 */
export interface WorkerEntrypoint {
  fetch(request: Request): Promise<Response>
}
