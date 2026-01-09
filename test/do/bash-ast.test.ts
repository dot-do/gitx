/**
 * @fileoverview Tests for Bash AST Parser and Safety Analyzer
 *
 * These tests verify the AST-based bash command parser and safety
 * analysis functionality used by the BashModule.
 */

import { describe, it, expect } from 'vitest'
import {
  parseBashCommand,
  analyzeASTSafety,
  parseAndAnalyze,
  type ListNode,
  type CommandNode,
  type PipelineNode,
} from '../../src/do/bash-ast'

// ============================================================================
// Parser Tests
// ============================================================================

describe('parseBashCommand', () => {
  describe('simple commands', () => {
    it('should parse a simple command', () => {
      const ast = parseBashCommand('ls')
      expect(ast.type).toBe('list')
      expect(ast.pipelines).toHaveLength(1)

      const pipeline = ast.pipelines[0]
      expect(pipeline.commands).toHaveLength(1)

      const cmd = pipeline.commands[0] as CommandNode
      expect(cmd.type).toBe('command')
      expect(cmd.name.value).toBe('ls')
    })

    it('should parse a command with arguments', () => {
      const ast = parseBashCommand('ls -la /tmp')
      const cmd = ast.pipelines[0].commands[0] as CommandNode

      expect(cmd.name.value).toBe('ls')
      expect(cmd.args).toHaveLength(2)
      expect(cmd.args[0].value).toBe('-la')
      expect(cmd.args[1].value).toBe('/tmp')
    })

    it('should parse a command with path', () => {
      const ast = parseBashCommand('/usr/bin/rm -rf /tmp/foo')
      const cmd = ast.pipelines[0].commands[0] as CommandNode

      expect(cmd.name.value).toBe('/usr/bin/rm')
      expect(cmd.args[0].value).toBe('-rf')
    })
  })

  describe('quoted strings', () => {
    it('should parse single-quoted strings', () => {
      const ast = parseBashCommand("echo 'hello world'")
      const cmd = ast.pipelines[0].commands[0] as CommandNode

      expect(cmd.name.value).toBe('echo')
      expect(cmd.args[0].value).toBe('hello world')
    })

    it('should parse double-quoted strings', () => {
      const ast = parseBashCommand('echo "hello world"')
      const cmd = ast.pipelines[0].commands[0] as CommandNode

      expect(cmd.args[0].value).toBe('hello world')
    })

    it('should handle escaped characters in double quotes', () => {
      const ast = parseBashCommand('echo "hello\\"world"')
      const cmd = ast.pipelines[0].commands[0] as CommandNode

      expect(cmd.args[0].value).toBe('hello"world')
    })
  })

  describe('pipelines', () => {
    it('should parse a simple pipeline', () => {
      const ast = parseBashCommand('cat file.txt | grep foo')

      expect(ast.pipelines).toHaveLength(1)
      const pipeline = ast.pipelines[0]
      expect(pipeline.commands).toHaveLength(2)

      const cmd1 = pipeline.commands[0] as CommandNode
      const cmd2 = pipeline.commands[1] as CommandNode

      expect(cmd1.name.value).toBe('cat')
      expect(cmd2.name.value).toBe('grep')
    })

    it('should parse multi-stage pipelines', () => {
      const ast = parseBashCommand('cat file | grep foo | wc -l')

      const pipeline = ast.pipelines[0]
      expect(pipeline.commands).toHaveLength(3)
    })
  })

  describe('command lists', () => {
    it('should parse && operator', () => {
      const ast = parseBashCommand('cd /tmp && ls')

      expect(ast.pipelines).toHaveLength(2)
      expect(ast.operators).toContain('&&')
    })

    it('should parse || operator', () => {
      const ast = parseBashCommand('cd /nonexistent || echo failed')

      expect(ast.pipelines).toHaveLength(2)
      expect(ast.operators).toContain('||')
    })

    it('should parse ; separator', () => {
      const ast = parseBashCommand('echo one; echo two')

      expect(ast.pipelines).toHaveLength(2)
      expect(ast.operators).toContain(';')
    })

    it('should parse complex command lists', () => {
      const ast = parseBashCommand('cd /tmp && ls || echo failed; exit')

      expect(ast.pipelines).toHaveLength(4)
    })
  })

  describe('redirections', () => {
    it('should parse output redirect', () => {
      const ast = parseBashCommand('echo hello > file.txt')
      const cmd = ast.pipelines[0].commands[0] as CommandNode

      expect(cmd.redirects).toHaveLength(1)
      expect(cmd.redirects[0].operator).toBe('>')
      expect(cmd.redirects[0].target.value).toBe('file.txt')
    })

    it('should parse append redirect', () => {
      const ast = parseBashCommand('echo hello >> file.txt')
      const cmd = ast.pipelines[0].commands[0] as CommandNode

      expect(cmd.redirects[0].operator).toBe('>>')
    })

    it('should parse stderr redirect', () => {
      const ast = parseBashCommand('command 2> error.log')
      const cmd = ast.pipelines[0].commands[0] as CommandNode

      expect(cmd.redirects).toHaveLength(1)
      expect(cmd.redirects[0].operator).toBe('>')
    })
  })

  describe('variable expansion', () => {
    it('should identify expandable words', () => {
      const ast = parseBashCommand('echo $HOME')
      const cmd = ast.pipelines[0].commands[0] as CommandNode

      expect(cmd.args[0].expandable).toBe(true)
    })

    it('should handle ${VAR} syntax', () => {
      const ast = parseBashCommand('echo ${HOME}/path')
      const cmd = ast.pipelines[0].commands[0] as CommandNode

      expect(cmd.args[0].expandable).toBe(true)
      expect(cmd.args[0].value).toContain('${HOME}')
    })
  })

  describe('command substitution', () => {
    it('should parse $() substitution', () => {
      const ast = parseBashCommand('echo $(date)')
      const cmd = ast.pipelines[0].commands[0] as CommandNode

      expect(cmd.args[0].value).toContain('$(date)')
    })

    it('should parse backtick substitution', () => {
      const ast = parseBashCommand('echo `date`')
      const cmd = ast.pipelines[0].commands[0] as CommandNode

      expect(cmd.args[0].value).toContain('`date`')
    })
  })

  describe('comments', () => {
    it('should ignore comments', () => {
      const ast = parseBashCommand('ls # this is a comment')
      const cmd = ast.pipelines[0].commands[0] as CommandNode

      expect(cmd.name.value).toBe('ls')
      expect(cmd.args).toHaveLength(0)
    })
  })
})

// ============================================================================
// Safety Analyzer Tests
// ============================================================================

describe('analyzeASTSafety', () => {
  describe('safe commands', () => {
    it('should classify ls as safe', () => {
      const ast = parseBashCommand('ls -la')
      const result = analyzeASTSafety(ast)

      expect(result.dangerous).toBe(false)
      expect(result.impact).toBe('none')
    })

    it('should classify echo as safe', () => {
      const ast = parseBashCommand('echo hello world')
      const result = analyzeASTSafety(ast)

      expect(result.dangerous).toBe(false)
    })

    it('should classify cat as safe', () => {
      const ast = parseBashCommand('cat /etc/hosts')
      const result = analyzeASTSafety(ast)

      expect(result.dangerous).toBe(false)
    })
  })

  describe('dangerous commands', () => {
    it('should detect rm command', () => {
      const ast = parseBashCommand('rm file.txt')
      const result = analyzeASTSafety(ast)

      expect(result.dangerous).toBe(true)
      expect(result.impact).toBe('high')
    })

    it('should detect rm -rf / as critical', () => {
      const ast = parseBashCommand('rm -rf /')
      const result = analyzeASTSafety(ast)

      expect(result.dangerous).toBe(true)
      expect(result.impact).toBe('critical')
    })

    it('should detect rm with wildcard as critical', () => {
      const ast = parseBashCommand('rm -rf *')
      const result = analyzeASTSafety(ast)

      expect(result.dangerous).toBe(true)
      expect(result.impact).toBe('critical')
    })

    it('should detect dd to device', () => {
      const ast = parseBashCommand('dd if=/dev/zero of=/dev/sda')
      const result = analyzeASTSafety(ast)

      expect(result.dangerous).toBe(true)
      expect(result.impact).toBe('critical')
    })

    it('should detect chmod 777', () => {
      const ast = parseBashCommand('chmod 777 /etc/passwd')
      const result = analyzeASTSafety(ast)

      expect(result.dangerous).toBe(true)
    })
  })

  describe('blocked commands', () => {
    it('should detect blocked commands', () => {
      const blocked = new Set(['wget'])
      const ast = parseBashCommand('wget http://example.com')
      const result = analyzeASTSafety(ast, blocked)

      expect(result.dangerous).toBe(true)
      expect(result.issues.some(i => i.type === 'blocked_command')).toBe(true)
    })
  })

  describe('dangerous patterns', () => {
    it('should detect curl piped to bash', () => {
      const ast = parseBashCommand('curl http://example.com | bash')
      const result = analyzeASTSafety(ast)

      expect(result.dangerous).toBe(true)
      expect(result.safetyLevel).toBe('critical')
      expect(result.issues.some(i => i.type === 'critical_pattern' && i.critical === true)).toBe(true)
    })

    it('should detect wget piped to sh', () => {
      const ast = parseBashCommand('wget http://example.com | sh')
      const result = analyzeASTSafety(ast)

      expect(result.dangerous).toBe(true)
    })

    it('should detect fork bomb', () => {
      const input = ':(){ :|:& };:'
      const result = parseAndAnalyze(input)

      expect(result.dangerous).toBe(true)
    })
  })

  describe('dangerous redirects', () => {
    it('should detect redirect to device', () => {
      const ast = parseBashCommand('echo foo > /dev/sda')
      const result = analyzeASTSafety(ast)

      expect(result.dangerous).toBe(true)
    })
  })

  describe('command extraction', () => {
    it('should extract all commands from pipeline', () => {
      const ast = parseBashCommand('cat file | grep foo | wc -l')
      const result = analyzeASTSafety(ast)

      expect(result.commands).toContain('cat')
      expect(result.commands).toContain('grep')
      expect(result.commands).toContain('wc')
    })

    it('should extract commands from command list', () => {
      const ast = parseBashCommand('cd /tmp && ls && echo done')
      const result = analyzeASTSafety(ast)

      expect(result.commands).toContain('cd')
      expect(result.commands).toContain('ls')
      expect(result.commands).toContain('echo')
    })

    it('should extract base command from path', () => {
      const ast = parseBashCommand('/usr/bin/rm file.txt')
      const result = analyzeASTSafety(ast)

      expect(result.commands).toContain('rm')
    })
  })

  describe('impact levels', () => {
    it('should classify mkdir as low impact', () => {
      const ast = parseBashCommand('mkdir /tmp/test')
      const result = analyzeASTSafety(ast)

      expect(result.impact).toBe('low')
    })

    it('should classify mv as medium impact', () => {
      const ast = parseBashCommand('mv file1 file2')
      const result = analyzeASTSafety(ast)

      expect(result.impact).toBe('medium')
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('parseAndAnalyze', () => {
  it('should parse and analyze in one call', () => {
    const result = parseAndAnalyze('ls -la')

    expect(result.dangerous).toBe(false)
    expect(result.commands).toContain('ls')
  })

  it('should detect dangerous commands', () => {
    const result = parseAndAnalyze('rm -rf /')

    expect(result.dangerous).toBe(true)
    expect(result.impact).toBe('critical')
  })

  it('should respect blocked commands', () => {
    const blocked = new Set(['cat'])
    const result = parseAndAnalyze('cat /etc/passwd', blocked)

    expect(result.dangerous).toBe(true)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('should handle empty input', () => {
    const ast = parseBashCommand('')
    expect(ast.pipelines).toHaveLength(0)
  })

  it('should handle whitespace-only input', () => {
    const ast = parseBashCommand('   ')
    expect(ast.pipelines).toHaveLength(0)
  })

  it('should handle newlines', () => {
    const ast = parseBashCommand('ls\necho hello')
    expect(ast.pipelines.length).toBeGreaterThanOrEqual(1)
  })

  it('should handle complex nested commands', () => {
    const result = parseAndAnalyze('git status && npm install && npm run build')
    expect(result.commands).toContain('git')
    expect(result.commands).toContain('npm')
  })
})

// ============================================================================
// Safety Level Classification Tests
// ============================================================================

describe('safetyLevel classification', () => {
  describe('critical commands', () => {
    it('should classify rm -rf / as critical', () => {
      const result = parseAndAnalyze('rm -rf /')
      expect(result.safetyLevel).toBe('critical')
      expect(result.dangerous).toBe(true)
    })

    it('should classify rm -rf /* as critical', () => {
      const result = parseAndAnalyze('rm -rf /*')
      expect(result.safetyLevel).toBe('critical')
      expect(result.dangerous).toBe(true)
    })

    it('should classify rm --no-preserve-root as critical', () => {
      const result = parseAndAnalyze('rm -rf --no-preserve-root /')
      expect(result.safetyLevel).toBe('critical')
      expect(result.dangerous).toBe(true)
    })

    it('should classify fork bomb as critical', () => {
      const result = parseAndAnalyze(':(){ :|:& };:')
      expect(result.safetyLevel).toBe('critical')
      expect(result.dangerous).toBe(true)
    })

    it('should classify curl piped to bash as critical', () => {
      const result = parseAndAnalyze('curl http://example.com | bash')
      expect(result.safetyLevel).toBe('critical')
      expect(result.dangerous).toBe(true)
    })

    it('should classify wget piped to sh as critical', () => {
      const result = parseAndAnalyze('wget http://example.com | sh')
      expect(result.safetyLevel).toBe('critical')
      expect(result.dangerous).toBe(true)
    })

    it('should classify dd to disk device as critical', () => {
      const result = parseAndAnalyze('dd if=/dev/zero of=/dev/sda')
      expect(result.safetyLevel).toBe('critical')
      expect(result.dangerous).toBe(true)
    })

    it('should have critical=true on issues for critical commands', () => {
      const result = parseAndAnalyze('rm -rf /')
      expect(result.issues.some(i => i.critical === true)).toBe(true)
    })
  })

  describe('dangerous commands (not critical)', () => {
    it('should classify rm -rf /tmp as dangerous', () => {
      const result = parseAndAnalyze('rm -rf /tmp')
      expect(result.safetyLevel).toBe('dangerous')
      expect(result.dangerous).toBe(true)
    })

    it('should classify rm command as dangerous', () => {
      const result = parseAndAnalyze('rm file.txt')
      expect(result.safetyLevel).toBe('dangerous')
      expect(result.dangerous).toBe(true)
    })

    it('should classify chmod 777 as dangerous', () => {
      const result = parseAndAnalyze('chmod 777 file.txt')
      expect(result.safetyLevel).toBe('dangerous')
      expect(result.dangerous).toBe(true)
    })

    it('should not have critical=true on issues for dangerous (non-critical) commands', () => {
      const result = parseAndAnalyze('rm file.txt')
      expect(result.issues.some(i => i.critical === true)).toBe(false)
    })
  })

  describe('safe commands', () => {
    it('should classify ls as safe', () => {
      const result = parseAndAnalyze('ls -la')
      expect(result.safetyLevel).toBe('safe')
      expect(result.dangerous).toBe(false)
    })

    it('should classify cat as safe', () => {
      const result = parseAndAnalyze('cat file.txt')
      expect(result.safetyLevel).toBe('safe')
      expect(result.dangerous).toBe(false)
    })

    it('should classify echo as safe', () => {
      const result = parseAndAnalyze('echo hello')
      expect(result.safetyLevel).toBe('safe')
      expect(result.dangerous).toBe(false)
    })

    it('should classify git commands as safe', () => {
      const result = parseAndAnalyze('git status')
      expect(result.safetyLevel).toBe('safe')
      expect(result.dangerous).toBe(false)
    })
  })
})
