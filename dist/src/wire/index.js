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
// Smart HTTP Protocol
export { handleInfoRefs, handleUploadPack, handleReceivePack, formatRefAdvertisement, formatUploadPackResponse, formatReceivePackResponse, parseUploadPackRequest, parseReceivePackRequest, parseCapabilities, capabilitiesToStrings, validateContentType, createErrorResponse, CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT, CONTENT_TYPE_RECEIVE_PACK_ADVERTISEMENT, CONTENT_TYPE_UPLOAD_PACK_REQUEST, CONTENT_TYPE_UPLOAD_PACK_RESULT, CONTENT_TYPE_RECEIVE_PACK_REQUEST, CONTENT_TYPE_RECEIVE_PACK_RESULT, ZERO_SHA, } from './smart-http';
// Pkt-line Encoding/Decoding
export { encodePktLine, decodePktLine, encodeFlushPkt, encodeDelimPkt, pktLineStream, FLUSH_PKT, DELIM_PKT, MAX_PKT_LINE_DATA, } from './pkt-line';
// Authentication
export { parseAuthorizationHeader, encodeBasicAuth, encodeBearerAuth, createUnauthorizedResponse, isAnonymous, isBasicAuth, isBearerAuth, constantTimeCompare, DEFAULT_REALM, } from './auth';
// Authentication Middleware
export { createAuthMiddleware, MemoryAuthProvider, CallbackAuthProvider, createAuthenticatedRepositoryProvider, } from './auth-middleware';
// Production Hardening - types aliased to avoid conflicts with middleware module
export { 
// Negotiation limits and context
getDefaultLimits, createNegotiationContext, validateNegotiationRound, recordWants, recordHaves, isTimedOut, getRemainingTime, completeNegotiation, abortNegotiation, 
// Validation
validateSha, validateShas, validateCapabilities, validateRefNameLength, validatePacket, safeParseWantLine, safeParseHaveLine, 
// Timeout handling
withTimeout, createDeadlineChecker, 
// Rate limiting
createInMemoryRateLimiter, createNoopRateLimiterHook, createRateLimiterHook, 
// Error recovery
withErrorRecovery, createErrorResponse as createHardeningErrorResponse, 
// Error classes
MalformedPacketError, NegotiationLimitError, NegotiationTimeoutError, } from './hardening';
// Streaming Support for Large Blobs
export { 
// Constants
DEFAULT_CHUNK_SIZE, MIN_CHUNK_SIZE, MAX_SIDEBAND_PAYLOAD, LARGE_BLOB_THRESHOLD, 
// Enums
StreamChannel, 
// Blob streaming
createBlobReadStream, createR2ReadStream, 
// Side-band streaming
createSideBandTransform, createSideBandExtractTransform, 
// Pkt-line streaming
createPktLineTransform, 
// Pack streaming
createStreamingPackWriter, createStreamingPackReader, StreamingPackWriter, 
// Utilities
isLargeBlob, createProgressTransform, concatStreams, teeStream, } from './streaming';
// Send-pack Protocol (Push Client) - aliased to avoid conflicts with ops/branch
export { push, pushBranch, deleteBranch as deleteRemoteBranch, discoverReceivePackRefs, parseReceivePackCapabilities, ZERO_SHA as SEND_PACK_ZERO_SHA, } from './send-pack';
// Receive-pack Protocol Limits (DoS Protection) - aliased to avoid conflicts with pack/barrel
export { UNPACK_LIMITS as WIRE_UNPACK_LIMITS, } from './receive-pack';
//# sourceMappingURL=index.js.map