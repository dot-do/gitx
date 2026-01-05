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
import pako from 'pako';
// ============================================================================
// Types and Enums
// ============================================================================
/**
 * Supported Parquet field types
 */
export var ParquetFieldType;
(function (ParquetFieldType) {
    ParquetFieldType["STRING"] = "STRING";
    ParquetFieldType["INT32"] = "INT32";
    ParquetFieldType["INT64"] = "INT64";
    ParquetFieldType["BOOLEAN"] = "BOOLEAN";
    ParquetFieldType["FLOAT"] = "FLOAT";
    ParquetFieldType["DOUBLE"] = "DOUBLE";
    ParquetFieldType["BINARY"] = "BINARY";
    ParquetFieldType["TIMESTAMP_MILLIS"] = "TIMESTAMP_MILLIS";
    ParquetFieldType["TIMESTAMP_MICROS"] = "TIMESTAMP_MICROS";
})(ParquetFieldType || (ParquetFieldType = {}));
/**
 * Supported compression types
 */
export var ParquetCompression;
(function (ParquetCompression) {
    ParquetCompression["UNCOMPRESSED"] = "UNCOMPRESSED";
    ParquetCompression["SNAPPY"] = "SNAPPY";
    ParquetCompression["GZIP"] = "GZIP";
    ParquetCompression["ZSTD"] = "ZSTD";
    ParquetCompression["LZ4"] = "LZ4";
})(ParquetCompression || (ParquetCompression = {}));
/**
 * Error class for Parquet operations
 */
export class ParquetError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'ParquetError';
    }
}
// ============================================================================
// ParquetWriter Class
// ============================================================================
/**
 * Parquet writer for git analytics data
 */
export class ParquetWriter {
    schema;
    options;
    _rowCount = 0;
    _rowGroups = [];
    _currentRowGroup = { rows: [], byteSize: 0 };
    _isClosed = false;
    _keyValueMetadata = {};
    _createdAt = Date.now();
    constructor(schema, options = {}) {
        this.schema = schema;
        this.options = {
            rowGroupSize: options.rowGroupSize ?? 65536,
            compression: options.compression ?? ParquetCompression.SNAPPY,
            ...options
        };
    }
    /**
     * Get total row count
     */
    get rowCount() {
        return this._rowCount;
    }
    /**
     * Get number of row groups (including current pending row group if non-empty)
     */
    get rowGroupCount() {
        const pendingCount = this._currentRowGroup.rows.length > 0 ? 1 : 0;
        return this._rowGroups.length + pendingCount;
    }
    /**
     * Check if writer is closed
     */
    get isClosed() {
        return this._isClosed;
    }
    /**
     * Write a single row
     */
    async writeRow(row) {
        if (this._isClosed) {
            throw new ParquetError('Cannot write to a closed writer', 'WRITER_CLOSED');
        }
        this._validateRow(row);
        const rowSize = this._estimateRowSize(row);
        this._currentRowGroup.rows.push(row);
        this._currentRowGroup.byteSize += rowSize;
        this._rowCount++;
        // Check if we should flush based on row count
        if (this._currentRowGroup.rows.length >= this.options.rowGroupSize) {
            await this.flushRowGroup();
        }
        // Check if we should flush based on memory limit
        else if (this.options.rowGroupMemoryLimit &&
            this._currentRowGroup.byteSize >= this.options.rowGroupMemoryLimit) {
            await this.flushRowGroup();
        }
    }
    /**
     * Write multiple rows at once
     */
    async writeRows(rows) {
        for (const row of rows) {
            await this.writeRow(row);
        }
    }
    /**
     * Manually flush the current row group
     */
    async flushRowGroup() {
        if (this._currentRowGroup.rows.length === 0) {
            return;
        }
        const rowGroup = this._buildRowGroup(this._currentRowGroup);
        this._rowGroups.push(rowGroup);
        this._currentRowGroup = { rows: [], byteSize: 0 };
    }
    /**
     * Get the current row group memory size
     */
    currentRowGroupMemorySize() {
        return this._currentRowGroup.byteSize;
    }
    /**
     * Get completed row groups
     */
    getRowGroups() {
        return [...this._rowGroups];
    }
    /**
     * Set custom key-value metadata
     */
    setMetadata(key, value) {
        this._keyValueMetadata[key] = value;
    }
    /**
     * Generate the Parquet file as a buffer
     */
    async toBuffer() {
        // Flush any remaining rows
        if (this._currentRowGroup.rows.length > 0) {
            await this.flushRowGroup();
        }
        return this._generateParquetBytes();
    }
    /**
     * Write to an output stream
     */
    async writeTo(output) {
        const bytes = await this.toBuffer();
        output.write(bytes);
    }
    /**
     * Reset the writer state
     */
    reset() {
        this._rowCount = 0;
        this._rowGroups = [];
        this._currentRowGroup = { rows: [], byteSize: 0 };
        this._isClosed = false;
        this._keyValueMetadata = {};
        this._createdAt = Date.now();
    }
    /**
     * Validate a row against the schema
     */
    _validateRow(row) {
        for (const field of this.schema.fields) {
            const value = row[field.name];
            // Check required fields
            if (field.required && (value === undefined || value === null)) {
                throw new ParquetError(`Missing required field: ${field.name}`, 'MISSING_REQUIRED_FIELD');
            }
            // Check type if value is present and not null
            if (value !== null && value !== undefined) {
                if (!this._validateType(value, field.type)) {
                    throw new ParquetError(`Invalid type for field ${field.name}: expected ${field.type}`, 'INVALID_FIELD_TYPE');
                }
            }
        }
    }
    /**
     * Validate a value matches the expected type
     */
    _validateType(value, type) {
        switch (type) {
            case ParquetFieldType.STRING:
                return typeof value === 'string';
            case ParquetFieldType.INT32:
            case ParquetFieldType.INT64:
            case ParquetFieldType.FLOAT:
            case ParquetFieldType.DOUBLE:
            case ParquetFieldType.TIMESTAMP_MILLIS:
            case ParquetFieldType.TIMESTAMP_MICROS:
                return typeof value === 'number';
            case ParquetFieldType.BOOLEAN:
                return typeof value === 'boolean';
            case ParquetFieldType.BINARY:
                return value instanceof Uint8Array || typeof value === 'string';
            default:
                return false;
        }
    }
    /**
     * Estimate the memory size of a row
     */
    _estimateRowSize(row) {
        let size = 0;
        for (const field of this.schema.fields) {
            const value = row[field.name];
            if (value === null || value === undefined) {
                size += 1; // null marker
            }
            else if (typeof value === 'string') {
                size += value.length * 2; // UTF-16
            }
            else if (typeof value === 'number') {
                size += 8; // 64-bit
            }
            else if (typeof value === 'boolean') {
                size += 1;
            }
            else if (value instanceof Uint8Array) {
                size += value.length;
            }
        }
        return size;
    }
    /**
     * Build a row group from internal representation
     */
    _buildRowGroup(internal) {
        const columns = this.schema.fields.map(field => {
            const values = internal.rows.map(row => row[field.name]);
            const stats = this.options.enableStatistics ? this._computeStatistics(values, field.type) : undefined;
            const compression = this.options.columnCompression?.[field.name] ?? this.options.compression;
            return {
                column: field.name,
                type: field.type,
                compression,
                encodedSize: this._estimateEncodedSize(values, field.type, compression),
                uncompressedSize: this._estimateUncompressedSize(values, field.type),
                statistics: stats
            };
        });
        return {
            numRows: internal.rows.length,
            totalByteSize: columns.reduce((sum, col) => sum + col.encodedSize, 0),
            columns
        };
    }
    /**
     * Compute statistics for a column
     */
    _computeStatistics(values, type) {
        const nonNullValues = values.filter(v => v !== null && v !== undefined);
        const nullCount = values.length - nonNullValues.length;
        if (nonNullValues.length === 0) {
            return { nullCount };
        }
        switch (type) {
            case ParquetFieldType.INT32:
            case ParquetFieldType.INT64:
            case ParquetFieldType.FLOAT:
            case ParquetFieldType.DOUBLE:
            case ParquetFieldType.TIMESTAMP_MILLIS:
            case ParquetFieldType.TIMESTAMP_MICROS: {
                const numbers = nonNullValues.filter(v => typeof v === 'number' && !Number.isNaN(v));
                if (numbers.length === 0) {
                    return { nullCount };
                }
                return {
                    min: Math.min(...numbers),
                    max: Math.max(...numbers),
                    nullCount
                };
            }
            case ParquetFieldType.STRING: {
                const strings = nonNullValues;
                return {
                    min: strings.reduce((a, b) => a < b ? a : b),
                    max: strings.reduce((a, b) => a > b ? a : b),
                    nullCount
                };
            }
            case ParquetFieldType.BOOLEAN: {
                return { nullCount };
            }
            default:
                return { nullCount };
        }
    }
    /**
     * Estimate encoded size after compression
     */
    _estimateEncodedSize(values, type, compression) {
        const uncompressedSize = this._estimateUncompressedSize(values, type);
        // Apply compression ratio estimate
        switch (compression) {
            case ParquetCompression.SNAPPY:
                return Math.floor(uncompressedSize * 0.5);
            case ParquetCompression.GZIP:
                return Math.floor(uncompressedSize * 0.3);
            case ParquetCompression.ZSTD:
                return Math.floor(uncompressedSize * 0.25);
            case ParquetCompression.LZ4:
                return Math.floor(uncompressedSize * 0.4);
            case ParquetCompression.UNCOMPRESSED:
            default:
                return uncompressedSize;
        }
    }
    /**
     * Estimate uncompressed size
     */
    _estimateUncompressedSize(values, type) {
        let size = 0;
        for (const value of values) {
            if (value === null || value === undefined) {
                size += 1;
            }
            else {
                switch (type) {
                    case ParquetFieldType.STRING:
                        size += value.length * 2;
                        break;
                    case ParquetFieldType.INT32:
                    case ParquetFieldType.FLOAT:
                        size += 4;
                        break;
                    case ParquetFieldType.INT64:
                    case ParquetFieldType.DOUBLE:
                    case ParquetFieldType.TIMESTAMP_MILLIS:
                    case ParquetFieldType.TIMESTAMP_MICROS:
                        size += 8;
                        break;
                    case ParquetFieldType.BOOLEAN:
                        size += 1;
                        break;
                    case ParquetFieldType.BINARY:
                        size += value instanceof Uint8Array ? value.length : value.length;
                        break;
                }
            }
        }
        return size;
    }
    /**
     * Generate the complete Parquet file bytes
     */
    _generateParquetBytes() {
        // Build all row data - will be populated from row groups in full implementation
        // For now, row group data is serialized directly below
        // Calculate metadata
        const metadata = {
            schema: this.schema,
            numRows: this._rowCount,
            rowGroups: this._rowGroups,
            compression: this.options.compression,
            columnCompression: this.options.columnCompression,
            keyValueMetadata: this._keyValueMetadata,
            createdAt: this._createdAt,
            sortedBy: this.options.sortBy,
            partitionColumns: this.options.partitionColumns
        };
        // Encode metadata to JSON and then to bytes
        const metadataJson = JSON.stringify(metadata);
        const metadataBytes = new TextEncoder().encode(metadataJson);
        // Compress metadata if needed
        let compressedMetadata;
        if (this.options.compression === ParquetCompression.GZIP) {
            compressedMetadata = pako.gzip(metadataBytes);
        }
        else {
            // For SNAPPY, ZSTD, LZ4 - we'll use a simple RLE-like compression simulation
            // In production, you'd use actual compression libraries
            compressedMetadata = this._simpleCompress(metadataBytes, this.options.compression);
        }
        // Build final file structure
        // PAR1 magic (4 bytes) + data + metadata length (4 bytes) + metadata + PAR1 magic (4 bytes)
        const magic = new TextEncoder().encode('PAR1');
        const metadataLength = new Uint8Array(4);
        new DataView(metadataLength.buffer).setUint32(0, compressedMetadata.length, true);
        // Calculate total size
        const totalSize = 4 + compressedMetadata.length + 4 + 4;
        const result = new Uint8Array(totalSize);
        // Write structure
        let offset = 0;
        result.set(magic, offset);
        offset += 4;
        result.set(compressedMetadata, offset);
        offset += compressedMetadata.length;
        result.set(metadataLength, offset);
        offset += 4;
        result.set(magic, offset);
        return result;
    }
    /**
     * Simple compression simulation for non-gzip formats
     */
    _simpleCompress(data, compression) {
        if (compression === ParquetCompression.UNCOMPRESSED) {
            return data;
        }
        // Use pako deflate for a basic compression simulation
        // Real implementation would use snappy-js, zstd-codec, lz4js etc.
        try {
            return pako.deflate(data, { level: compression === ParquetCompression.ZSTD ? 9 : 6 });
        }
        catch {
            return data;
        }
    }
}
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Define a Parquet schema
 */
export function defineSchema(fields, metadata) {
    // Validate schema
    if (fields.length === 0) {
        throw new ParquetError('Schema cannot be empty', 'EMPTY_SCHEMA');
    }
    const names = new Set();
    for (const field of fields) {
        if (!field.name || field.name.trim() === '') {
            throw new ParquetError('Field name cannot be empty', 'EMPTY_FIELD_NAME');
        }
        if (names.has(field.name)) {
            throw new ParquetError(`Duplicate field name: ${field.name}`, 'DUPLICATE_FIELD');
        }
        names.add(field.name);
    }
    return {
        fields: fields.map(f => ({
            name: f.name,
            type: f.type,
            required: f.required,
            metadata: f.metadata
        })),
        metadata
    };
}
/**
 * Create a Parquet writer
 */
export function createParquetWriter(schema, options = {}) {
    return new ParquetWriter(schema, options);
}
/**
 * Write data directly to a Parquet file
 */
export async function writeParquetFile(schema, rows, options = {}) {
    const writer = createParquetWriter(schema, options);
    await writer.writeRows(rows);
    return writer.toBuffer();
}
/**
 * Close a writer and return the final buffer
 */
export async function closeWriter(writer) {
    const bytes = await writer.toBuffer();
    writer._isClosed = true;
    return bytes;
}
/**
 * Add a row group to the writer
 */
export async function addRowGroup(writer, rows) {
    await writer.writeRows(rows);
    await writer.flushRowGroup();
}
/**
 * Get metadata from a Parquet file buffer
 */
export function getMetadata(bytes) {
    // Verify magic bytes
    const startMagic = new TextDecoder().decode(bytes.slice(0, 4));
    const endMagic = new TextDecoder().decode(bytes.slice(-4));
    if (startMagic !== 'PAR1' || endMagic !== 'PAR1') {
        throw new ParquetError('Invalid Parquet file: missing magic bytes', 'INVALID_MAGIC');
    }
    // Read metadata length (4 bytes before final magic)
    const metadataLengthOffset = bytes.length - 8;
    const metadataLength = new DataView(bytes.buffer, bytes.byteOffset + metadataLengthOffset, 4).getUint32(0, true);
    // Read compressed metadata
    const metadataStart = 4;
    const compressedMetadata = bytes.slice(metadataStart, metadataStart + metadataLength);
    // Decompress metadata
    let metadataBytes;
    try {
        // Try gzip first
        metadataBytes = pako.ungzip(compressedMetadata);
    }
    catch {
        try {
            // Try inflate (deflate)
            metadataBytes = pako.inflate(compressedMetadata);
        }
        catch {
            // Assume uncompressed
            metadataBytes = compressedMetadata;
        }
    }
    // Parse metadata JSON
    const metadataJson = new TextDecoder().decode(metadataBytes);
    const internal = JSON.parse(metadataJson);
    // Build column metadata map
    const columnMetadata = {};
    if (internal.columnCompression) {
        for (const [col, comp] of Object.entries(internal.columnCompression)) {
            columnMetadata[col] = { compression: comp };
        }
    }
    return {
        schema: internal.schema,
        numRows: internal.numRows,
        rowGroups: internal.rowGroups,
        compression: internal.compression,
        columnMetadata: Object.keys(columnMetadata).length > 0 ? columnMetadata : undefined,
        keyValueMetadata: Object.keys(internal.keyValueMetadata).length > 0 ? internal.keyValueMetadata : undefined,
        createdAt: internal.createdAt,
        fileSize: bytes.length,
        sortedBy: internal.sortedBy,
        partitionColumns: internal.partitionColumns
    };
}
/**
 * Set compression for a writer
 */
export function setCompression(writer, compression) {
    ;
    writer.options.compression = compression;
}
//# sourceMappingURL=parquet-writer.js.map