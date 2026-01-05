/**
 * Parquet Writer for Git Analytics
 *
 * Provides functionality to write git analytics data to Parquet format:
 * - Schema definition with various field types
 * - Compression support (SNAPPY, GZIP, ZSTD, LZ4, UNCOMPRESSED)
 * - Row group management
 * - Metadata handling with statistics
 *
 * gitdo-6rz: Parquet writer implementation
 */
/**
 * Supported Parquet field types
 */
export declare enum ParquetFieldType {
    STRING = "STRING",
    INT32 = "INT32",
    INT64 = "INT64",
    BOOLEAN = "BOOLEAN",
    FLOAT = "FLOAT",
    DOUBLE = "DOUBLE",
    BINARY = "BINARY",
    TIMESTAMP_MILLIS = "TIMESTAMP_MILLIS",
    TIMESTAMP_MICROS = "TIMESTAMP_MICROS"
}
/**
 * Supported compression types
 */
export declare enum ParquetCompression {
    UNCOMPRESSED = "UNCOMPRESSED",
    SNAPPY = "SNAPPY",
    GZIP = "GZIP",
    ZSTD = "ZSTD",
    LZ4 = "LZ4"
}
/**
 * Field definition for schema
 */
export interface ParquetField {
    name: string;
    type: ParquetFieldType;
    required: boolean;
    metadata?: Record<string, string>;
}
/**
 * Parquet schema definition
 */
export interface ParquetSchema {
    fields: ParquetField[];
    metadata?: Record<string, string>;
}
/**
 * Options for creating a Parquet writer
 */
export interface ParquetWriteOptions {
    rowGroupSize?: number;
    rowGroupMemoryLimit?: number;
    compression?: ParquetCompression;
    columnCompression?: Record<string, ParquetCompression>;
    enableStatistics?: boolean;
    sortBy?: string[];
    partitionColumns?: string[];
}
/**
 * Column statistics
 */
export interface ColumnStatistics {
    min?: number | string | boolean;
    max?: number | string | boolean;
    nullCount?: number;
    distinctCount?: number;
}
/**
 * Column metadata in a row group
 */
export interface ColumnChunkMetadata {
    column: string;
    type: ParquetFieldType;
    compression: ParquetCompression;
    encodedSize: number;
    uncompressedSize: number;
    statistics?: ColumnStatistics;
}
/**
 * Row group representation
 */
export interface RowGroup {
    numRows: number;
    totalByteSize: number;
    columns: ColumnChunkMetadata[];
}
/**
 * Parquet file metadata
 */
export interface ParquetMetadata {
    schema: ParquetSchema;
    numRows: number;
    rowGroups: RowGroup[];
    compression: ParquetCompression;
    columnMetadata?: Record<string, {
        compression: ParquetCompression;
    }>;
    keyValueMetadata?: Record<string, string>;
    createdAt: number;
    fileSize: number;
    sortedBy?: string[];
    partitionColumns?: string[];
}
/**
 * Mock output stream interface
 */
export interface OutputStream {
    write(data: Uint8Array): void;
}
/**
 * Error class for Parquet operations
 */
export declare class ParquetError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
/**
 * Parquet writer for git analytics data
 */
export declare class ParquetWriter {
    readonly schema: ParquetSchema;
    readonly options: Required<Pick<ParquetWriteOptions, 'rowGroupSize' | 'compression'>> & ParquetWriteOptions;
    private _rowCount;
    private _rowGroups;
    private _currentRowGroup;
    private _isClosed;
    private _keyValueMetadata;
    private _createdAt;
    constructor(schema: ParquetSchema, options?: ParquetWriteOptions);
    /**
     * Get total row count
     */
    get rowCount(): number;
    /**
     * Get number of row groups (including current pending row group if non-empty)
     */
    get rowGroupCount(): number;
    /**
     * Check if writer is closed
     */
    get isClosed(): boolean;
    /**
     * Write a single row
     */
    writeRow(row: Record<string, unknown>): Promise<void>;
    /**
     * Write multiple rows at once
     */
    writeRows(rows: Record<string, unknown>[]): Promise<void>;
    /**
     * Manually flush the current row group
     */
    flushRowGroup(): Promise<void>;
    /**
     * Get the current row group memory size
     */
    currentRowGroupMemorySize(): number;
    /**
     * Get completed row groups
     */
    getRowGroups(): RowGroup[];
    /**
     * Set custom key-value metadata
     */
    setMetadata(key: string, value: string): void;
    /**
     * Generate the Parquet file as a buffer
     */
    toBuffer(): Promise<Uint8Array>;
    /**
     * Write to an output stream
     */
    writeTo(output: OutputStream): Promise<void>;
    /**
     * Reset the writer state
     */
    reset(): void;
    /**
     * Validate a row against the schema
     */
    private _validateRow;
    /**
     * Validate a value matches the expected type
     */
    private _validateType;
    /**
     * Estimate the memory size of a row
     */
    private _estimateRowSize;
    /**
     * Build a row group from internal representation
     */
    private _buildRowGroup;
    /**
     * Compute statistics for a column
     */
    private _computeStatistics;
    /**
     * Estimate encoded size after compression
     */
    private _estimateEncodedSize;
    /**
     * Estimate uncompressed size
     */
    private _estimateUncompressedSize;
    /**
     * Generate the complete Parquet file bytes
     */
    private _generateParquetBytes;
    /**
     * Simple compression simulation for non-gzip formats
     */
    private _simpleCompress;
}
/**
 * Define a Parquet schema
 */
export declare function defineSchema(fields: ParquetField[], metadata?: Record<string, string>): ParquetSchema;
/**
 * Create a Parquet writer
 */
export declare function createParquetWriter(schema: ParquetSchema, options?: ParquetWriteOptions): ParquetWriter;
/**
 * Write data directly to a Parquet file
 */
export declare function writeParquetFile(schema: ParquetSchema, rows: Record<string, unknown>[], options?: ParquetWriteOptions): Promise<Uint8Array>;
/**
 * Close a writer and return the final buffer
 */
export declare function closeWriter(writer: ParquetWriter): Promise<Uint8Array>;
/**
 * Add a row group to the writer
 */
export declare function addRowGroup(writer: ParquetWriter, rows: Record<string, unknown>[]): Promise<void>;
/**
 * Get metadata from a Parquet file buffer
 */
export declare function getMetadata(bytes: Uint8Array): ParquetMetadata;
/**
 * Set compression for a writer
 */
export declare function setCompression(writer: ParquetWriter, compression: ParquetCompression): void;
//# sourceMappingURL=parquet-writer.d.ts.map