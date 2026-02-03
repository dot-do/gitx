/**
 * @fileoverview Wire Protocol Types
 *
 * Platform-agnostic type definitions for the Git wire protocol, covering:
 * - Smart HTTP protocol types (service, refs, requests, responses)
 * - Authentication types (basic, bearer, anonymous)
 * - Production hardening types (negotiation limits, rate limiting, validation)
 * - Streaming types (blob streaming, side-band, pack streaming)
 *
 * @module wire
 *
 * @example
 * ```typescript
 * import type { GitService, SmartHTTPRequest, AuthProvider } from '@dotdo/gitx/wire'
 * ```
 */
// =============================================================================
// Side-band Channel Enum
// =============================================================================
/** Side-band channel numbers for multiplexed streams */
export var StreamChannel;
(function (StreamChannel) {
    StreamChannel[StreamChannel["PackData"] = 1] = "PackData";
    StreamChannel[StreamChannel["Progress"] = 2] = "Progress";
    StreamChannel[StreamChannel["Error"] = 3] = "Error";
})(StreamChannel || (StreamChannel = {}));
//# sourceMappingURL=index.js.map