/**
 * CDC (Change Data Capture) Pipeline for Git Operations
 *
 * Provides functionality to capture, transform, batch, and output git operation events:
 * - Event capture from git operations (push, fetch, commits, etc.)
 * - Parquet transformation for analytics storage
 * - Batching with size and time-based flushing
 * - Error handling with retry policies
 *
 * gitdo: CDC pipeline implementation
 */
/**
 * CDC Event Types representing different git operations
 */
export type CDCEventType = 'OBJECT_CREATED' | 'OBJECT_DELETED' | 'REF_UPDATED' | 'PACK_RECEIVED' | 'COMMIT_CREATED' | 'TREE_MODIFIED' | 'BRANCH_CREATED' | 'BRANCH_DELETED' | 'TAG_CREATED' | 'MERGE_COMPLETED';
/**
 * CDC Event Source indicating origin of the event
 */
export type CDCEventSource = 'push' | 'fetch' | 'internal' | 'replication' | 'gc';
/**
 * Payload for CDC events
 */
export interface CDCEventPayload {
    operation: string;
    sha?: string;
    timestamp?: number;
    data?: Uint8Array;
    metadata?: Record<string, unknown>;
    refName?: string;
    oldSha?: string;
    newSha?: string;
    objectCount?: number;
    treeSha?: string;
    parentShas?: string[];
    branchName?: string;
    tagName?: string;
    baseSha?: string;
    headSha?: string;
}
/**
 * CDC Event structure
 */
export interface CDCEvent {
    id: string;
    type: CDCEventType;
    source: CDCEventSource;
    timestamp: number;
    payload: CDCEventPayload;
    sequence: number;
    version: number;
}
/**
 * Pipeline configuration
 */
export interface CDCPipelineConfig {
    batchSize: number;
    flushIntervalMs: number;
    maxRetries: number;
    parquetCompression: 'snappy' | 'gzip' | 'none';
    outputPath: string;
    schemaVersion: number;
}
/**
 * Pipeline state
 */
export type CDCPipelineState = 'stopped' | 'running' | 'paused';
/**
 * Batch configuration
 */
export interface BatchConfig {
    batchSize: number;
    flushIntervalMs: number;
}
/**
 * Batch result metadata
 */
export interface BatchResult {
    events: CDCEvent[];
    eventCount: number;
    success: boolean;
    minSequence?: number;
    maxSequence?: number;
    minTimestamp?: number;
    maxTimestamp?: number;
}
/**
 * CDC Error types
 */
export type CDCErrorType = 'VALIDATION_ERROR' | 'PROCESSING_ERROR' | 'SERIALIZATION_ERROR' | 'STORAGE_ERROR' | 'TIMEOUT_ERROR' | 'BUFFER_OVERFLOW_ERROR' | 'UNKNOWN_ERROR';
/**
 * Parquet field definition
 */
export interface ParquetField {
    name: string;
    type: string;
    nullable: boolean;
}
/**
 * Parquet row representation
 */
export interface ParquetRow {
    event_id: string;
    event_type: string;
    source: string;
    timestamp: number;
    sequence: number;
    version: number;
    payload_json: string;
    sha: string | null;
}
/**
 * Parquet batch representation
 */
export interface ParquetBatch {
    rows: ParquetRow[];
    rowCount: number;
    createdAt: number;
    schema: {
        fields: ParquetField[];
    };
    compression: string;
}
/**
 * Pipeline output
 */
export interface PipelineOutput {
    parquetBuffer: Uint8Array;
    events: CDCEvent[];
    batchId: string;
}
/**
 * Pipeline metrics
 */
export interface PipelineMetrics {
    eventsProcessed: number;
    batchesGenerated: number;
    bytesWritten: number;
    errors: number;
    avgProcessingLatencyMs: number;
}
/**
 * Process result
 */
export interface ProcessResult {
    success: boolean;
    eventId: string;
}
/**
 * Stop result
 */
export interface StopResult {
    flushedCount: number;
}
/**
 * Custom error class for CDC operations
 */
export declare class CDCError extends Error {
    readonly type: CDCErrorType;
    readonly cause?: Error | undefined;
    constructor(type: CDCErrorType, message: string, cause?: Error | undefined);
}
export interface RetryPolicyConfig {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    jitter?: boolean;
}
/**
 * Retry policy with exponential backoff
 */
export declare class CDCRetryPolicy {
    private readonly config;
    constructor(config: RetryPolicyConfig);
    shouldRetry(attemptCount: number): boolean;
    getDelay(attemptCount: number): number;
}
export interface CDCEventCaptureOptions {
    maxBufferSize?: number;
}
export type GitOperationListener = (event: CDCEvent) => void;
/**
 * Captures git operations and converts them to CDC events
 */
export declare class CDCEventCapture {
    private events;
    private sequenceCounter;
    private listeners;
    private readonly maxBufferSize;
    constructor(options?: CDCEventCaptureOptions);
    private generateEventId;
    private emitEvent;
    private nextSequence;
    onObjectPut(sha: string, type: string, data: Uint8Array): Promise<void>;
    onObjectDelete(sha: string): Promise<void>;
    onRefUpdate(refName: string, oldSha: string, newSha: string): Promise<void>;
    onCommitCreated(commitSha: string, treeSha: string, parentShas: string[]): Promise<void>;
    onPackReceived(packData: Uint8Array, objectCount: number): Promise<void>;
    onBranchCreated(branchName: string, sha: string): Promise<void>;
    onBranchDeleted(branchName: string): Promise<void>;
    onTagCreated(tagName: string, sha: string): Promise<void>;
    onMergeCompleted(mergeSha: string, baseSha: string, headSha: string): Promise<void>;
    getEvents(): CDCEvent[];
    getBufferSize(): number;
    flush(): Promise<CDCEvent[]>;
    addListener(listener: GitOperationListener): void;
    removeListener(listener: GitOperationListener): void;
}
/**
 * Parquet schema definition for CDC events
 */
export declare class ParquetSchema {
    readonly fields: ParquetField[];
    constructor(fields: ParquetField[]);
    static forCDCEvents(customFields?: ParquetField[]): ParquetSchema;
}
export interface ParquetTransformerOptions {
    compression?: 'snappy' | 'gzip' | 'none';
}
/**
 * Transforms CDC events to Parquet format
 */
export declare class ParquetTransformer {
    private readonly compression;
    constructor(options?: ParquetTransformerOptions);
    eventToRow(event: CDCEvent): ParquetRow;
    eventsToBatch(events: CDCEvent[]): ParquetBatch;
    toParquetBuffer(batch: ParquetBatch): Promise<Uint8Array>;
    private gzipCompress;
    private simpleCompress;
}
type BatchHandler = (batch: BatchResult) => void | Promise<void>;
/**
 * Batches CDC events for efficient processing
 */
export declare class CDCBatcher {
    private readonly config;
    private events;
    private batchHandlers;
    private flushTimer;
    private stopped;
    constructor(config: BatchConfig);
    private ensureTimerRunning;
    private clearFlushTimer;
    add(event: CDCEvent): Promise<void>;
    private flushInternal;
    flush(): Promise<BatchResult>;
    getPendingCount(): number;
    onBatch(handler: BatchHandler): void;
    stop(): Promise<void>;
}
type OutputHandler = (output: PipelineOutput) => void;
type DeadLetterHandler = (events: CDCEvent[], error: Error) => void;
/**
 * Main CDC Pipeline for processing git operation events
 */
export declare class CDCPipeline {
    private readonly config;
    private state;
    private batcher;
    private transformer;
    private outputHandlers;
    private deadLetterHandlers;
    private metrics;
    private processingLatencies;
    private retryPolicy;
    constructor(config: CDCPipelineConfig);
    getState(): CDCPipelineState;
    start(): Promise<void>;
    stop(): Promise<StopResult>;
    process(event: CDCEvent): Promise<ProcessResult>;
    processMany(events: CDCEvent[]): Promise<ProcessResult[]>;
    flush(): Promise<void>;
    private handleBatch;
    private sleep;
    private updateAvgLatency;
    getMetrics(): PipelineMetrics;
    onOutput(handler: OutputHandler): void;
    onDeadLetter(handler: DeadLetterHandler): void;
}
/**
 * Create a new CDC event
 */
export declare function createCDCEvent(type: CDCEventType, source: CDCEventSource, payload: CDCEventPayload, options?: {
    sequence?: number;
}): CDCEvent;
/**
 * Serialize a CDC event to bytes
 */
export declare function serializeEvent(event: CDCEvent): Uint8Array;
/**
 * Deserialize bytes to a CDC event
 */
export declare function deserializeEvent(bytes: Uint8Array): CDCEvent;
/**
 * Validate a CDC event
 */
export declare function validateCDCEvent(event: CDCEvent): CDCEvent;
/**
 * Start a pipeline with the given configuration
 */
export declare function startPipeline(id: string, config: CDCPipelineConfig): CDCPipeline;
/**
 * Stop a pipeline by ID
 */
export declare function stopPipeline(id: string): Promise<StopResult>;
/**
 * Flush a pipeline by ID
 */
export declare function flushPipeline(id: string): Promise<void>;
/**
 * Get metrics for a pipeline by ID
 */
export declare function getPipelineMetrics(id: string): PipelineMetrics | null;
export {};
//# sourceMappingURL=cdc-pipeline.d.ts.map