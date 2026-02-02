/**
 * @fileoverview Type definitions for GitRepoDO and related classes.
 *
 * This module contains all TypeScript interfaces and types used by GitRepoDO,
 * extracted for better code organization and reusability.
 *
 * @module do/types
 */
// ============================================================================
// Error Types
// ============================================================================
/**
 * Error codes for GitRepoDO operations.
 */
export var GitRepoDOErrorCode;
(function (GitRepoDOErrorCode) {
    GitRepoDOErrorCode["NOT_INITIALIZED"] = "NOT_INITIALIZED";
    GitRepoDOErrorCode["INVALID_NAMESPACE"] = "INVALID_NAMESPACE";
    GitRepoDOErrorCode["NOTHING_TO_COMPACT"] = "NOTHING_TO_COMPACT";
    GitRepoDOErrorCode["FORK_FAILED"] = "FORK_FAILED";
    GitRepoDOErrorCode["STORAGE_ERROR"] = "STORAGE_ERROR";
})(GitRepoDOErrorCode || (GitRepoDOErrorCode = {}));
/**
 * Custom error class for GitRepoDO operations.
 */
export class GitRepoDOError extends Error {
    code;
    context;
    constructor(message, code, context) {
        super(message);
        this.name = 'GitRepoDOError';
        this.code = code;
        this.context = context;
        // Maintains proper stack trace for where our error was thrown (only available on V8)
        const ErrorWithCapture = Error;
        if (ErrorWithCapture.captureStackTrace) {
            ErrorWithCapture.captureStackTrace(this, GitRepoDOError);
        }
    }
    toJSON() {
        const result = {
            name: this.name,
            message: this.message,
            code: this.code,
        };
        if (this.context !== undefined) {
            result.context = this.context;
        }
        return result;
    }
}
// ============================================================================
// Logging Types
// ============================================================================
/**
 * Log levels for GitRepoDO logging.
 */
export var LogLevel;
(function (LogLevel) {
    LogLevel["DEBUG"] = "debug";
    LogLevel["INFO"] = "info";
    LogLevel["WARN"] = "warn";
    LogLevel["ERROR"] = "error";
})(LogLevel || (LogLevel = {}));
//# sourceMappingURL=types.js.map