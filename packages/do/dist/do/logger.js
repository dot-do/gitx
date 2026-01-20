/**
 * @fileoverview Logging infrastructure for GitRepoDO.
 *
 * Provides structured logging with configurable levels and output.
 *
 * @module do/logger
 */
import { LogLevel } from './types';
/**
 * Default log handler that outputs to console.
 */
function defaultLogHandler(entry) {
    const timestamp = new Date(entry.timestamp).toISOString();
    const contextStr = entry.context
        ? ` ${JSON.stringify(entry.context)}`
        : '';
    switch (entry.level) {
        case LogLevel.DEBUG:
            console.debug(`[${timestamp}] DEBUG: ${entry.message}${contextStr}`);
            break;
        case LogLevel.INFO:
            console.info(`[${timestamp}] INFO: ${entry.message}${contextStr}`);
            break;
        case LogLevel.WARN:
            console.warn(`[${timestamp}] WARN: ${entry.message}${contextStr}`);
            break;
        case LogLevel.ERROR:
            console.error(`[${timestamp}] ERROR: ${entry.message}${contextStr}`);
            break;
    }
}
/**
 * Log level priority for comparison.
 */
const LOG_LEVEL_PRIORITY = {
    [LogLevel.DEBUG]: 0,
    [LogLevel.INFO]: 1,
    [LogLevel.WARN]: 2,
    [LogLevel.ERROR]: 3,
};
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
export function createLogger(options = {}) {
    const { minLevel = LogLevel.INFO, ns, $type, handler = defaultLogHandler, } = options;
    const baseContext = {
        ...(ns && { ns }),
        ...($type && { $type }),
    };
    function shouldLog(level) {
        return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel];
    }
    function log(level, message, context) {
        if (!shouldLog(level))
            return;
        const entry = {
            level,
            message,
            timestamp: Date.now(),
            context: context ? { ...baseContext, ...context } : baseContext,
        };
        handler(entry);
    }
    return {
        debug(message, context) {
            log(LogLevel.DEBUG, message, context);
        },
        info(message, context) {
            log(LogLevel.INFO, message, context);
        },
        warn(message, context) {
            log(LogLevel.WARN, message, context);
        },
        error(message, context) {
            log(LogLevel.ERROR, message, context);
        },
    };
}
/**
 * Create a child logger with additional context.
 *
 * @param parent - Parent logger
 * @param context - Additional context to include in all log entries
 * @returns Child logger instance
 */
export function createChildLogger(parent, context) {
    return {
        debug(message, childContext) {
            parent.debug(message, { ...context, ...childContext });
        },
        info(message, childContext) {
            parent.info(message, { ...context, ...childContext });
        },
        warn(message, childContext) {
            parent.warn(message, { ...context, ...childContext });
        },
        error(message, childContext) {
            parent.error(message, { ...context, ...childContext });
        },
    };
}
/**
 * No-op logger that discards all messages.
 * Useful for testing or when logging is disabled.
 */
export const noopLogger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
};
export { LogLevel };
//# sourceMappingURL=logger.js.map