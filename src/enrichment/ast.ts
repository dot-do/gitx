/**
 * Optional AST extraction for code-as-data enrichment.
 * Currently provides stub implementations; real parsers will be added later.
 */

/** Represents a node in an abstract syntax tree */
export interface AstNode {
  type: string
  name?: string
  start: number
  end: number
  children?: AstNode[]
}

/** Languages that will eventually support AST extraction */
export const SUPPORTED_LANGUAGES = new Set(['JavaScript', 'TypeScript', 'MDX'])

/**
 * Extract AST nodes from source content.
 * Currently a stub that returns null for all inputs.
 * Future work will integrate actual parsers for JS/TS/MDX.
 *
 * @param content Source code content
 * @param language Language name (as returned by detectLanguage)
 * @returns Array of AST nodes, or null if not supported / not yet implemented
 */
export function extractAst(content: string, language: string): AstNode[] | null {
  // Stub: even for supported languages, return null until parsers are integrated
  void content
  void language
  return null
}
