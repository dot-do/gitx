/**
 * @fileoverview FSX (Filesystem Extension) Service Binding Adapter
 *
 * Creates an FsCapability adapter that proxies filesystem operations
 * to the fsx-do worker service binding.
 *
 * @module do/fsx-adapter
 */
import type { ServiceBinding, FsCapability } from './types';
/**
 * Creates an FsCapability adapter that uses the FSX service binding.
 * All filesystem operations are proxied to the fsx-do worker.
 *
 * @param fsx - The FSX service binding
 * @param namespace - The namespace (typically DO ID) for FSX operations
 * @returns FsCapability interface for filesystem operations
 */
export declare function createFsxAdapter(fsx: ServiceBinding, namespace: string): FsCapability;
//# sourceMappingURL=fsx-adapter.d.ts.map