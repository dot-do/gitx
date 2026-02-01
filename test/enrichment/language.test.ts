import { describe, it, expect } from 'vitest'
import { detectLanguage, LANGUAGES } from '../../src/enrichment/language'

describe('language detection', () => {
  describe('LANGUAGES constant', () => {
    it('should be a non-empty map of extension to language', () => {
      expect(Object.keys(LANGUAGES).length).toBeGreaterThanOrEqual(50)
    })

    it('should map extensions without leading dot', () => {
      expect(LANGUAGES['ts']).toBe('TypeScript')
      expect(LANGUAGES['py']).toBe('Python')
    })
  })

  describe('detectLanguage', () => {
    it('returns null for empty or missing extension', () => {
      expect(detectLanguage('')).toBeNull()
      expect(detectLanguage('Makefile')).toBeNull()
      expect(detectLanguage('.hidden')).toBeNull()
    })

    it('detects TypeScript', () => {
      expect(detectLanguage('src/index.ts')).toBe('TypeScript')
      expect(detectLanguage('component.tsx')).toBe('TypeScript')
    })

    it('detects JavaScript', () => {
      expect(detectLanguage('app.js')).toBe('JavaScript')
      expect(detectLanguage('app.jsx')).toBe('JavaScript')
      expect(detectLanguage('app.mjs')).toBe('JavaScript')
      expect(detectLanguage('app.cjs')).toBe('JavaScript')
    })

    it('detects Python', () => {
      expect(detectLanguage('script.py')).toBe('Python')
      expect(detectLanguage('script.pyi')).toBe('Python')
      expect(detectLanguage('script.pyw')).toBe('Python')
    })

    it('detects Rust', () => {
      expect(detectLanguage('main.rs')).toBe('Rust')
    })

    it('detects Go', () => {
      expect(detectLanguage('main.go')).toBe('Go')
    })

    it('detects Java', () => {
      expect(detectLanguage('Main.java')).toBe('Java')
    })

    it('detects C and C++', () => {
      expect(detectLanguage('main.c')).toBe('C')
      expect(detectLanguage('main.h')).toBe('C')
      expect(detectLanguage('main.cpp')).toBe('C++')
      expect(detectLanguage('main.cxx')).toBe('C++')
      expect(detectLanguage('main.cc')).toBe('C++')
      expect(detectLanguage('main.hpp')).toBe('C++')
    })

    it('detects C#', () => {
      expect(detectLanguage('Program.cs')).toBe('C#')
    })

    it('detects Ruby', () => {
      expect(detectLanguage('app.rb')).toBe('Ruby')
    })

    it('detects PHP', () => {
      expect(detectLanguage('index.php')).toBe('PHP')
    })

    it('detects Swift', () => {
      expect(detectLanguage('app.swift')).toBe('Swift')
    })

    it('detects Kotlin', () => {
      expect(detectLanguage('Main.kt')).toBe('Kotlin')
      expect(detectLanguage('Main.kts')).toBe('Kotlin')
    })

    it('detects markup languages', () => {
      expect(detectLanguage('index.html')).toBe('HTML')
      expect(detectLanguage('index.htm')).toBe('HTML')
      expect(detectLanguage('style.css')).toBe('CSS')
      expect(detectLanguage('style.scss')).toBe('SCSS')
      expect(detectLanguage('style.sass')).toBe('Sass')
      expect(detectLanguage('style.less')).toBe('Less')
    })

    it('detects data formats', () => {
      expect(detectLanguage('config.json')).toBe('JSON')
      expect(detectLanguage('config.yaml')).toBe('YAML')
      expect(detectLanguage('config.yml')).toBe('YAML')
      expect(detectLanguage('config.toml')).toBe('TOML')
      expect(detectLanguage('config.xml')).toBe('XML')
      expect(detectLanguage('data.csv')).toBe('CSV')
    })

    it('detects shell scripts', () => {
      expect(detectLanguage('run.sh')).toBe('Shell')
      expect(detectLanguage('run.bash')).toBe('Shell')
      expect(detectLanguage('run.zsh')).toBe('Shell')
      expect(detectLanguage('run.fish')).toBe('Fish')
    })

    it('detects markdown and docs', () => {
      expect(detectLanguage('README.md')).toBe('Markdown')
      expect(detectLanguage('README.mdx')).toBe('MDX')
      expect(detectLanguage('doc.rst')).toBe('reStructuredText')
      expect(detectLanguage('doc.tex')).toBe('LaTeX')
    })

    it('detects SQL', () => {
      expect(detectLanguage('query.sql')).toBe('SQL')
    })

    it('detects Dart', () => {
      expect(detectLanguage('main.dart')).toBe('Dart')
    })

    it('detects Scala', () => {
      expect(detectLanguage('Main.scala')).toBe('Scala')
    })

    it('detects Haskell', () => {
      expect(detectLanguage('Main.hs')).toBe('Haskell')
    })

    it('detects Lua', () => {
      expect(detectLanguage('init.lua')).toBe('Lua')
    })

    it('detects R', () => {
      expect(detectLanguage('analysis.r')).toBe('R')
      expect(detectLanguage('analysis.R')).toBe('R')
    })

    it('detects Elixir and Erlang', () => {
      expect(detectLanguage('app.ex')).toBe('Elixir')
      expect(detectLanguage('app.exs')).toBe('Elixir')
      expect(detectLanguage('app.erl')).toBe('Erlang')
    })

    it('detects Clojure', () => {
      expect(detectLanguage('core.clj')).toBe('Clojure')
      expect(detectLanguage('core.cljs')).toBe('ClojureScript')
    })

    it('detects Vue and Svelte', () => {
      expect(detectLanguage('App.vue')).toBe('Vue')
      expect(detectLanguage('App.svelte')).toBe('Svelte')
    })

    it('detects Zig and Nim', () => {
      expect(detectLanguage('main.zig')).toBe('Zig')
      expect(detectLanguage('main.nim')).toBe('Nim')
    })

    it('detects Julia', () => {
      expect(detectLanguage('solver.jl')).toBe('Julia')
    })

    it('detects Dockerfile and proto', () => {
      expect(detectLanguage('schema.proto')).toBe('Protocol Buffers')
      expect(detectLanguage('schema.graphql')).toBe('GraphQL')
      expect(detectLanguage('schema.gql')).toBe('GraphQL')
    })

    it('detects Terraform and config', () => {
      expect(detectLanguage('main.tf')).toBe('Terraform')
      expect(detectLanguage('config.hcl')).toBe('HCL')
    })

    it('is case-insensitive for extensions', () => {
      expect(detectLanguage('file.PY')).toBe('Python')
      expect(detectLanguage('file.Ts')).toBe('TypeScript')
    })

    it('returns null for unknown extensions', () => {
      expect(detectLanguage('file.xyz123')).toBeNull()
      expect(detectLanguage('file.unknown')).toBeNull()
    })

    it('handles deeply nested paths', () => {
      expect(detectLanguage('a/b/c/d/e/file.rs')).toBe('Rust')
    })
  })
})
