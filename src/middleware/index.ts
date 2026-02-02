/**
 * @fileoverview Middleware Module
 *
 * Exports all middleware functions and types for the gitx.do worker.
 *
 * @module middleware
 */

// Rate limiting middleware
export {
  // Types
  type RateLimitConfig,
  type RateLimitConfigs,
  type RateLimitResult,
  type RateLimitInfo,
  type RateLimitStore,
  type RateLimitOptions,
  type EndpointType,
  type KeyExtractor,
  type EndpointClassifier,
  // Constants
  DEFAULT_LIMITS,
  // Stores
  MemoryRateLimitStore,
  DORateLimitStore,
  // DO class (for distributed rate limiting)
  RateLimitDO,
  // Middleware factory
  createRateLimitMiddleware,
  // Utility functions
  createDefaultRateLimiter,
  createStrictRateLimiter,
  createPermissiveRateLimiter,
  // Key extraction
  defaultKeyExtractor,
  createUserAwareKeyExtractor,
  // Endpoint classification
  defaultEndpointClassifier,
} from './rate-limit'
