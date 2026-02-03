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
// ============================================================================
// Types
// ============================================================================
/**
 * Log levels in order of severity.
 */
export var LogLevel;
(function (LogLevel) {
    LogLevel["DEBUG"] = "debug";
    LogLevel["INFO"] = "info";
    LogLevel["WARN"] = "warn";
    LogLevel["ERROR"] = "error";
})(LogLevel || (LogLevel = {}));
/**
 * Priority mapping for log level filtering.
 */
const LOG_LEVEL_PRIORITY = {
    [LogLevel.DEBUG]: 0,
    [LogLevel.INFO]: 1,
    [LogLevel.WARN]: 2,
    [LogLevel.ERROR]: 3,
};
// ============================================================================
// Default Log Handler
// ============================================================================
/**
 * Default log handler that outputs structured JSON to console.
 * In production environments, this is typically collected by logging infrastructure.
 */
function defaultHandler(entry) {
    // Output as JSON for structured logging systems
    const output = JSON.stringify(entry);
    switch (entry.level) {
        case LogLevel.DEBUG:
            console.debug(output);
            break;
        case LogLevel.INFO:
            console.info(output);
            break;
        case LogLevel.WARN:
            console.warn(output);
            break;
        case LogLevel.ERROR:
            console.error(output);
            break;
    }
}
// ============================================================================
// Logger Implementation
// ============================================================================
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
export function createLogger(options = {}) {
    const { component, minLevel = LogLevel.INFO, context = {}, handler = defaultHandler, } = options;
    function shouldLog(level) {
        return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel];
    }
    function log(level, message, error, data) {
        if (!shouldLog(level))
            return;
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            message,
        };
        if (component) {
            entry.component = component;
        }
        if (error) {
            entry.error = {
                name: error.name,
                message: error.message,
                ...(error.stack !== undefined && { stack: error.stack }),
            };
        }
        // Merge context and data
        const mergedData = { ...context, ...data };
        if (Object.keys(mergedData).length > 0) {
            entry.data = mergedData;
        }
        handler(entry);
    }
    const logger = {
        debug(message, data) {
            log(LogLevel.DEBUG, message, undefined, data);
        },
        info(message, data) {
            log(LogLevel.INFO, message, undefined, data);
        },
        warn(message, data) {
            log(LogLevel.WARN, message, undefined, data);
        },
        error(message, error, data) {
            log(LogLevel.ERROR, message, error, data);
        },
        child(childContext) {
            return createLogger({
                ...(component !== undefined && { component }),
                minLevel,
                context: { ...context, ...childContext },
                handler,
            });
        },
    };
    return logger;
}
// ============================================================================
// Pre-configured Loggers
// ============================================================================
/**
 * No-op logger that discards all messages.
 * Useful for testing or when logging is explicitly disabled.
 */
export const noopLogger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
    child: () => noopLogger,
};
/**
 * Default logger instance for quick usage.
 * Use createLogger() for customized logging.
 */
export const defaultLogger = createLogger();
// ============================================================================
// Wire Protocol Logger
// ============================================================================
/**
 * Pre-configured logger for wire protocol operations.
 * Used by wire-routes.ts, receive-pack.ts, and upload-pack.ts.
 */
export const wireLogger = createLogger({
    component: 'wire-protocol',
    minLevel: LogLevel.INFO,
});
//# sourceMappingURL=logger.js.map