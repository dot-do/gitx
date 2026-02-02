/**
 * @fileoverview RPC Module Entry Point
 *
 * Exports the RPC service mode for heavy git operations.
 *
 * @module rpc
 *
 * @example
 * ```typescript
 * import { GitRPCService, OperationType, OperationState } from 'gitx.do/rpc'
 *
 * const service = new GitRPCService({ storage, r2 })
 * const { operationId } = await service.startClone({
 *   remote: 'https://github.com/example/repo.git',
 *   branch: 'main',
 * })
 * ```
 */
export { GitRPCService, 
// Enums
OperationType, OperationState, } from './git-rpc-service';
//# sourceMappingURL=index.js.map