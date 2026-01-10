/**
 * @fileoverview Bash AST Parser and Safety Analyzer
 *
 * This module provides a bash command parser that produces an Abstract Syntax Tree (AST)
 * for shell commands, along with safety analysis based on AST node inspection.
 *
 * The parser handles:
 * - Simple commands (ls, cat, etc.)
 * - Pipelines (cmd1 | cmd2)
 * - Command lists (cmd1 && cmd2, cmd1 || cmd2, cmd1 ; cmd2)
 * - Subshells ($(...) and `...`)
 * - Redirections (>, >>, <, 2>&1)
 * - Variable expansion ($VAR, ${VAR})
 * - Quoting (single, double, and escape)
 *
 * @module do/bash-ast
 *
 * @example
 * ```typescript
 * import { parseBashCommand, analyzeASTSafety } from './bash-ast'
 *
 * const ast = parseBashCommand('rm -rf /')
 * const safety = analyzeASTSafety(ast)
 * if (safety.dangerous) {
 *   console.log(`Command blocked: ${safety.reason}`)
 * }
 * ```
 */
/**
 * Type of AST node.
 */
export type ASTNodeType = 'command' | 'pipeline' | 'list' | 'subshell' | 'function' | 'word' | 'redirect' | 'assignment';
/**
 * Operator types for command lists.
 */
export type ListOperator = '&&' | '||' | ';' | '&';
/**
 * Redirection type.
 */
export type RedirectType = '>' | '>>' | '<' | '2>' | '2>>' | '&>' | '>&' | '<<' | '<<<';
/**
 * Base AST node interface.
 */
export interface ASTNodeBase {
    type: ASTNodeType;
    raw: string;
    start: number;
    end: number;
}
/**
 * Word node - represents a simple word or argument.
 */
export interface WordNode extends ASTNodeBase {
    type: 'word';
    value: string;
    quoted: 'none' | 'single' | 'double' | 'escaped';
    expandable: boolean;
}
/**
 * Redirect node - represents I/O redirection.
 */
export interface RedirectNode extends ASTNodeBase {
    type: 'redirect';
    operator: RedirectType;
    target: WordNode;
    fd?: number;
}
/**
 * Assignment node - represents variable assignment.
 */
export interface AssignmentNode extends ASTNodeBase {
    type: 'assignment';
    name: string;
    value: WordNode;
}
/**
 * Command node - represents a simple command.
 */
export interface CommandNode extends ASTNodeBase {
    type: 'command';
    name: WordNode;
    args: WordNode[];
    redirects: RedirectNode[];
    assignments: AssignmentNode[];
    background: boolean;
}
/**
 * Pipeline node - represents a pipeline of commands.
 */
export interface PipelineNode extends ASTNodeBase {
    type: 'pipeline';
    commands: (CommandNode | SubshellNode)[];
    negated: boolean;
}
/**
 * List node - represents a list of pipelines.
 */
export interface ListNode extends ASTNodeBase {
    type: 'list';
    pipelines: PipelineNode[];
    operators: ListOperator[];
}
/**
 * Subshell node - represents a subshell.
 */
export interface SubshellNode extends ASTNodeBase {
    type: 'subshell';
    body: ListNode;
    style: '$()' | '``' | '()';
}
/**
 * Function definition node.
 */
export interface FunctionNode extends ASTNodeBase {
    type: 'function';
    name: string;
    body: ListNode;
}
/**
 * Union of all AST node types.
 */
export type ASTNode = WordNode | RedirectNode | AssignmentNode | CommandNode | PipelineNode | ListNode | SubshellNode | FunctionNode;
/**
 * Impact level of a command.
 */
export type ImpactLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';
/**
 * Safety level classification for commands.
 * - 'safe': Command can be executed without confirmation
 * - 'dangerous': Command requires confirmation but can be executed with confirm flag
 * - 'critical': Command is ALWAYS blocked regardless of confirmation (destructive/irreversible)
 */
export type SafetyLevel = 'safe' | 'dangerous' | 'critical';
/**
 * Safety classification result from AST analysis.
 */
export interface ASTSafetyAnalysis {
    /**
     * Whether the command is considered dangerous.
     */
    dangerous: boolean;
    /**
     * Safety classification level.
     * - 'safe': Can execute without confirmation
     * - 'dangerous': Requires confirmation (confirm flag allows execution)
     * - 'critical': Always blocked, cannot be executed even with confirmation
     */
    safetyLevel: SafetyLevel;
    /**
     * Reason for the classification.
     */
    reason?: string;
    /**
     * All command names found in the AST.
     */
    commands: string[];
    /**
     * Impact level of the command.
     */
    impact: ImpactLevel;
    /**
     * Detailed issues found during analysis.
     */
    issues: SafetyIssue[];
    /**
     * The parsed AST (for debugging/inspection).
     */
    ast?: ASTNode;
}
/**
 * A single safety issue found during analysis.
 */
export interface SafetyIssue {
    /**
     * Type of safety issue.
     */
    type: 'dangerous_command' | 'dangerous_pattern' | 'blocked_command' | 'privilege_escalation' | 'data_destruction' | 'network_exfil' | 'code_injection' | 'critical_pattern';
    /**
     * Description of the issue.
     */
    message: string;
    /**
     * Severity of the issue.
     */
    severity: ImpactLevel;
    /**
     * Whether this issue represents a critical command that cannot be executed even with confirmation.
     * When true, the command will be blocked regardless of the confirm flag.
     */
    critical?: boolean;
    /**
     * Location in the original command.
     */
    start?: number;
    end?: number;
}
/**
 * Parse a bash command string into an AST.
 *
 * @param input - The bash command string to parse
 * @returns The parsed AST (ListNode at the top level)
 *
 * @example
 * ```typescript
 * const ast = parseBashCommand('ls -la | grep foo && echo done')
 * // Returns a ListNode with two pipelines
 * ```
 */
export declare function parseBashCommand(input: string): ListNode;
/**
 * Analyze a bash command AST for safety.
 *
 * @param ast - The parsed AST to analyze
 * @param blockedCommands - Set of commands that are blocked
 * @param originalInput - Original input string for pattern matching
 * @returns Safety analysis result
 *
 * @example
 * ```typescript
 * const ast = parseBashCommand('rm -rf /')
 * const safety = analyzeASTSafety(ast)
 * if (safety.dangerous) {
 *   console.log(`Blocked: ${safety.reason}`)
 * }
 * ```
 */
export declare function analyzeASTSafety(ast: ListNode, blockedCommands?: Set<string>, originalInput?: string): ASTSafetyAnalysis;
/**
 * Parse and analyze a bash command string for safety.
 *
 * This is a convenience function that combines parsing and analysis.
 *
 * @param input - The bash command string to analyze
 * @param blockedCommands - Set of commands that are blocked
 * @returns Safety analysis result
 *
 * @example
 * ```typescript
 * const result = parseAndAnalyze('rm -rf /')
 * if (result.dangerous) {
 *   console.log(`Command blocked: ${result.reason}`)
 * }
 * ```
 */
export declare function parseAndAnalyze(input: string, blockedCommands?: Set<string>): ASTSafetyAnalysis;
//# sourceMappingURL=bash-ast.d.ts.map