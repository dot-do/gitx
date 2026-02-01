import { describe, it, expect } from 'vitest'
import { extractAst, type AstNode } from '../../src/enrichment/ast'

describe('AST extraction', () => {
  describe('extractAst', () => {
    it('returns null for unsupported languages', () => {
      expect(extractAst('print("hi")', 'Python')).toBeNull()
      expect(extractAst('fn main() {}', 'Rust')).toBeNull()
      expect(extractAst('package main', 'Go')).toBeNull()
    })

    it('returns null for supported languages (stub)', () => {
      // Stubs return null until real parsers are integrated
      expect(extractAst('const x = 1', 'JavaScript')).toBeNull()
      expect(extractAst('const x: number = 1', 'TypeScript')).toBeNull()
      expect(extractAst('# Hello', 'MDX')).toBeNull()
    })

    it('returns null for empty content', () => {
      expect(extractAst('', 'JavaScript')).toBeNull()
      expect(extractAst('', 'TypeScript')).toBeNull()
    })

    it('accepts any string content without throwing', () => {
      expect(() => extractAst('}{invalid syntax!!!', 'JavaScript')).not.toThrow()
      expect(() => extractAst('<><><<<', 'TypeScript')).not.toThrow()
    })
  })

  describe('AstNode interface', () => {
    it('can create objects conforming to AstNode', () => {
      const node: AstNode = {
        type: 'FunctionDeclaration',
        name: 'hello',
        start: 0,
        end: 20,
      }
      expect(node.type).toBe('FunctionDeclaration')
      expect(node.name).toBe('hello')
      expect(node.start).toBe(0)
      expect(node.end).toBe(20)
      expect(node.children).toBeUndefined()
    })

    it('supports nested children', () => {
      const node: AstNode = {
        type: 'Program',
        start: 0,
        end: 100,
        children: [
          { type: 'VariableDeclaration', name: 'x', start: 0, end: 10 },
        ],
      }
      expect(node.children).toHaveLength(1)
      expect(node.children![0].name).toBe('x')
    })
  })
})
