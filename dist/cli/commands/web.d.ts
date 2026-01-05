/**
 * @fileoverview Git Web Command - Shareable Diff Preview URLs
 *
 * This module implements the `gitx web` command which generates shareable
 * HTML previews of diffs. Features include:
 * - Converting diff output to styled HTML with syntax highlighting
 * - Uploading to a preview service and returning a shareable URL
 * - Configurable expiration times (minutes, hours, days)
 * - Progress callbacks for upload status
 * - ANSI escape code to HTML conversion for terminal output
 *
 * @module cli/commands/web
 *
 * @example
 * // Generate HTML from diff
 * const html = await generateHTML(diffResult)
 *
 * @example
 * // Upload and get shareable URL
 * const result = await uploadPreview(html, { expires: '24h' })
 * console.log(`Share this URL: ${result.url}`)
 * console.log(`Expires: ${result.expiresAt}`)
 */
import type { CommandContext } from '../index';
import type { DiffResult } from './diff';
/**
 * Options for the web command.
 *
 * @description Configuration options controlling the upload behavior,
 * expiration, and progress tracking.
 *
 * @property expires - Expiration duration (e.g., '30m', '1h', '7d')
 * @property open - Open URL in default browser after upload
 * @property endpoint - Custom upload endpoint URL
 * @property timeout - Upload timeout in milliseconds
 * @property onProgress - Callback for upload progress updates
 */
export interface WebOptions {
    /** Expiration time for the preview (e.g., '1h', '24h', '7d') */
    expires?: string;
    /** Open the URL in browser after upload */
    open?: boolean;
    /** Custom upload endpoint */
    endpoint?: string;
    /** Upload timeout in milliseconds */
    timeout?: number;
    /** Progress callback */
    onProgress?: ProgressCallback;
}
/**
 * Result of the web command.
 *
 * @description Contains the shareable URL and expiration information
 * returned after a successful upload.
 *
 * @property url - The shareable preview URL
 * @property expiresAt - When the preview will expire
 * @property openedInBrowser - Whether the browser was opened to the URL
 */
export interface WebResult {
    /** The shareable URL */
    url: string;
    /** When the preview expires */
    expiresAt: Date | string;
    /** Whether browser was opened */
    openedInBrowser?: boolean;
}
/**
 * Result of an upload operation.
 *
 * @description Contains the URL, expiration, and unique ID for the
 * uploaded preview content.
 *
 * @property url - The shareable preview URL
 * @property expiresAt - When the preview will expire (Date or ISO string)
 * @property id - Unique identifier for the upload
 */
export interface UploadResult {
    /** The shareable URL */
    url: string;
    /** When the preview expires */
    expiresAt: Date | string;
    /** Unique ID of the upload */
    id: string;
}
/**
 * Callback for upload progress updates.
 *
 * @description Called during upload with progress percentage (0-100).
 *
 * @param progress - Upload progress as percentage (0-100)
 */
export type ProgressCallback = (progress: number) => void;
/**
 * Execute the web command from the CLI.
 *
 * @description Main entry point for the `gitx web` command. Gets the current
 * diff, converts it to HTML, uploads it, and returns the shareable URL.
 *
 * @param ctx - Command context with cwd, options, and output functions
 * @returns Promise resolving to web result with URL and expiration
 * @throws {Error} If upload fails
 *
 * @example
 * // CLI usage
 * // gitx web                     - Upload current diff with 24h expiry
 * // gitx web --expires 7d        - Upload with 7 day expiry
 * // gitx web --open              - Upload and open in browser
 */
export declare function webCommand(ctx: CommandContext): Promise<WebResult>;
/**
 * Generate HTML document from diff result.
 *
 * @description Converts a diff result into a styled HTML document ready
 * for viewing in a browser. Delegates to generateStandaloneHTML.
 *
 * @param diff - Diff result with entries and stats
 * @returns Promise resolving to complete HTML document string
 *
 * @example
 * const html = await generateHTML(diffResult)
 * // Returns full HTML document with CSS and navigation
 */
export declare function generateHTML(diff: DiffResult): Promise<string>;
/**
 * Generate standalone HTML with no external dependencies.
 *
 * @description Creates a complete HTML document with inline CSS that can be
 * viewed without any external resources. Includes:
 * - GitHub-style dark theme styling
 * - File navigation sidebar
 * - Syntax-highlighted diff content
 * - Summary statistics
 *
 * @param diff - Diff result with entries and stats
 * @returns Promise resolving to complete HTML document string
 *
 * @example
 * const html = await generateStandaloneHTML(diffResult)
 * await fs.writeFile('preview.html', html)
 * // Open preview.html in browser - works offline
 */
export declare function generateStandaloneHTML(diff: DiffResult): Promise<string>;
/**
 * Convert ANSI escape codes to HTML spans with appropriate classes.
 *
 * @description Parses ANSI escape sequences (color codes) in terminal output
 * and converts them to HTML `<span>` elements with CSS classes for styling.
 * Supports:
 * - Basic 16 ANSI colors (30-37, 90-97)
 * - 256-color mode (38;5;N)
 * - 24-bit RGB color (38;2;R;G;B)
 * - Reset code (0)
 *
 * @param ansiText - Text containing ANSI escape sequences
 * @returns HTML string with escape sequences converted to spans
 *
 * @example
 * const html = convertAnsiToHTML('\x1b[32mgreen text\x1b[0m')
 * // '<span class="ansi-green ansi-addition">green text</span>'
 */
export declare function convertAnsiToHTML(ansiText: string): string;
/**
 * Upload HTML preview and return shareable URL.
 *
 * @description Uploads the HTML content to a preview service and returns
 * a shareable URL. Supports custom endpoints, timeouts, and progress tracking.
 *
 * If no endpoint is provided, returns a mock URL for local/testing use.
 *
 * @param html - HTML content to upload
 * @param options - Upload options (expires, endpoint, timeout, onProgress)
 * @returns Promise resolving to upload result with URL and expiration
 * @throws {Error} If request times out
 * @throws {Error} If server returns an error (5xx)
 * @throws {Error} If authentication fails (401, 403)
 * @throws {Error} If network error occurs
 *
 * @example
 * // Basic upload with default expiration (24h)
 * const result = await uploadPreview(html)
 * console.log(result.url)
 *
 * @example
 * // Upload with custom options
 * const result = await uploadPreview(html, {
 *   expires: '7d',
 *   timeout: 30000,
 *   onProgress: (p) => console.log(`${p}% uploaded`)
 * })
 *
 * @example
 * // Upload to custom endpoint
 * const result = await uploadPreview(html, {
 *   endpoint: 'https://my-server.com/upload'
 * })
 */
export declare function uploadPreview(html: string, options?: WebOptions): Promise<UploadResult>;
//# sourceMappingURL=web.d.ts.map