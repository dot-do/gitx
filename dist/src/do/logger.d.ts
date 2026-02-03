/**
 * @fileoverview Logging infrastructure for GitRepoDO.
 *
 * Provides structured logging with configurable levels and output.
 *
 * @module do/logger
 */
import { Logger, LogLevel, LogEntry, type LogContext } from './types';
/**
 * Options for creating a logger.
 */
export interface LoggerOptions {
    /** Minimum log level to output */
    minLevel?: LogLevel;
    /** DO namespace for context */
    ns?: string;
    /** DO type for context */
    $type?: string;
    /** Custom log handler */
    handler?: (entry: LogEntry) => void;
}
/**
 * Create a logger instance.
 *
 * @param options - Logger configuration options
 * @returns Logger instance
 *
 * @example
 * ```typescript
 * const logger = createLogger({ minLevel: LogLevel.INFO, ns: 'my-repo' })
 * logger.info('Repository initialized', { branch: 'main' })
 * ```
 */
export declare function createLogger(options?: LoggerOptions): Logger;
/**
 * Create a child logger with additional context.
 *
 * @param parent - Parent logger
 * @param context - Additional context to include in all log entries
 * @returns Child logger instance
 */
export declare function createChildLogger(parent: Logger, context: LogContext): Logger;
/**
 * No-op logger that discards all messages.
 * Useful for testing or when logging is disabled.
 */
export declare const NOOP_LOGGER: Logger;
/**
 * @deprecated Use NOOP_LOGGER instead. This alias is provided for backward compatibility.
 */
export declare const noopLogger: Logger<LogContext>;
export { Logger, LogLevel, LogEntry };
//# sourceMappingURL=logger.d.ts.map