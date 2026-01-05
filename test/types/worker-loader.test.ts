import { describe, it, expect } from 'vitest'
import { WorkerLoader, WorkerCode, WorkerStub, WorkerEntrypoint } from '../../src/types/worker-loader'

describe('WorkerLoader Types', () => {
  describe('Type Checking', () => {
    it('should accept valid WorkerCode configuration', () => {
      const validCode: WorkerCode = {
        compatibilityDate: '2024-01-01',
        mainModule: 'index.js',
        modules: { 'index.js': 'export default {}' }
      }
      expect(validCode.compatibilityDate).toBe('2024-01-01')
    })

    it('should accept WorkerCode with globalOutbound null', () => {
      const code: WorkerCode = {
        compatibilityDate: '2024-01-01',
        mainModule: 'index.js',
        modules: { 'index.js': 'export default {}' },
        globalOutbound: null
      }
      expect(code.globalOutbound).toBeNull()
    })
  })

  describe('MockWorkerLoader Implementation', () => {
    it('should implement WorkerLoader interface', () => {
      // RED: MockWorkerLoader doesn't exist yet
      const { MockWorkerLoader } = require('../../src/types/worker-loader')
      const loader: WorkerLoader = new MockWorkerLoader()
      expect(typeof loader.get).toBe('function')
    })

    it('should cache workers by ID', () => {
      const { MockWorkerLoader } = require('../../src/types/worker-loader')
      const loader: WorkerLoader = new MockWorkerLoader()
      const stub1 = loader.get('w1', async () => ({ compatibilityDate: '2024-01-01', mainModule: 'a.js', modules: {} }))
      const stub2 = loader.get('w1', async () => ({ compatibilityDate: '2024-01-01', mainModule: 'a.js', modules: {} }))
      expect(stub1).toBe(stub2)
    })
  })

  describe('Type Guard: isRealWorkerLoader', () => {
    it('should exist as a function', () => {
      const { isRealWorkerLoader } = require('../../src/types/worker-loader')
      expect(typeof isRealWorkerLoader).toBe('function')
    })

    it('should return false for MockWorkerLoader', () => {
      const { MockWorkerLoader, isRealWorkerLoader } = require('../../src/types/worker-loader')
      expect(isRealWorkerLoader(new MockWorkerLoader())).toBe(false)
    })

    it('should handle null and undefined', () => {
      const { isRealWorkerLoader } = require('../../src/types/worker-loader')
      expect(isRealWorkerLoader(null)).toBe(false)
      expect(isRealWorkerLoader(undefined)).toBe(false)
    })
  })

  describe('Interface Contracts', () => {
    it('WorkerStub.fetch should return Promise<Response>', async () => {
      const stub: WorkerStub = { fetch: async () => new Response('OK') }
      const response = await stub.fetch!(new Request('https://example.com'))
      expect(response).toBeInstanceOf(Response)
    })
  })
})
