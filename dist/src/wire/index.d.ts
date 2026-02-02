/**
 * @fileoverview Wire Protocol Subpath Barrel
 *
 * Targeted exports for Git wire protocol modules: Smart HTTP handlers,
 * pkt-line encoding, and authentication.
 *
 * @module wire
 *
 * @example
 * ```typescript
 * import { handleInfoRefs, handleUploadPack, encodePktLine } from 'gitx.do/wire'
 * ```
 */
export { handleInfoRefs, handleUploadPack, handleReceivePack, formatRefAdvertisement, formatUploadPackResponse, formatReceivePackResponse, parseUploadPackRequest, parseReceivePackRequest, parseCapabilities, capabilitiesToStrings, validateContentType, createErrorResponse, CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT, CONTENT_TYPE_RECEIVE_PACK_ADVERTISEMENT, CONTENT_TYPE_UPLOAD_PACK_REQUEST, CONTENT_TYPE_UPLOAD_PACK_RESULT, CONTENT_TYPE_RECEIVE_PACK_REQUEST, CONTENT_TYPE_RECEIVE_PACK_RESULT, ZERO_SHA, type GitService, type HTTPMethod, type GitRef, type ServerCapabilities, type SmartHTTPRequest, type SmartHTTPResponse, type SmartHTTPError, type RepositoryProvider, type RefUpdateCommand, type ReceivePackResult, } from './smart-http';
export { encodePktLine, decodePktLine, encodeFlushPkt, encodeDelimPkt, pktLineStream, FLUSH_PKT, DELIM_PKT, MAX_PKT_LINE_DATA, } from './pkt-line';
export { parseAuthorizationHeader, encodeBasicAuth, encodeBearerAuth, createUnauthorizedResponse, isAnonymous, isBasicAuth, isBearerAuth, constantTimeCompare, DEFAULT_REALM, type AuthType, type BasicCredentials, type BearerCredentials, type AnonymousCredentials, type Credentials, type AuthContext, type AuthResult, type AuthenticatedUser, type AuthProvider, type AuthOptions, } from './auth';
export { createAuthMiddleware, MemoryAuthProvider, CallbackAuthProvider, createAuthenticatedRepositoryProvider, type AuthMiddleware, type AuthenticationResult, type MemoryAuthProviderConfig, } from './auth-middleware';
export { getDefaultLimits, createNegotiationContext, validateNegotiationRound, recordWants, recordHaves, isTimedOut, getRemainingTime, completeNegotiation, abortNegotiation, validateSha, validateShas, validateCapabilities, validateRefNameLength, validatePacket, safeParseWantLine, safeParseHaveLine, withTimeout, createDeadlineChecker, createInMemoryRateLimiter, createNoopRateLimiterHook, createRateLimiterHook, withErrorRecovery, createErrorResponse as createHardeningErrorResponse, MalformedPacketError, NegotiationLimitError, NegotiationTimeoutError, type NegotiationLimits, type NegotiationContext, type ValidationResult, type RateLimiterConfig, type RateLimitRequest, type RateLimitResult, type RateLimiter, type RateLimiterHook, } from './hardening';
export { DEFAULT_CHUNK_SIZE, MIN_CHUNK_SIZE, MAX_SIDEBAND_PAYLOAD, LARGE_BLOB_THRESHOLD, StreamChannel, createBlobReadStream, createR2ReadStream, createSideBandTransform, createSideBandExtractTransform, createPktLineTransform, createStreamingPackWriter, createStreamingPackReader, StreamingPackWriter, isLargeBlob, createProgressTransform, concatStreams, teeStream, type BlobStreamOptions, type SideBandOptions, type StreamingPackWriterOptions, type StreamableObject, type StreamingStats, type StreamProgressCallback, type StreamingPackReaderOptions, } from './streaming';
//# sourceMappingURL=index.d.ts.map