/**
 * @fileoverview CDC (Change Data Capture) Pipeline for Git Operations
 *
 * @description
 * This module provides a comprehensive Change Data Capture system for Git operations,
 * enabling real-time event streaming, transformation, and analytics for Git repository events.
 *
 * ## Key Features
 *
 * - **Event Capture**: Captures git operations (push, fetch, commits, branches, tags, merges)
 * - **Parquet Transformation**: Converts events to columnar Parquet format for analytics
 * - **Batching**: Efficient event batching with configurable size and time-based flushing
 * - **Retry Policies**: Configurable exponential backoff with jitter for resilient processing
 * - **Dead Letter Queue**: Handles failed events for later reprocessing
 * - **Metrics**: Built-in tracking for events processed, batches, errors, and latency
 *
 * ## Architecture
 *
 * The pipeline consists of several components:
 * 1. **CDCEventCapture**: Captures git operations and converts them to CDCEvents
 * 2. **CDCBatcher**: Batches events for efficient processing
 * 3. **ParquetTransformer**: Transforms events to Parquet format
 * 4. **CDCPipeline**: Orchestrates the entire flow with error handling
 *
 * ## Event Flow
 *
 * ```
 * Git Operation -> CDCEventCapture -> CDCBatcher -> ParquetTransformer -> Output
 *                                         |
 *                                         v
 *                              (On failure) Dead Letter Queue
 * ```
 *
 * @module tiered/cdc-pipeline
 *
 * @example
 * ```typescript
 * // Create and start a pipeline
 * const pipeline = new CDCPipeline({
 *   batchSize: 100,
 *   flushIntervalMs: 5000,
 *   maxRetries: 3,
 *   parquetCompression: 'snappy',
 *   outputPath: '/analytics',
 *   schemaVersion: 1
 * })
 *
 * await pipeline.start()
 *
 * // Process events
 * pipeline.onOutput((output) => {
 *   console.log(`Generated batch: ${output.batchId}`)
 *   console.log(`Events: ${output.events.length}`)
 *   console.log(`Parquet size: ${output.parquetBuffer.length} bytes`)
 * })
 *
 * pipeline.onDeadLetter((events, error) => {
 *   console.error(`Failed events: ${events.length}`, error)
 * })
 *
 * // Create and process an event
 * const event = createCDCEvent('COMMIT_CREATED', 'push', {
 *   operation: 'commit-create',
 *   sha: 'abc123...',
 *   treeSha: 'def456...',
 *   parentShas: ['parent1...']
 * })
 *
 * await pipeline.process(event)
 *
 * // Get metrics
 * const metrics = pipeline.getMetrics()
 * console.log(`Processed: ${metrics.eventsProcessed}`)
 * console.log(`Batches: ${metrics.batchesGenerated}`)
 *
 * // Stop the pipeline
 * await pipeline.stop()
 * ```
 *
 * @see {@link CDCPipeline} - Main pipeline orchestration class
 * @see {@link CDCEventCapture} - Event capture from git operations
 * @see {@link ParquetTransformer} - Parquet format transformation
 */
/**
 * CDC Event Types representing different git operations.
 *
 * @description
 * Enumeration of all supported Git operation types that can be captured
 * by the CDC system. Each type corresponds to a specific Git operation.
 *
 * @example
 * ```typescript
 * const eventType: CDCEventType = 'COMMIT_CREATED'
 * ```
 */
export type CDCEventType = 'OBJECT_CREATED' | 'OBJECT_DELETED' | 'REF_UPDATED' | 'PACK_RECEIVED' | 'COMMIT_CREATED' | 'TREE_MODIFIED' | 'BRANCH_CREATED' | 'BRANCH_DELETED' | 'TAG_CREATED' | 'MERGE_COMPLETED';
/**
 * CDC Event Source indicating the origin of the event.
 *
 * @description
 * Identifies the source system or operation that generated the CDC event.
 * This helps with event filtering, routing, and analytics.
 *
 * - `push`: Events from git push operations
 * - `fetch`: Events from git fetch operations
 * - `internal`: Events from internal system operations
 * - `replication`: Events from repository replication
 * - `gc`: Events from garbage collection
 *
 * @example
 * ```typescript
 * const source: CDCEventSource = 'push'
 * ```
 */
export type CDCEventSource = 'push' | 'fetch' | 'internal' | 'replication' | 'gc';
/**
 * Payload data for CDC events.
 *
 * @description
 * Contains the detailed data associated with a CDC event. Different event
 * types use different subsets of these fields.
 *
 * @example
 * ```typescript
 * // Commit created payload
 * const payload: CDCEventPayload = {
 *   operation: 'commit-create',
 *   sha: 'abc123...',
 *   treeSha: 'def456...',
 *   parentShas: ['parent1...']
 * }
 *
 * // Ref updated payload
 * const refPayload: CDCEventPayload = {
 *   operation: 'ref-update',
 *   refName: 'refs/heads/main',
 *   oldSha: 'old123...',
 *   newSha: 'new456...'
 * }
 * ```
 */
export interface CDCEventPayload {
    /**
     * The type of operation performed.
     *
     * @example 'commit-create', 'ref-update', 'branch-create'
     */
    operation: string;
    /**
     * SHA-1 hash of the affected object.
     * Present for object-related events.
     */
    sha?: string;
    /**
     * Timestamp of the operation in milliseconds since epoch.
     */
    timestamp?: number;
    /**
     * Raw binary data associated with the event.
     * Used for object creation and pack reception events.
     */
    data?: Uint8Array;
    /**
     * Additional metadata key-value pairs.
     * Can include object type, size, etc.
     */
    metadata?: Record<string, unknown>;
    /**
     * Git reference name (e.g., 'refs/heads/main').
     * Present for ref update events.
     */
    refName?: string;
    /**
     * Previous SHA for ref update events.
     * May be all zeros for new refs.
     */
    oldSha?: string;
    /**
     * New SHA for ref update events.
     * May be all zeros for deleted refs.
     */
    newSha?: string;
    /**
     * Number of objects in a pack.
     * Present for pack received events.
     */
    objectCount?: number;
    /**
     * Tree SHA for commit events.
     */
    treeSha?: string;
    /**
     * Parent commit SHAs for commit events.
     */
    parentShas?: string[];
    /**
     * Branch name for branch-related events.
     */
    branchName?: string;
    /**
     * Tag name for tag-related events.
     */
    tagName?: string;
    /**
     * Base commit SHA for merge events.
     */
    baseSha?: string;
    /**
     * Head commit SHA for merge events.
     */
    headSha?: string;
}
/**
 * CDC Event structure representing a single change data capture event.
 *
 * @description
 * A CDCEvent captures a single git operation with all metadata needed
 * for replication, analytics, and auditing. Events are immutable once
 * created and ordered by their sequence number.
 *
 * @example
 * ```typescript
 * const event: CDCEvent = {
 *   id: 'evt-1234567890-abc123',
 *   type: 'COMMIT_CREATED',
 *   source: 'push',
 *   timestamp: 1703980800000,
 *   payload: {
 *     operation: 'commit-create',
 *     sha: 'abc123...',
 *     treeSha: 'def456...',
 *     parentShas: ['parent1...']
 *   },
 *   sequence: 42,
 *   version: 1
 * }
 * ```
 */
export interface CDCEvent {
    /**
     * Unique identifier for this event.
     * Format: `evt-{timestamp}-{random}`
     */
    id: string;
    /**
     * Type of git operation that generated this event.
     *
     * @see {@link CDCEventType}
     */
    type: CDCEventType;
    /**
     * Source system or operation that generated this event.
     *
     * @see {@link CDCEventSource}
     */
    source: CDCEventSource;
    /**
     * Unix timestamp in milliseconds when the event was created.
     */
    timestamp: number;
    /**
     * Event payload containing operation-specific data.
     */
    payload: CDCEventPayload;
    /**
     * Monotonically increasing sequence number within a capture session.
     * Used for ordering and deduplication.
     */
    sequence: number;
    /**
     * Schema version of the event format.
     * Used for backward compatibility during upgrades.
     */
    version: number;
}
/**
 * Configuration for the CDC pipeline.
 *
 * @description
 * Defines all configuration options for creating and running a CDC pipeline,
 * including batching behavior, retry policy, and output format.
 *
 * @example
 * ```typescript
 * const config: CDCPipelineConfig = {
 *   batchSize: 100,           // Flush every 100 events
 *   flushIntervalMs: 5000,    // Or every 5 seconds
 *   maxRetries: 3,            // Retry failed batches 3 times
 *   parquetCompression: 'snappy',
 *   outputPath: '/analytics/cdc',
 *   schemaVersion: 1
 * }
 * ```
 */
export interface CDCPipelineConfig {
    /**
     * Maximum number of events to batch before flushing.
     * Lower values reduce latency, higher values improve throughput.
     */
    batchSize: number;
    /**
     * Maximum time in milliseconds to wait before flushing a batch.
     * Ensures events are processed even with low throughput.
     */
    flushIntervalMs: number;
    /**
     * Maximum number of retry attempts for failed batch processing.
     * Uses exponential backoff between attempts.
     */
    maxRetries: number;
    /**
     * Compression algorithm for Parquet output.
     *
     * - `snappy`: Fast compression with moderate ratio (recommended)
     * - `gzip`: Higher compression ratio, slower
     * - `none`: No compression
     */
    parquetCompression: 'snappy' | 'gzip' | 'none';
    /**
     * Base path for output files.
     * Parquet files will be written to this directory.
     */
    outputPath: string;
    /**
     * Schema version for event format.
     * Used for backward compatibility during upgrades.
     */
    schemaVersion: number;
}
/**
 * Pipeline operational state.
 *
 * @description
 * Indicates the current state of the CDC pipeline.
 *
 * - `stopped`: Pipeline is not running, no events are processed
 * - `running`: Pipeline is active and processing events
 * - `paused`: Pipeline is temporarily suspended (reserved for future use)
 */
export type CDCPipelineState = 'stopped' | 'running' | 'paused';
/**
 * Configuration for event batching.
 *
 * @description
 * Controls how events are grouped into batches for processing.
 *
 * @example
 * ```typescript
 * const config: BatchConfig = {
 *   batchSize: 100,
 *   flushIntervalMs: 5000
 * }
 * ```
 */
export interface BatchConfig {
    /**
     * Maximum number of events per batch.
     */
    batchSize: number;
    /**
     * Maximum time to wait before flushing a partial batch.
     */
    flushIntervalMs: number;
}
/**
 * Result of a batch flush operation.
 *
 * @description
 * Contains the events in the batch and metadata about the batch
 * for downstream processing and monitoring.
 *
 * @example
 * ```typescript
 * batcher.onBatch((result: BatchResult) => {
 *   console.log(`Batch: ${result.eventCount} events`)
 *   console.log(`Sequences: ${result.minSequence} - ${result.maxSequence}`)
 *   console.log(`Time range: ${result.minTimestamp} - ${result.maxTimestamp}`)
 * })
 * ```
 */
export interface BatchResult {
    /**
     * Array of events in this batch.
     */
    events: CDCEvent[];
    /**
     * Number of events in the batch.
     */
    eventCount: number;
    /**
     * Whether the batch was processed successfully.
     */
    success: boolean;
    /**
     * Minimum sequence number in the batch.
     * Useful for tracking progress and resumption.
     */
    minSequence?: number;
    /**
     * Maximum sequence number in the batch.
     */
    maxSequence?: number;
    /**
     * Earliest event timestamp in the batch (milliseconds).
     */
    minTimestamp?: number;
    /**
     * Latest event timestamp in the batch (milliseconds).
     */
    maxTimestamp?: number;
}
/**
 * CDC Error types for categorizing failures.
 *
 * @description
 * Error codes that help identify the type of failure for
 * appropriate error handling and recovery strategies.
 *
 * - `VALIDATION_ERROR`: Event failed validation checks
 * - `PROCESSING_ERROR`: Error during event processing
 * - `SERIALIZATION_ERROR`: Error serializing/deserializing events
 * - `STORAGE_ERROR`: Error writing to storage
 * - `TIMEOUT_ERROR`: Operation timed out
 * - `BUFFER_OVERFLOW_ERROR`: Event buffer exceeded capacity
 * - `UNKNOWN_ERROR`: Unclassified error
 */
export type CDCErrorType = 'VALIDATION_ERROR' | 'PROCESSING_ERROR' | 'SERIALIZATION_ERROR' | 'STORAGE_ERROR' | 'TIMEOUT_ERROR' | 'BUFFER_OVERFLOW_ERROR' | 'UNKNOWN_ERROR';
/**
 * Field definition for Parquet schema.
 *
 * @description
 * Defines a single column in the Parquet output schema.
 */
export interface ParquetField {
    /**
     * Column name.
     */
    name: string;
    /**
     * Column data type (STRING, INT64, TIMESTAMP, etc.).
     */
    type: string;
    /**
     * Whether the column can contain null values.
     */
    nullable: boolean;
}
/**
 * Row representation for Parquet output.
 *
 * @description
 * Represents a single CDC event as a Parquet row with
 * flattened fields for efficient columnar storage.
 */
export interface ParquetRow {
    /**
     * Event unique identifier.
     */
    event_id: string;
    /**
     * Event type (e.g., 'COMMIT_CREATED').
     */
    event_type: string;
    /**
     * Event source (e.g., 'push').
     */
    source: string;
    /**
     * Event timestamp in milliseconds.
     */
    timestamp: number;
    /**
     * Event sequence number.
     */
    sequence: number;
    /**
     * Event schema version.
     */
    version: number;
    /**
     * JSON-serialized event payload.
     */
    payload_json: string;
    /**
     * SHA from the payload, extracted for efficient filtering.
     */
    sha: string | null;
}
/**
 * Batch of Parquet rows ready for writing.
 *
 * @description
 * Contains transformed rows and metadata needed to write
 * a Parquet file.
 */
export interface ParquetBatch {
    /**
     * Array of Parquet rows.
     */
    rows: ParquetRow[];
    /**
     * Number of rows in the batch.
     */
    rowCount: number;
    /**
     * Batch creation timestamp.
     */
    createdAt: number;
    /**
     * Parquet schema definition.
     */
    schema: {
        fields: ParquetField[];
    };
    /**
     * Compression algorithm used.
     */
    compression: string;
}
/**
 * Output from the CDC pipeline.
 *
 * @description
 * Contains the Parquet-formatted data and metadata for a
 * processed batch of events.
 *
 * @example
 * ```typescript
 * pipeline.onOutput((output: PipelineOutput) => {
 *   console.log(`Batch ID: ${output.batchId}`)
 *   console.log(`Events: ${output.events.length}`)
 *   console.log(`Size: ${output.parquetBuffer.length} bytes`)
 *
 *   // Write to storage
 *   await r2.put(`cdc/${output.batchId}.parquet`, output.parquetBuffer)
 * })
 * ```
 */
export interface PipelineOutput {
    /**
     * Parquet-formatted data as a byte array.
     */
    parquetBuffer: Uint8Array;
    /**
     * Original events included in this batch.
     */
    events: CDCEvent[];
    /**
     * Unique identifier for this batch.
     * Format: `batch-{timestamp}-{random}`
     */
    batchId: string;
}
/**
 * Metrics for monitoring pipeline performance.
 *
 * @description
 * Provides operational metrics for monitoring and alerting
 * on pipeline health and performance.
 *
 * @example
 * ```typescript
 * const metrics = pipeline.getMetrics()
 * console.log(`Events processed: ${metrics.eventsProcessed}`)
 * console.log(`Batches generated: ${metrics.batchesGenerated}`)
 * console.log(`Bytes written: ${metrics.bytesWritten}`)
 * console.log(`Errors: ${metrics.errors}`)
 * console.log(`Avg latency: ${metrics.avgProcessingLatencyMs}ms`)
 * ```
 */
export interface PipelineMetrics {
    /**
     * Total number of events processed.
     */
    eventsProcessed: number;
    /**
     * Total number of batches generated.
     */
    batchesGenerated: number;
    /**
     * Total bytes written to output.
     */
    bytesWritten: number;
    /**
     * Total number of errors encountered.
     */
    errors: number;
    /**
     * Average event processing latency in milliseconds.
     * Calculated from the last 1000 events.
     */
    avgProcessingLatencyMs: number;
}
/**
 * Result of processing a single event.
 *
 * @description
 * Returned when an event is successfully queued for processing.
 */
export interface ProcessResult {
    /**
     * Whether the event was successfully queued.
     */
    success: boolean;
    /**
     * ID of the processed event.
     */
    eventId: string;
}
/**
 * Result of stopping the pipeline.
 *
 * @description
 * Contains information about any pending events that were
 * flushed during shutdown.
 */
export interface StopResult {
    /**
     * Number of events flushed during stop.
     */
    flushedCount: number;
}
/**
 * Custom error class for CDC operations.
 *
 * @description
 * CDCError provides structured error information for CDC pipeline failures,
 * including an error type for programmatic handling and optional cause for
 * error chaining.
 *
 * @example
 * ```typescript
 * try {
 *   await pipeline.process(event)
 * } catch (error) {
 *   if (error instanceof CDCError) {
 *     switch (error.type) {
 *       case 'VALIDATION_ERROR':
 *         console.log('Invalid event:', error.message)
 *         break
 *       case 'PROCESSING_ERROR':
 *         console.log('Processing failed:', error.message)
 *         if (error.cause) {
 *           console.log('Caused by:', error.cause.message)
 *         }
 *         break
 *     }
 *   }
 * }
 * ```
 *
 * @class CDCError
 * @extends Error
 */
export declare class CDCError extends Error {
    readonly type: CDCErrorType;
    readonly cause?: Error | undefined;
    /**
     * Creates a new CDCError.
     *
     * @param type - Error type for categorization
     * @param message - Human-readable error message
     * @param cause - Optional underlying error that caused this error
     */
    constructor(type: CDCErrorType, message: string, cause?: Error | undefined);
}
/**
 * Configuration for the retry policy.
 *
 * @description
 * Configures exponential backoff behavior for failed operations.
 *
 * @example
 * ```typescript
 * const config: RetryPolicyConfig = {
 *   maxRetries: 3,
 *   initialDelayMs: 100,
 *   maxDelayMs: 5000,
 *   backoffMultiplier: 2,
 *   jitter: true  // Add randomness to prevent thundering herd
 * }
 * ```
 */
export interface RetryPolicyConfig {
    /**
     * Maximum number of retry attempts before giving up.
     */
    maxRetries: number;
    /**
     * Initial delay in milliseconds before first retry.
     */
    initialDelayMs: number;
    /**
     * Maximum delay in milliseconds between retries.
     * Caps exponential growth.
     */
    maxDelayMs: number;
    /**
     * Multiplier applied to delay after each attempt.
     * A value of 2 doubles the delay each time.
     */
    backoffMultiplier: number;
    /**
     * Whether to add random jitter to delays.
     * Helps prevent thundering herd problems.
     */
    jitter?: boolean;
}
/**
 * Retry policy implementing exponential backoff with optional jitter.
 *
 * @description
 * Provides a robust retry mechanism for handling transient failures.
 * Uses exponential backoff to space out retry attempts, with optional
 * jitter to prevent synchronized retries from multiple clients.
 *
 * **Backoff Formula:**
 * `delay = min(initialDelay * (multiplier ^ attempt), maxDelay)`
 *
 * **With Jitter:**
 * `delay = delay * random(0.5, 1.5)`
 *
 * @example
 * ```typescript
 * const policy = new CDCRetryPolicy({
 *   maxRetries: 3,
 *   initialDelayMs: 100,
 *   maxDelayMs: 5000,
 *   backoffMultiplier: 2,
 *   jitter: true
 * })
 *
 * let attempts = 0
 * while (attempts < 10) {
 *   try {
 *     await doOperation()
 *     break
 *   } catch (error) {
 *     attempts++
 *     if (!policy.shouldRetry(attempts)) {
 *       throw new Error('Max retries exceeded')
 *     }
 *     const delay = policy.getDelay(attempts)
 *     console.log(`Retry ${attempts} after ${delay}ms`)
 *     await sleep(delay)
 *   }
 * }
 * ```
 *
 * @class CDCRetryPolicy
 */
export declare class CDCRetryPolicy {
    /**
     * Retry configuration.
     * @private
     */
    private readonly config;
    /**
     * Creates a new retry policy.
     *
     * @param config - Retry policy configuration
     */
    constructor(config: RetryPolicyConfig);
    /**
     * Determines whether another retry should be attempted.
     *
     * @param attemptCount - Number of attempts already made
     * @returns true if more retries are allowed, false otherwise
     *
     * @example
     * ```typescript
     * if (policy.shouldRetry(3)) {
     *   // Retry is allowed
     * }
     * ```
     */
    shouldRetry(attemptCount: number): boolean;
    /**
     * Calculates the delay before the next retry.
     *
     * @description
     * Computes delay using exponential backoff, capped at maxDelayMs.
     * If jitter is enabled, applies a random factor between 0.5x and 1.5x.
     *
     * @param attemptCount - Number of attempts already made (1-indexed)
     * @returns Delay in milliseconds before next retry
     *
     * @example
     * ```typescript
     * // With initialDelay=100, multiplier=2:
     * // Attempt 1: 100ms * 2^0 = 100ms
     * // Attempt 2: 100ms * 2^1 = 200ms
     * // Attempt 3: 100ms * 2^2 = 400ms
     * const delay = policy.getDelay(attemptCount)
     * await sleep(delay)
     * ```
     */
    getDelay(attemptCount: number): number;
}
/**
 * Configuration options for CDC event capture.
 *
 * @example
 * ```typescript
 * const options: CDCEventCaptureOptions = {
 *   maxBufferSize: 1000  // Auto-flush when buffer reaches 1000 events
 * }
 * ```
 */
export interface CDCEventCaptureOptions {
    /**
     * Maximum number of events to buffer before auto-flushing.
     * Defaults to Infinity (no auto-flush).
     */
    maxBufferSize?: number;
}
/**
 * Callback function for git operation events.
 *
 * @param event - The captured CDC event
 */
export type GitOperationListener = (event: CDCEvent) => void;
/**
 * Captures git operations and converts them to CDC events.
 *
 * @description
 * CDCEventCapture hooks into git operations and generates CDCEvents for each
 * operation. It maintains an internal buffer of events that can be flushed
 * manually or automatically when the buffer reaches a configured size.
 *
 * **Supported Operations:**
 * - Object creation/deletion (blobs, trees, commits, tags)
 * - Reference updates (branches, tags)
 * - Commit creation
 * - Pack reception
 * - Branch creation/deletion
 * - Tag creation
 * - Merge completion
 *
 * **Event Ordering:**
 * Events are assigned monotonically increasing sequence numbers within a
 * capture session. This ensures proper ordering for replay and analytics.
 *
 * @example
 * ```typescript
 * const capture = new CDCEventCapture({ maxBufferSize: 100 })
 *
 * // Add a listener for real-time processing
 * capture.addListener((event) => {
 *   console.log(`Event: ${event.type} - ${event.id}`)
 * })
 *
 * // Capture git operations
 * await capture.onCommitCreated('abc123...', 'tree456...', ['parent789...'])
 * await capture.onRefUpdate('refs/heads/main', 'old...', 'new...')
 *
 * // Get buffered events
 * console.log(`Buffer size: ${capture.getBufferSize()}`)
 *
 * // Flush buffer
 * const events = await capture.flush()
 * console.log(`Flushed ${events.length} events`)
 * ```
 *
 * @class CDCEventCapture
 */
export declare class CDCEventCapture {
    /**
     * Buffer of captured events.
     * @private
     */
    private events;
    /**
     * Monotonically increasing sequence counter.
     * @private
     */
    private sequenceCounter;
    /**
     * Registered event listeners.
     * @private
     */
    private listeners;
    /**
     * Maximum buffer size before auto-flush.
     * @private
     */
    private readonly maxBufferSize;
    /**
     * Creates a new CDC event capture instance.
     *
     * @param options - Configuration options
     */
    constructor(options?: CDCEventCaptureOptions);
    /**
     * Generates a unique event ID.
     * @private
     */
    private generateEventId;
    /**
     * Emits an event to the buffer and notifies listeners.
     * @private
     */
    private emitEvent;
    /**
     * Returns the next sequence number.
     * @private
     */
    private nextSequence;
    /**
     * Captures an object put (creation) operation.
     *
     * @description
     * Called when a git object (blob, tree, commit, tag) is written to storage.
     *
     * @param sha - SHA-1 hash of the object
     * @param type - Object type (blob, tree, commit, tag)
     * @param data - Raw object data
     *
     * @example
     * ```typescript
     * await capture.onObjectPut('abc123...', 'blob', blobData)
     * ```
     */
    onObjectPut(sha: string, type: string, data: Uint8Array): Promise<void>;
    /**
     * Captures an object deletion operation.
     *
     * @description
     * Called when a git object is deleted, typically during garbage collection.
     *
     * @param sha - SHA-1 hash of the deleted object
     *
     * @example
     * ```typescript
     * await capture.onObjectDelete('abc123...')
     * ```
     */
    onObjectDelete(sha: string): Promise<void>;
    /**
     * Captures a reference update operation.
     *
     * @description
     * Called when a git reference (branch, tag) is updated to point to a new commit.
     *
     * @param refName - Full reference name (e.g., 'refs/heads/main')
     * @param oldSha - Previous SHA (all zeros for new refs)
     * @param newSha - New SHA (all zeros for deleted refs)
     *
     * @example
     * ```typescript
     * await capture.onRefUpdate(
     *   'refs/heads/main',
     *   'oldcommit123...',
     *   'newcommit456...'
     * )
     * ```
     */
    onRefUpdate(refName: string, oldSha: string, newSha: string): Promise<void>;
    /**
     * Captures a commit creation operation.
     *
     * @description
     * Called when a new commit object is created.
     *
     * @param commitSha - SHA-1 hash of the commit
     * @param treeSha - SHA-1 hash of the tree the commit points to
     * @param parentShas - Array of parent commit SHAs
     *
     * @example
     * ```typescript
     * await capture.onCommitCreated(
     *   'commitabc123...',
     *   'treedef456...',
     *   ['parent1...', 'parent2...']
     * )
     * ```
     */
    onCommitCreated(commitSha: string, treeSha: string, parentShas: string[]): Promise<void>;
    /**
     * Captures a pack reception operation.
     *
     * @description
     * Called when a packfile is received during a push or fetch operation.
     *
     * @param packData - Raw packfile data
     * @param objectCount - Number of objects in the pack
     *
     * @example
     * ```typescript
     * await capture.onPackReceived(packBuffer, 42)
     * ```
     */
    onPackReceived(packData: Uint8Array, objectCount: number): Promise<void>;
    /**
     * Captures a branch creation operation.
     *
     * @param branchName - Name of the branch (without refs/heads/ prefix)
     * @param sha - SHA-1 hash the branch points to
     *
     * @example
     * ```typescript
     * await capture.onBranchCreated('feature-x', 'abc123...')
     * ```
     */
    onBranchCreated(branchName: string, sha: string): Promise<void>;
    /**
     * Captures a branch deletion operation.
     *
     * @param branchName - Name of the deleted branch
     *
     * @example
     * ```typescript
     * await capture.onBranchDeleted('feature-x')
     * ```
     */
    onBranchDeleted(branchName: string): Promise<void>;
    /**
     * Captures a tag creation operation.
     *
     * @param tagName - Name of the tag
     * @param sha - SHA-1 hash the tag points to
     *
     * @example
     * ```typescript
     * await capture.onTagCreated('v1.0.0', 'abc123...')
     * ```
     */
    onTagCreated(tagName: string, sha: string): Promise<void>;
    /**
     * Captures a merge completion operation.
     *
     * @param mergeSha - SHA-1 hash of the merge commit
     * @param baseSha - SHA-1 hash of the base commit
     * @param headSha - SHA-1 hash of the head commit being merged
     *
     * @example
     * ```typescript
     * await capture.onMergeCompleted('merge123...', 'base456...', 'head789...')
     * ```
     */
    onMergeCompleted(mergeSha: string, baseSha: string, headSha: string): Promise<void>;
    /**
     * Returns a copy of all buffered events.
     *
     * @returns Array of buffered events
     */
    getEvents(): CDCEvent[];
    /**
     * Returns the current buffer size.
     *
     * @returns Number of events in the buffer
     */
    getBufferSize(): number;
    /**
     * Flushes all buffered events.
     *
     * @description
     * Returns and clears all events from the buffer. The returned events
     * can be processed, serialized, or forwarded to downstream systems.
     *
     * @returns Array of flushed events
     *
     * @example
     * ```typescript
     * const events = await capture.flush()
     * console.log(`Flushed ${events.length} events`)
     * await sendToAnalytics(events)
     * ```
     */
    flush(): Promise<CDCEvent[]>;
    /**
     * Adds an event listener.
     *
     * @description
     * Listeners are called synchronously for each event as it is captured.
     *
     * @param listener - Callback function to invoke for each event
     *
     * @example
     * ```typescript
     * capture.addListener((event) => {
     *   console.log(`New event: ${event.type}`)
     * })
     * ```
     */
    addListener(listener: GitOperationListener): void;
    /**
     * Removes an event listener.
     *
     * @param listener - The listener to remove
     */
    removeListener(listener: GitOperationListener): void;
}
/**
 * Parquet schema definition for CDC events.
 *
 * @description
 * Defines the column structure for CDC event Parquet files. The default
 * schema includes standard CDC event fields and can be extended with
 * custom fields for domain-specific data.
 *
 * @example
 * ```typescript
 * // Create default schema
 * const schema = ParquetSchema.forCDCEvents()
 *
 * // Create schema with custom fields
 * const customSchema = ParquetSchema.forCDCEvents([
 *   { name: 'repository_id', type: 'STRING', nullable: false },
 *   { name: 'user_id', type: 'STRING', nullable: true }
 * ])
 * ```
 *
 * @class ParquetSchema
 */
export declare class ParquetSchema {
    readonly fields: ParquetField[];
    /**
     * Creates a new ParquetSchema.
     *
     * @param fields - Array of field definitions
     */
    constructor(fields: ParquetField[]);
    /**
     * Creates a schema for CDC events with optional custom fields.
     *
     * @description
     * Returns a schema with the standard CDC event fields. Additional
     * custom fields can be appended for domain-specific data.
     *
     * @param customFields - Optional additional fields to add
     * @returns A new ParquetSchema instance
     *
     * @example
     * ```typescript
     * const schema = ParquetSchema.forCDCEvents()
     * // Schema includes: event_id, event_type, source, timestamp,
     * //                  sequence, version, payload_json, sha
     * ```
     */
    static forCDCEvents(customFields?: ParquetField[]): ParquetSchema;
}
/**
 * Configuration options for the Parquet transformer.
 */
export interface ParquetTransformerOptions {
    /**
     * Compression algorithm to use.
     * @default 'snappy'
     */
    compression?: 'snappy' | 'gzip' | 'none';
}
/**
 * Transforms CDC events to Parquet format.
 *
 * @description
 * ParquetTransformer converts CDC events to Parquet-compatible rows and
 * serializes batches of events to Parquet file format. It handles:
 *
 * - Event to row conversion (flattening the event structure)
 * - JSON serialization of complex payloads
 * - Batch creation with schema and metadata
 * - Parquet file generation with compression
 *
 * @example
 * ```typescript
 * const transformer = new ParquetTransformer({ compression: 'snappy' })
 *
 * // Transform single event to row
 * const row = transformer.eventToRow(event)
 *
 * // Transform batch of events
 * const batch = transformer.eventsToBatch(events)
 *
 * // Generate Parquet file
 * const buffer = await transformer.toParquetBuffer(batch)
 * await r2.put('events.parquet', buffer)
 * ```
 *
 * @class ParquetTransformer
 */
export declare class ParquetTransformer {
    /**
     * Compression algorithm to use.
     * @private
     */
    private readonly compression;
    /**
     * Creates a new ParquetTransformer.
     *
     * @param options - Transformer configuration
     */
    constructor(options?: ParquetTransformerOptions);
    /**
     * Converts a CDC event to a Parquet row.
     *
     * @description
     * Flattens the event structure and serializes the payload to JSON
     * for storage in Parquet format.
     *
     * @param event - The CDC event to convert
     * @returns A Parquet row representation
     *
     * @example
     * ```typescript
     * const row = transformer.eventToRow(event)
     * console.log(row.event_id, row.event_type, row.sha)
     * ```
     */
    eventToRow(event: CDCEvent): ParquetRow;
    /**
     * Converts multiple CDC events to a Parquet batch.
     *
     * @description
     * Transforms an array of events into a ParquetBatch structure
     * ready for serialization to Parquet format.
     *
     * @param events - Array of CDC events to batch
     * @returns A ParquetBatch ready for serialization
     *
     * @example
     * ```typescript
     * const batch = transformer.eventsToBatch(events)
     * console.log(`Batch has ${batch.rowCount} rows`)
     * ```
     */
    eventsToBatch(events: CDCEvent[]): ParquetBatch;
    /**
     * Serializes a ParquetBatch to a Parquet file buffer.
     *
     * @description
     * Generates a Parquet-format file from the batch data. The output
     * includes PAR1 magic bytes, compressed data, and footer metadata.
     *
     * @param batch - The ParquetBatch to serialize
     * @returns Promise resolving to Parquet file as Uint8Array
     *
     * @example
     * ```typescript
     * const buffer = await transformer.toParquetBuffer(batch)
     * await r2.put('events.parquet', buffer)
     * ```
     */
    toParquetBuffer(batch: ParquetBatch): Promise<Uint8Array>;
    private gzipCompress;
    private simpleCompress;
}
/**
 * Callback function for batch processing.
 *
 * @param batch - The batch result containing events and metadata
 * @returns void or a Promise that resolves when processing is complete
 */
type BatchHandler = (batch: BatchResult) => void | Promise<void>;
/**
 * Batches CDC events for efficient processing.
 *
 * @description
 * CDCBatcher collects CDC events and groups them into batches based on
 * count or time thresholds. This enables efficient downstream processing
 * by reducing the number of I/O operations and enabling bulk operations.
 *
 * **Batching Strategies:**
 * - **Count-based**: Flush when batch reaches `batchSize` events
 * - **Time-based**: Flush after `flushIntervalMs` even if batch is not full
 *
 * **Features:**
 * - Async batch handlers for non-blocking processing
 * - Multiple handlers for parallel processing pipelines
 * - Graceful stop with pending event flush
 * - Batch metadata (sequences, timestamps) for tracking
 *
 * @example
 * ```typescript
 * const batcher = new CDCBatcher({
 *   batchSize: 100,
 *   flushIntervalMs: 5000
 * })
 *
 * // Register batch handler
 * batcher.onBatch(async (batch) => {
 *   console.log(`Processing ${batch.eventCount} events`)
 *   console.log(`Sequence range: ${batch.minSequence} - ${batch.maxSequence}`)
 *   await saveToStorage(batch.events)
 * })
 *
 * // Add events
 * await batcher.add(event1)
 * await batcher.add(event2)
 *
 * // Check pending events
 * console.log(`Pending: ${batcher.getPendingCount()}`)
 *
 * // Manual flush
 * const result = await batcher.flush()
 *
 * // Stop the batcher
 * await batcher.stop()
 * ```
 *
 * @class CDCBatcher
 */
export declare class CDCBatcher {
    /**
     * Batch configuration.
     * @private
     */
    private readonly config;
    /**
     * Buffer of pending events.
     * @private
     */
    private events;
    /**
     * Registered batch handlers.
     * @private
     */
    private batchHandlers;
    /**
     * Timer for time-based flushing.
     * @private
     */
    private flushTimer;
    /**
     * Whether the batcher has been stopped.
     * @private
     */
    private stopped;
    /**
     * Creates a new CDCBatcher.
     *
     * @param config - Batch configuration
     */
    constructor(config: BatchConfig);
    private ensureTimerRunning;
    private clearFlushTimer;
    /**
     * Adds an event to the batch.
     *
     * @description
     * Adds the event to the pending batch. If the batch reaches the
     * configured size, it is automatically flushed. The flush timer
     * is started/restarted as needed.
     *
     * @param event - The CDC event to add
     *
     * @example
     * ```typescript
     * await batcher.add(event)
     * ```
     */
    add(event: CDCEvent): Promise<void>;
    /**
     * Internal flush implementation.
     * @private
     */
    private flushInternal;
    /**
     * Manually flushes pending events.
     *
     * @description
     * Forces an immediate flush of all pending events, regardless of
     * batch size or timer. Clears the flush timer.
     *
     * @returns Promise resolving to the batch result
     *
     * @example
     * ```typescript
     * const result = await batcher.flush()
     * console.log(`Flushed ${result.eventCount} events`)
     * ```
     */
    flush(): Promise<BatchResult>;
    /**
     * Returns the number of pending events.
     *
     * @returns Number of events waiting to be flushed
     */
    getPendingCount(): number;
    /**
     * Registers a batch handler.
     *
     * @description
     * Handlers are called when a batch is flushed (automatically or manually).
     * Multiple handlers can be registered for parallel processing.
     *
     * @param handler - Callback function to invoke for each batch
     *
     * @example
     * ```typescript
     * batcher.onBatch(async (batch) => {
     *   await saveToStorage(batch.events)
     * })
     * ```
     */
    onBatch(handler: BatchHandler): void;
    /**
     * Stops the batcher.
     *
     * @description
     * Stops the flush timer and prevents further processing.
     * Does NOT automatically flush pending events - call flush() first
     * if you need to process remaining events.
     *
     * @example
     * ```typescript
     * await batcher.flush()  // Process remaining events
     * await batcher.stop()   // Stop the timer
     * ```
     */
    stop(): Promise<void>;
}
/**
 * Callback for successful batch output.
 *
 * @param output - The pipeline output containing Parquet data
 */
type OutputHandler = (output: PipelineOutput) => void;
/**
 * Callback for failed events sent to dead letter queue.
 *
 * @param events - Array of failed events
 * @param error - The error that caused the failure
 */
type DeadLetterHandler = (events: CDCEvent[], error: Error) => void;
/**
 * Main CDC Pipeline for processing git operation events.
 *
 * @description
 * CDCPipeline orchestrates the complete change data capture flow from
 * event ingestion to Parquet output. It integrates batching, transformation,
 * retry handling, and dead letter queue management.
 *
 * **Pipeline Flow:**
 * 1. Events are submitted via `process()` or `processMany()`
 * 2. Events are validated and added to the batcher
 * 3. When a batch is ready, it's transformed to Parquet format
 * 4. On success, output handlers are notified
 * 5. On failure, retries are attempted with exponential backoff
 * 6. After max retries, events go to dead letter queue
 *
 * **Features:**
 * - Configurable batch size and flush interval
 * - Automatic retry with exponential backoff
 * - Dead letter queue for failed events
 * - Real-time metrics for monitoring
 * - Graceful shutdown with pending event flush
 *
 * @example
 * ```typescript
 * const pipeline = new CDCPipeline({
 *   batchSize: 100,
 *   flushIntervalMs: 5000,
 *   maxRetries: 3,
 *   parquetCompression: 'snappy',
 *   outputPath: '/analytics',
 *   schemaVersion: 1
 * })
 *
 * // Register handlers
 * pipeline.onOutput(async (output) => {
 *   await r2.put(`cdc/${output.batchId}.parquet`, output.parquetBuffer)
 * })
 *
 * pipeline.onDeadLetter((events, error) => {
 *   console.error(`Failed ${events.length} events:`, error)
 * })
 *
 * // Start the pipeline
 * await pipeline.start()
 *
 * // Process events
 * await pipeline.process(event)
 *
 * // Check metrics
 * const metrics = pipeline.getMetrics()
 *
 * // Stop gracefully
 * const result = await pipeline.stop()
 * console.log(`Flushed ${result.flushedCount} events on shutdown`)
 * ```
 *
 * @class CDCPipeline
 */
export declare class CDCPipeline {
    /**
     * Pipeline configuration.
     * @private
     */
    private readonly config;
    /**
     * Current pipeline state.
     * @private
     */
    private state;
    /**
     * Event batcher instance.
     * @private
     */
    private batcher;
    /**
     * Parquet transformer instance.
     * @private
     */
    private transformer;
    /**
     * Registered output handlers.
     * @private
     */
    private outputHandlers;
    /**
     * Registered dead letter handlers.
     * @private
     */
    private deadLetterHandlers;
    /**
     * Pipeline metrics.
     * @private
     */
    private metrics;
    /**
     * Processing latency samples.
     * @private
     */
    private processingLatencies;
    /**
     * Retry policy instance.
     * @private
     */
    private retryPolicy;
    /**
     * Creates a new CDCPipeline.
     *
     * @param config - Pipeline configuration
     */
    constructor(config: CDCPipelineConfig);
    /**
     * Returns the current pipeline state.
     *
     * @returns Current state ('stopped', 'running', or 'paused')
     */
    getState(): CDCPipelineState;
    /**
     * Starts the pipeline.
     *
     * @description
     * Initializes the batcher and begins accepting events. If already
     * running, this method is a no-op.
     *
     * @example
     * ```typescript
     * await pipeline.start()
     * console.log(pipeline.getState())  // 'running'
     * ```
     */
    start(): Promise<void>;
    /**
     * Stops the pipeline.
     *
     * @description
     * Flushes any pending events, stops the batcher, and sets state to stopped.
     * Returns information about events flushed during shutdown.
     *
     * @returns Promise resolving to stop result with flushed event count
     *
     * @example
     * ```typescript
     * const result = await pipeline.stop()
     * console.log(`Flushed ${result.flushedCount} events on shutdown`)
     * ```
     */
    stop(): Promise<StopResult>;
    /**
     * Processes a single event.
     *
     * @description
     * Validates the event and adds it to the batcher for processing.
     * Updates metrics including latency tracking.
     *
     * @param event - The CDC event to process
     * @returns Promise resolving to process result
     *
     * @throws {CDCError} PROCESSING_ERROR - If pipeline is not running
     * @throws {CDCError} VALIDATION_ERROR - If event fails validation
     *
     * @example
     * ```typescript
     * const result = await pipeline.process(event)
     * if (result.success) {
     *   console.log(`Processed event: ${result.eventId}`)
     * }
     * ```
     */
    process(event: CDCEvent): Promise<ProcessResult>;
    /**
     * Processes multiple events.
     *
     * @description
     * Convenience method to process an array of events sequentially.
     *
     * @param events - Array of CDC events to process
     * @returns Promise resolving to array of process results
     *
     * @example
     * ```typescript
     * const results = await pipeline.processMany(events)
     * const successCount = results.filter(r => r.success).length
     * console.log(`Processed ${successCount}/${events.length} events`)
     * ```
     */
    processMany(events: CDCEvent[]): Promise<ProcessResult[]>;
    /**
     * Manually flushes pending events.
     *
     * @description
     * Forces an immediate flush of the batcher and processes the
     * resulting batch through the pipeline.
     *
     * @example
     * ```typescript
     * await pipeline.flush()
     * console.log('All pending events flushed')
     * ```
     */
    flush(): Promise<void>;
    /**
     * Handles a batch of events with retry logic.
     * @private
     */
    private handleBatch;
    /**
     * Sleeps for the specified duration.
     * @private
     */
    private sleep;
    /**
     * Updates the average latency metric.
     * @private
     */
    private updateAvgLatency;
    /**
     * Returns current pipeline metrics.
     *
     * @description
     * Returns a copy of the current metrics. Metrics are cumulative
     * since pipeline creation.
     *
     * @returns Copy of current pipeline metrics
     *
     * @example
     * ```typescript
     * const metrics = pipeline.getMetrics()
     * console.log(`Processed: ${metrics.eventsProcessed}`)
     * console.log(`Batches: ${metrics.batchesGenerated}`)
     * console.log(`Errors: ${metrics.errors}`)
     * console.log(`Avg latency: ${metrics.avgProcessingLatencyMs}ms`)
     * ```
     */
    getMetrics(): PipelineMetrics;
    /**
     * Registers an output handler.
     *
     * @description
     * Output handlers are called when a batch is successfully processed
     * and converted to Parquet format. Multiple handlers can be registered.
     *
     * @param handler - Callback to invoke for each successful batch
     *
     * @example
     * ```typescript
     * pipeline.onOutput(async (output) => {
     *   await r2.put(`cdc/${output.batchId}.parquet`, output.parquetBuffer)
     *   console.log(`Wrote ${output.events.length} events`)
     * })
     * ```
     */
    onOutput(handler: OutputHandler): void;
    /**
     * Registers a dead letter handler.
     *
     * @description
     * Dead letter handlers are called when a batch fails after all
     * retry attempts are exhausted. Use this for alerting, logging,
     * or storing failed events for later reprocessing.
     *
     * @param handler - Callback to invoke for failed events
     *
     * @example
     * ```typescript
     * pipeline.onDeadLetter((events, error) => {
     *   console.error(`Failed to process ${events.length} events:`, error)
     *   // Store in dead letter queue for later retry
     *   await dlq.put(events)
     * })
     * ```
     */
    onDeadLetter(handler: DeadLetterHandler): void;
}
/**
 * Creates a new CDC event.
 *
 * @description
 * Factory function to create a properly structured CDC event with
 * automatically generated ID and timestamp.
 *
 * @param type - The event type
 * @param source - The event source
 * @param payload - Event payload data
 * @param options - Optional configuration
 * @param options.sequence - Custom sequence number (default: 0)
 * @returns A new CDCEvent
 *
 * @example
 * ```typescript
 * const event = createCDCEvent('COMMIT_CREATED', 'push', {
 *   operation: 'commit-create',
 *   sha: 'abc123...',
 *   treeSha: 'def456...',
 *   parentShas: ['parent1...']
 * })
 *
 * // With sequence number
 * const sequencedEvent = createCDCEvent('REF_UPDATED', 'push', {
 *   operation: 'ref-update',
 *   refName: 'refs/heads/main',
 *   oldSha: 'old...',
 *   newSha: 'new...'
 * }, { sequence: 42 })
 * ```
 */
export declare function createCDCEvent(type: CDCEventType, source: CDCEventSource, payload: CDCEventPayload, options?: {
    sequence?: number;
}): CDCEvent;
/**
 * Serializes a CDC event to bytes.
 *
 * @description
 * Converts a CDCEvent to a JSON-encoded Uint8Array for storage or
 * transmission. Handles Uint8Array payload data by converting to arrays.
 *
 * @param event - The CDC event to serialize
 * @returns The serialized event as a Uint8Array
 *
 * @example
 * ```typescript
 * const bytes = serializeEvent(event)
 * await r2.put(`events/${event.id}`, bytes)
 * ```
 *
 * @see {@link deserializeEvent} - Reverse operation
 */
export declare function serializeEvent(event: CDCEvent): Uint8Array;
/**
 * Deserializes bytes to a CDC event.
 *
 * @description
 * Reconstructs a CDCEvent from JSON-encoded bytes. Handles Uint8Array
 * restoration for payload data that was converted to arrays during
 * serialization.
 *
 * @param bytes - The serialized event bytes
 * @returns The deserialized CDCEvent
 *
 * @example
 * ```typescript
 * const bytes = await r2.get(`events/${eventId}`)
 * const event = deserializeEvent(bytes)
 * console.log(`Event type: ${event.type}`)
 * ```
 *
 * @see {@link serializeEvent} - Reverse operation
 */
export declare function deserializeEvent(bytes: Uint8Array): CDCEvent;
/**
 * Validates a CDC event.
 *
 * @description
 * Checks that an event has all required fields and valid values.
 * Throws a CDCError if validation fails.
 *
 * **Validation Rules:**
 * - Event must not be null/undefined
 * - Event ID must be a non-empty string
 * - Event type must be a valid CDCEventType
 * - Timestamp must be a non-negative number
 * - Sequence must be a non-negative number
 *
 * @param event - The CDC event to validate
 * @returns The validated event (for chaining)
 *
 * @throws {CDCError} VALIDATION_ERROR - If validation fails
 *
 * @example
 * ```typescript
 * try {
 *   validateCDCEvent(event)
 *   // Event is valid
 * } catch (error) {
 *   if (error instanceof CDCError) {
 *     console.log(`Invalid: ${error.message}`)
 *   }
 * }
 * ```
 */
export declare function validateCDCEvent(event: CDCEvent): CDCEvent;
/**
 * Starts a new pipeline with the given configuration.
 *
 * @description
 * Creates and starts a new CDCPipeline, registering it by ID for
 * later access. If a pipeline with the same ID already exists,
 * it will be replaced (the old pipeline is not automatically stopped).
 *
 * @param id - Unique identifier for the pipeline
 * @param config - Pipeline configuration
 * @returns The started pipeline instance
 *
 * @example
 * ```typescript
 * const pipeline = startPipeline('main', {
 *   batchSize: 100,
 *   flushIntervalMs: 5000,
 *   maxRetries: 3,
 *   parquetCompression: 'snappy',
 *   outputPath: '/analytics',
 *   schemaVersion: 1
 * })
 *
 * // Register handlers
 * pipeline.onOutput((output) => console.log(`Batch: ${output.batchId}`))
 * ```
 */
export declare function startPipeline(id: string, config: CDCPipelineConfig): CDCPipeline;
/**
 * Stops a pipeline by ID.
 *
 * @description
 * Stops the pipeline identified by the given ID, flushing any pending
 * events and removing it from the registry.
 *
 * @param id - Pipeline identifier
 * @returns Promise resolving to stop result (0 if pipeline not found)
 *
 * @example
 * ```typescript
 * const result = await stopPipeline('main')
 * console.log(`Flushed ${result.flushedCount} events on shutdown`)
 * ```
 */
export declare function stopPipeline(id: string): Promise<StopResult>;
/**
 * Flushes a pipeline by ID.
 *
 * @description
 * Forces an immediate flush of all pending events in the pipeline.
 * No-op if pipeline not found.
 *
 * @param id - Pipeline identifier
 *
 * @example
 * ```typescript
 * await flushPipeline('main')
 * console.log('All pending events flushed')
 * ```
 */
export declare function flushPipeline(id: string): Promise<void>;
/**
 * Gets metrics for a pipeline by ID.
 *
 * @description
 * Returns a copy of the current metrics for the specified pipeline.
 * Returns null if the pipeline is not found.
 *
 * @param id - Pipeline identifier
 * @returns Pipeline metrics or null if not found
 *
 * @example
 * ```typescript
 * const metrics = getPipelineMetrics('main')
 * if (metrics) {
 *   console.log(`Events processed: ${metrics.eventsProcessed}`)
 *   console.log(`Errors: ${metrics.errors}`)
 * }
 * ```
 */
export declare function getPipelineMetrics(id: string): PipelineMetrics | null;
export {};
//# sourceMappingURL=cdc-pipeline.d.ts.map