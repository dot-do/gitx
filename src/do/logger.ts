/**
 * @fileoverview Logging infrastructure for GitRepoDO.
 *
 * Provides structured logging with configurable levels and output.
 *
 * @module do/logger
 */

import { Logger, LogLevel, LogEntry } from './types'

// ============================================================================
// Logger Implementation
// ============================================================================

/**
 * Options for creating a logger.
 */
export interface LoggerOptions {
  /** Minimum log level to output */
  minLevel?: LogLevel
  /** DO namespace for context */
  ns?: string
  /** DO type for context */
  $type?: string
  /** Custom log handler */
  handler?: (entry: LogEntry) => void
}

/**
 * Default log handler that outputs to console.
 */
function defaultLogHandler(entry: LogEntry): void {
  const timestamp = new Date(entry.timestamp).toISOString()
  const contextStr = entry.context
    ? ` ${JSON.stringify(entry.context)}`
    : ''

  switch (entry.level) {
    case LogLevel.DEBUG:
      console.debug(`[${timestamp}] DEBUG: ${entry.message}${contextStr}`)
      break
    case LogLevel.INFO:
      console.info(`[${timestamp}] INFO: ${entry.message}${contextStr}`)
      break
    case LogLevel.WARN:
      console.warn(`[${timestamp}] WARN: ${entry.message}${contextStr}`)
      break
    case LogLevel.ERROR:
      console.error(`[${timestamp}] ERROR: ${entry.message}${contextStr}`)
      break
  }
}

/**
 * Log level priority for comparison.
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3,
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
export function createLogger(options: LoggerOptions = {}): Logger {
  const {
    minLevel = LogLevel.INFO,
    ns,
    $type,
    handler = defaultLogHandler,
  } = options

  const baseContext = {
    ...(ns && { ns }),
    ...($type && { $type }),
  }

  function shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel]
  }

  function log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>
  ): void {
    if (!shouldLog(level)) return

    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      context: context ? { ...baseContext, ...context } : baseContext,
    }

    handler(entry)
  }

  return {
    debug(message: string, context?: Record<string, unknown>): void {
      log(LogLevel.DEBUG, message, context)
    },

    info(message: string, context?: Record<string, unknown>): void {
      log(LogLevel.INFO, message, context)
    },

    warn(message: string, context?: Record<string, unknown>): void {
      log(LogLevel.WARN, message, context)
    },

    error(message: string, context?: Record<string, unknown>): void {
      log(LogLevel.ERROR, message, context)
    },
  }
}

/**
 * Create a child logger with additional context.
 *
 * @param parent - Parent logger
 * @param context - Additional context to include in all log entries
 * @returns Child logger instance
 */
export function createChildLogger(
  parent: Logger,
  context: Record<string, unknown>
): Logger {
  return {
    debug(message: string, childContext?: Record<string, unknown>): void {
      parent.debug(message, { ...context, ...childContext })
    },

    info(message: string, childContext?: Record<string, unknown>): void {
      parent.info(message, { ...context, ...childContext })
    },

    warn(message: string, childContext?: Record<string, unknown>): void {
      parent.warn(message, { ...context, ...childContext })
    },

    error(message: string, childContext?: Record<string, unknown>): void {
      parent.error(message, { ...context, ...childContext })
    },
  }
}

/**
 * No-op logger that discards all messages.
 * Useful for testing or when logging is disabled.
 */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

// Re-export types
export { Logger, LogLevel, LogEntry }
