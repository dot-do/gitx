/**
 * @fileoverview Export route handlers for GitRepoDO.
 *
 * Domain-specific handlers for Parquet and Iceberg export operations.
 *
 * @module do/export-routes
 */
import type { GitRepoDOInstance, RouteContext } from './routes';
/**
 * Export request payload.
 */
export interface ExportRequest {
    /** Tables to export (commits, refs, files, or all) */
    tables?: ('commits' | 'refs' | 'files')[];
    /** Force full export even if incremental is available */
    fullExport?: boolean;
    /** Repository name (e.g., "owner/repo") - used as fallback if DO ns not set */
    repository?: string;
    /** Compression codec: 'LZ4', 'UNCOMPRESSED', or 'SNAPPY' (default) */
    codec?: 'LZ4' | 'LZ4_RAW' | 'UNCOMPRESSED' | 'SNAPPY';
    /** Export format: 'parquet' (raw files) or 'iceberg' (with table metadata) */
    format?: 'parquet' | 'iceberg';
}
/**
 * Export job status.
 */
export interface ExportJobStatus {
    id: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    tables: string[];
    startedAt: number;
    completedAt?: number;
    error?: string;
    results?: {
        table: string;
        rowCount: number;
        fileSize: number;
        path: string;
    }[];
}
/**
 * Export route handler - exports git data to Parquet and uploads to R2.
 * Supports both raw Parquet export and Iceberg format with table metadata.
 *
 * @param c - Hono context
 * @param instance - GitRepoDO instance
 * @returns Export result with file paths and row counts
 */
export declare function handleExport(c: RouteContext, instance: GitRepoDOInstance): Promise<Response>;
/**
 * Export status route handler.
 *
 * @param c - Hono context
 * @param _instance - GitRepoDO instance
 * @returns Export job status
 */
export declare function handleExportStatus(c: RouteContext, _instance: GitRepoDOInstance): Promise<Response>;
//# sourceMappingURL=export-routes.d.ts.map