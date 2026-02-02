/**
 * File extension to programming language mapping.
 * Used for code-as-data enrichment to tag blobs with their language.
 */
/** Map of file extension (without dot, lowercase) to language name */
export declare const LANGUAGES: Record<string, string>;
/**
 * Map of dotfile names (lowercase, without leading dot) to language name.
 * Used for files that start with a dot but have no extension.
 */
export declare const DOTFILES: Record<string, string>;
/**
 * Detect the programming language of a file based on its path/extension.
 * Handles regular files, dotfiles (e.g., .bashrc), and dotfiles with extensions (e.g., .eslintrc.json).
 * @param path File path or filename
 * @returns Language name or null if unknown
 */
export declare function detectLanguage(path: string): string | null;
//# sourceMappingURL=language.d.ts.map