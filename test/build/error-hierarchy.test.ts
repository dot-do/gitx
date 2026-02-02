import { describe, it, expect } from 'vitest'
import { MalformedPacketError, NegotiationLimitError, NegotiationTimeoutError } from '../../src/wire/hardening'

describe('error hierarchy', () => {
  it('MalformedPacketError extends WireError', () => {
    const err = new MalformedPacketError('test', 'CODE')
    // Check prototype chain includes WireError
    let proto = Object.getPrototypeOf(err)
    const chain: string[] = []
    while (proto) {
      chain.push(proto.constructor.name)
      proto = Object.getPrototypeOf(proto)
    }
    // Should have WireError in chain, not jump straight to Error
    expect(chain).toContain('WireError')
  })

  it('NegotiationLimitError extends WireError', () => {
    const err = new NegotiationLimitError('test', 'CODE', 'rounds', 10, 5)
    let proto = Object.getPrototypeOf(err)
    const chain: string[] = []
    while (proto) {
      chain.push(proto.constructor.name)
      proto = Object.getPrototypeOf(proto)
    }
    expect(chain).toContain('WireError')
  })

  it('NegotiationTimeoutError extends WireError', () => {
    const err = new NegotiationTimeoutError(5000, 3000)
    let proto = Object.getPrototypeOf(err)
    const chain: string[] = []
    while (proto) {
      chain.push(proto.constructor.name)
      proto = Object.getPrototypeOf(proto)
    }
    expect(chain).toContain('WireError')
  })
})
