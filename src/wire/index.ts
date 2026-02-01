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
export {
  handleInfoRefs,
  handleUploadPack,
  handleReceivePack,
  formatRefAdvertisement,
  formatUploadPackResponse,
  formatReceivePackResponse,
  parseUploadPackRequest,
  parseReceivePackRequest,
  parseCapabilities,
  capabilitiesToStrings,
  validateContentType,
  createErrorResponse,
  CONTENT_TYPE_UPLOAD_PACK_ADVERTISEMENT,
  CONTENT_TYPE_RECEIVE_PACK_ADVERTISEMENT,
  CONTENT_TYPE_UPLOAD_PACK_REQUEST,
  CONTENT_TYPE_UPLOAD_PACK_RESULT,
  CONTENT_TYPE_RECEIVE_PACK_REQUEST,
  CONTENT_TYPE_RECEIVE_PACK_RESULT,
  ZERO_SHA,
  type GitService,
  type HTTPMethod,
  type GitRef,
  type ServerCapabilities,
  type SmartHTTPRequest,
  type SmartHTTPResponse,
  type SmartHTTPError,
  type RepositoryProvider,
  type RefUpdateCommand,
  type ReceivePackResult,
} from './smart-http'

// Pkt-line Encoding/Decoding
export {
  encodePktLine,
  decodePktLine,
  encodeFlushPkt,
  encodeDelimPkt,
  pktLineStream,
  FLUSH_PKT,
  DELIM_PKT,
  MAX_PKT_LINE_DATA,
} from './pkt-line'

// Authentication
export {
  parseAuthorizationHeader,
  encodeBasicAuth,
  encodeBearerAuth,
  createUnauthorizedResponse,
  isAnonymous,
  isBasicAuth,
  isBearerAuth,
  constantTimeCompare,
  DEFAULT_REALM,
  type AuthType,
  type BasicCredentials,
  type BearerCredentials,
  type AnonymousCredentials,
  type Credentials,
  type AuthContext,
  type AuthResult,
  type AuthenticatedUser,
  type AuthProvider,
  type AuthOptions,
} from './auth'

// Authentication Middleware
export {
  createAuthMiddleware,
  MemoryAuthProvider,
  CallbackAuthProvider,
  createAuthenticatedRepositoryProvider,
  type AuthMiddleware,
  type AuthenticationResult,
  type MemoryAuthProviderConfig,
} from './auth-middleware'
