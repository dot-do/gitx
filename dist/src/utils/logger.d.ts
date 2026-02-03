/**
 * @fileoverview Structured logging utility for GitX.
 *
 * Provides a lightweight structured logging abstraction that outputs JSON-friendly
 * log entries. This logger is designed to work in Cloudflare Workers and other
 * environments without Node.js dependencies.
 *
 * @module utils/logger
 *
 * @example Basic usage
 * ```typescript
 * import { createLogger, LogLevel } from './utils/logger'
 *
 * const logger = createLogger({ component: 'wire-protocol' })
 * logger.info('Request received', { method: 'POST', path: '/git-receive-pack' })
 * logger.error('Failed to process request', new Error('Invalid packfile'), { size: 1024 })
 * ```
 *
 * @example Creating child loggers with additional context
 * ```typescript
 * const requestLogger = logger.child({ requestId: 'abc-123', namespace: 'my-repo' })
 * requestLogger.debug('Processing refs')  // Includes requestId and namespace
 * ```
 */
/**
 * Log levels in order of severity.
 */
export declare enum LogLevel {
    DEBUG = "debug",
    INFO = "info",
    WARN = "warn",
    ERROR = "error"
}
/**
 * Structured log entry that will be serialized to JSON.
 */
export interface LogEntry {
    /** ISO-8601 timestamp */
    timestamp: string;
    /** Log level */
    level: LogLevel;
    /** Log message */
    message: string;
    /** Component or module name */
    component?: string;
    /** Error information if present */
    error?: {
        name: string;
        message: string;
        stack?: string;
    };
    /** Additional structured data */
    data?: Record<string, unknown>;
}
/**
 * Logger interface supporting structured logging.
 */
export interface Logger {
    /**
     * Log a debug message. Used for detailed diagnostic information.
     * @param message - Log message
     * @param data - Optional structured data
     */
    debug(message: string, data?: Record<string, unknown>): void;
    /**
     * Log an informational message. Used for notable events.
     * @param message - Log message
     * @param data - Optional structured data
     */
    info(message: string, data?: Record<string, unknown>): void;
    /**
     * Log a warning message. Used for potentially problematic situations.
     * @param message - Log message
     * @param data - Optional structured data
     */
    warn(message: string, data?: Record<string, unknown>): void;
    /**
     * Log an error message with optional error object.
     * @param message - Log message
     * @param error - Optional Error object
     * @param data - Optional structured data
     */
    error(message: string, error?: Error, data?: Record<string, unknown>): void;
    /**
     * Create a child logger with additional context.
     * @param context - Context to add to all log entries from child logger
     */
    child(context: Record<string, unknown>): Logger;
}
/**
 * Options for creating a logger.
 */
export interface LoggerOptions {
    /** Component or module name */
    component?: string;
    /** Minimum log level to output (default: INFO, DEBUG in development) */
    minLevel?: LogLevel;
    /** Additional context to include in all log entries */
    context?: Record<string, unknown>;
    /** Custom log handler (defaults to console output) */
    handler?: (entry: LogEntry) => void;
}
/**
 * Create a structured logger instance.
 *
 * @param options - Logger configuration options
 * @returns Logger instance
 *
 * @example
 * ```typescript
 * const logger = createLogger({
 *   component: 'receive-pack',
 *   minLevel: LogLevel.DEBUG,
 *   context: { service: 'gitx' }
 * })
 *
 * logger.info('Processing push', { refs: 3, packSize: 1024 })
 * logger.error('Push failed', new Error('Invalid ref'), { refName: 'refs/heads/main' })
 * ```
 */
export declare function createLogger(options?: LoggerOptions): Logger;
/**
 * No-op logger that discards all messages.
 * Useful for testing or when logging is explicitly disabled.
 */
export declare const noopLogger: Logger;
/**
 * Default logger instance for quick usage.
 * Use createLogger() for customized logging.
 */
export declare const defaultLogger: Logger;
/**
 * Pre-configured logger for wire protocol operations.
 * Used by wire-routes.ts, receive-pack.ts, and upload-pack.ts.
 */
export declare const wireLogger: Logger;
//# sourceMappingURL=logger.d.ts.map