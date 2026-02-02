import { describe, it, expect } from 'vitest'
import { detectLanguage, LANGUAGES, DOTFILES } from '../../src/enrichment/language'

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

  describe('DOTFILES constant', () => {
    it('should be a non-empty map of dotfile names to language', () => {
      expect(Object.keys(DOTFILES).length).toBeGreaterThanOrEqual(20)
    })

    it('should map dotfile names without leading dot', () => {
      expect(DOTFILES['bashrc']).toBe('Shell')
      expect(DOTFILES['gitignore']).toBe('gitignore')
    })
  })

  describe('detectLanguage', () => {
    it('returns null for empty or missing extension', () => {
      expect(detectLanguage('')).toBeNull()
      expect(detectLanguage('Makefile')).toBeNull()
    })

    it('returns null for unknown dotfiles', () => {
      expect(detectLanguage('.unknown_dotfile')).toBeNull()
      expect(detectLanguage('.random123')).toBeNull()
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

    describe('dotfile detection', () => {
      it('detects shell config dotfiles', () => {
        expect(detectLanguage('.bashrc')).toBe('Shell')
        expect(detectLanguage('.bash_profile')).toBe('Shell')
        expect(detectLanguage('.bash_aliases')).toBe('Shell')
        expect(detectLanguage('.zshrc')).toBe('Shell')
        expect(detectLanguage('.zshenv')).toBe('Shell')
        expect(detectLanguage('.profile')).toBe('Shell')
      })

      it('detects git dotfiles', () => {
        expect(detectLanguage('.gitignore')).toBe('gitignore')
        expect(detectLanguage('.gitattributes')).toBe('gitattributes')
        expect(detectLanguage('.gitconfig')).toBe('gitconfig')
        expect(detectLanguage('.gitmodules')).toBe('gitconfig')
      })

      it('detects editor config dotfiles', () => {
        expect(detectLanguage('.editorconfig')).toBe('EditorConfig')
        expect(detectLanguage('.vimrc')).toBe('Vim Script')
      })

      it('detects linter/formatter dotfiles', () => {
        expect(detectLanguage('.eslintrc')).toBe('JSON')
        expect(detectLanguage('.prettierrc')).toBe('JSON')
        expect(detectLanguage('.babelrc')).toBe('JSON')
        expect(detectLanguage('.browserslistrc')).toBe('Browserslist')
      })

      it('detects environment dotfiles', () => {
        expect(detectLanguage('.env')).toBe('dotenv')
        expect(detectLanguage('.envrc')).toBe('Shell')
        expect(detectLanguage('.npmrc')).toBe('INI')
        expect(detectLanguage('.nvmrc')).toBe('Text')
      })

      it('detects docker dotfiles', () => {
        expect(detectLanguage('.dockerignore')).toBe('dockerignore')
      })

      it('detects dotfiles with extensions', () => {
        expect(detectLanguage('.eslintrc.json')).toBe('JSON')
        expect(detectLanguage('.eslintrc.js')).toBe('JavaScript')
        expect(detectLanguage('.prettierrc.yaml')).toBe('YAML')
        expect(detectLanguage('.prettierrc.yml')).toBe('YAML')
        expect(detectLanguage('.prettierrc.toml')).toBe('TOML')
        expect(detectLanguage('.tsconfig.json')).toBe('JSON')
        expect(detectLanguage('.babelrc.js')).toBe('JavaScript')
        expect(detectLanguage('.stylelintrc.json')).toBe('JSON')
      })

      it('is case-insensitive for dotfile names', () => {
        expect(detectLanguage('.BASHRC')).toBe('Shell')
        expect(detectLanguage('.Gitignore')).toBe('gitignore')
        expect(detectLanguage('.ESLINTRC')).toBe('JSON')
      })

      it('handles dotfiles in nested paths', () => {
        expect(detectLanguage('home/user/.bashrc')).toBe('Shell')
        expect(detectLanguage('/root/.gitignore')).toBe('gitignore')
        expect(detectLanguage('project/config/.eslintrc.json')).toBe('JSON')
      })

      it('prefers extension over dotfile name when extension is known', () => {
        // .prettierrc.json should return JSON (from extension), not JSON (from dotfile mapping)
        expect(detectLanguage('.prettierrc.json')).toBe('JSON')
        // A dotfile with unknown base but known extension
        expect(detectLanguage('.something.ts')).toBe('TypeScript')
        expect(detectLanguage('.config.yaml')).toBe('YAML')
      })
    })
  })
})
