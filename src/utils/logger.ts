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
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/**
 * Priority mapping for log level filtering.
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3,
}

/**
 * Structured log entry that will be serialized to JSON.
 */
export interface LogEntry {
  /** ISO-8601 timestamp */
  timestamp: string
  /** Log level */
  level: LogLevel
  /** Log message */
  message: string
  /** Component or module name */
  component?: string
  /** Error information if present */
  error?: {
    name: string
    message: string
    stack?: string
  }
  /** Additional structured data */
  data?: Record<string, unknown>
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
  debug(message: string, data?: Record<string, unknown>): void

  /**
   * Log an informational message. Used for notable events.
   * @param message - Log message
   * @param data - Optional structured data
   */
  info(message: string, data?: Record<string, unknown>): void

  /**
   * Log a warning message. Used for potentially problematic situations.
   * @param message - Log message
   * @param data - Optional structured data
   */
  warn(message: string, data?: Record<string, unknown>): void

  /**
   * Log an error message with optional error object.
   * @param message - Log message
   * @param error - Optional Error object
   * @param data - Optional structured data
   */
  error(message: string, error?: Error, data?: Record<string, unknown>): void

  /**
   * Create a child logger with additional context.
   * @param context - Context to add to all log entries from child logger
   */
  child(context: Record<string, unknown>): Logger
}

/**
 * Options for creating a logger.
 */
export interface LoggerOptions {
  /** Component or module name */
  component?: string
  /** Minimum log level to output (default: INFO, DEBUG in development) */
  minLevel?: LogLevel
  /** Additional context to include in all log entries */
  context?: Record<string, unknown>
  /** Custom log handler (defaults to console output) */
  handler?: (entry: LogEntry) => void
}

// ============================================================================
// Default Log Handler
// ============================================================================

/**
 * Default log handler that outputs structured JSON to console.
 * In production environments, this is typically collected by logging infrastructure.
 */
function defaultHandler(entry: LogEntry): void {
  // Output as JSON for structured logging systems
  const output = JSON.stringify(entry)

  switch (entry.level) {
    case LogLevel.DEBUG:
      console.debug(output)
      break
    case LogLevel.INFO:
      console.info(output)
      break
    case LogLevel.WARN:
      console.warn(output)
      break
    case LogLevel.ERROR:
      console.error(output)
      break
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
export function createLogger(options: LoggerOptions = {}): Logger {
  const {
    component,
    minLevel = LogLevel.INFO,
    context = {},
    handler = defaultHandler,
  } = options

  function shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel]
  }

  function log(
    level: LogLevel,
    message: string,
    error?: Error,
    data?: Record<string, unknown>
  ): void {
    if (!shouldLog(level)) return

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    }

    if (component) {
      entry.component = component
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        ...(error.stack !== undefined && { stack: error.stack }),
      }
    }

    // Merge context and data
    const mergedData = { ...context, ...data }
    if (Object.keys(mergedData).length > 0) {
      entry.data = mergedData
    }

    handler(entry)
  }

  const logger: Logger = {
    debug(message: string, data?: Record<string, unknown>): void {
      log(LogLevel.DEBUG, message, undefined, data)
    },

    info(message: string, data?: Record<string, unknown>): void {
      log(LogLevel.INFO, message, undefined, data)
    },

    warn(message: string, data?: Record<string, unknown>): void {
      log(LogLevel.WARN, message, undefined, data)
    },

    error(message: string, error?: Error, data?: Record<string, unknown>): void {
      log(LogLevel.ERROR, message, error, data)
    },

    child(childContext: Record<string, unknown>): Logger {
      return createLogger({
        ...(component !== undefined && { component }),
        minLevel,
        context: { ...context, ...childContext },
        handler,
      })
    },
  }

  return logger
}

// ============================================================================
// Pre-configured Loggers
// ============================================================================

/**
 * No-op logger that discards all messages.
 * Useful for testing or when logging is explicitly disabled.
 */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
}

/**
 * Default logger instance for quick usage.
 * Use createLogger() for customized logging.
 */
export const defaultLogger = createLogger()

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
})
