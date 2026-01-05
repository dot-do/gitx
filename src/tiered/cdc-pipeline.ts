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

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * CDC Event Types representing different git operations
 */
export type CDCEventType =
  | 'OBJECT_CREATED'
  | 'OBJECT_DELETED'
  | 'REF_UPDATED'
  | 'PACK_RECEIVED'
  | 'COMMIT_CREATED'
  | 'TREE_MODIFIED'
  | 'BRANCH_CREATED'
  | 'BRANCH_DELETED'
  | 'TAG_CREATED'
  | 'MERGE_COMPLETED'

/**
 * CDC Event Source indicating origin of the event
 */
export type CDCEventSource = 'push' | 'fetch' | 'internal' | 'replication' | 'gc'

/**
 * Payload for CDC events
 */
export interface CDCEventPayload {
  operation: string
  sha?: string
  timestamp?: number
  data?: Uint8Array
  metadata?: Record<string, unknown>
  refName?: string
  oldSha?: string
  newSha?: string
  objectCount?: number
  treeSha?: string
  parentShas?: string[]
  branchName?: string
  tagName?: string
  baseSha?: string
  headSha?: string
}

/**
 * CDC Event structure
 */
export interface CDCEvent {
  id: string
  type: CDCEventType
  source: CDCEventSource
  timestamp: number
  payload: CDCEventPayload
  sequence: number
  version: number
}

/**
 * Pipeline configuration
 */
export interface CDCPipelineConfig {
  batchSize: number
  flushIntervalMs: number
  maxRetries: number
  parquetCompression: 'snappy' | 'gzip' | 'none'
  outputPath: string
  schemaVersion: number
}

/**
 * Pipeline state
 */
export type CDCPipelineState = 'stopped' | 'running' | 'paused'

/**
 * Batch configuration
 */
export interface BatchConfig {
  batchSize: number
  flushIntervalMs: number
}

/**
 * Batch result metadata
 */
export interface BatchResult {
  events: CDCEvent[]
  eventCount: number
  success: boolean
  minSequence?: number
  maxSequence?: number
  minTimestamp?: number
  maxTimestamp?: number
}

/**
 * CDC Error types
 */
export type CDCErrorType =
  | 'VALIDATION_ERROR'
  | 'PROCESSING_ERROR'
  | 'SERIALIZATION_ERROR'
  | 'STORAGE_ERROR'
  | 'TIMEOUT_ERROR'
  | 'BUFFER_OVERFLOW_ERROR'
  | 'UNKNOWN_ERROR'

/**
 * Parquet field definition
 */
export interface ParquetField {
  name: string
  type: string
  nullable: boolean
}

/**
 * Parquet row representation
 */
export interface ParquetRow {
  event_id: string
  event_type: string
  source: string
  timestamp: number
  sequence: number
  version: number
  payload_json: string
  sha: string | null
}

/**
 * Parquet batch representation
 */
export interface ParquetBatch {
  rows: ParquetRow[]
  rowCount: number
  createdAt: number
  schema: { fields: ParquetField[] }
  compression: string
}

/**
 * Pipeline output
 */
export interface PipelineOutput {
  parquetBuffer: Uint8Array
  events: CDCEvent[]
  batchId: string
}

/**
 * Pipeline metrics
 */
export interface PipelineMetrics {
  eventsProcessed: number
  batchesGenerated: number
  bytesWritten: number
  errors: number
  avgProcessingLatencyMs: number
}

/**
 * Process result
 */
export interface ProcessResult {
  success: boolean
  eventId: string
}

/**
 * Stop result
 */
export interface StopResult {
  flushedCount: number
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Custom error class for CDC operations
 */
export class CDCError extends Error {
  constructor(
    public readonly type: CDCErrorType,
    message: string,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'CDCError'
  }
}

// ============================================================================
// Retry Policy
// ============================================================================

export interface RetryPolicyConfig {
  maxRetries: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
  jitter?: boolean
}

/**
 * Retry policy with exponential backoff
 */
export class CDCRetryPolicy {
  private readonly config: RetryPolicyConfig

  constructor(config: RetryPolicyConfig) {
    this.config = config
  }

  shouldRetry(attemptCount: number): boolean {
    return attemptCount < this.config.maxRetries
  }

  getDelay(attemptCount: number): number {
    let delay = this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, attemptCount)
    delay = Math.min(delay, this.config.maxDelayMs)

    if (this.config.jitter) {
      // Add random jitter between 0.5x and 1.5x
      const jitterFactor = 0.5 + Math.random()
      delay = Math.floor(delay * jitterFactor)
    }

    return delay
  }
}

// ============================================================================
// Event Capture Options
// ============================================================================

export interface CDCEventCaptureOptions {
  maxBufferSize?: number
}

export type GitOperationListener = (event: CDCEvent) => void

// ============================================================================
// CDC Event Capture
// ============================================================================

/**
 * Captures git operations and converts them to CDC events
 */
export class CDCEventCapture {
  private events: CDCEvent[] = []
  private sequenceCounter = 0
  private listeners: GitOperationListener[] = []
  private readonly maxBufferSize: number

  constructor(options: CDCEventCaptureOptions = {}) {
    this.maxBufferSize = options.maxBufferSize ?? Infinity
  }

  private generateEventId(): string {
    return `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  private async emitEvent(event: CDCEvent): Promise<void> {
    // Auto-flush if buffer is full
    if (this.events.length >= this.maxBufferSize) {
      await this.flush()
    }

    this.events.push(event)

    // Notify all listeners
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private nextSequence(): number {
    return ++this.sequenceCounter
  }

  async onObjectPut(sha: string, type: string, data: Uint8Array): Promise<void> {
    const event: CDCEvent = {
      id: this.generateEventId(),
      type: 'OBJECT_CREATED',
      source: 'push',
      timestamp: Date.now(),
      payload: {
        operation: 'put',
        sha,
        data,
        metadata: { type, size: data.length }
      },
      sequence: this.nextSequence(),
      version: 1
    }
    await this.emitEvent(event)
  }

  async onObjectDelete(sha: string): Promise<void> {
    const event: CDCEvent = {
      id: this.generateEventId(),
      type: 'OBJECT_DELETED',
      source: 'gc',
      timestamp: Date.now(),
      payload: {
        operation: 'delete',
        sha
      },
      sequence: this.nextSequence(),
      version: 1
    }
    await this.emitEvent(event)
  }

  async onRefUpdate(refName: string, oldSha: string, newSha: string): Promise<void> {
    const event: CDCEvent = {
      id: this.generateEventId(),
      type: 'REF_UPDATED',
      source: 'push',
      timestamp: Date.now(),
      payload: {
        operation: 'ref-update',
        refName,
        oldSha,
        newSha
      },
      sequence: this.nextSequence(),
      version: 1
    }
    await this.emitEvent(event)
  }

  async onCommitCreated(commitSha: string, treeSha: string, parentShas: string[]): Promise<void> {
    const event: CDCEvent = {
      id: this.generateEventId(),
      type: 'COMMIT_CREATED',
      source: 'push',
      timestamp: Date.now(),
      payload: {
        operation: 'commit-create',
        sha: commitSha,
        treeSha,
        parentShas
      },
      sequence: this.nextSequence(),
      version: 1
    }
    await this.emitEvent(event)
  }

  async onPackReceived(packData: Uint8Array, objectCount: number): Promise<void> {
    const event: CDCEvent = {
      id: this.generateEventId(),
      type: 'PACK_RECEIVED',
      source: 'push',
      timestamp: Date.now(),
      payload: {
        operation: 'pack-receive',
        data: packData,
        objectCount
      },
      sequence: this.nextSequence(),
      version: 1
    }
    await this.emitEvent(event)
  }

  async onBranchCreated(branchName: string, sha: string): Promise<void> {
    const event: CDCEvent = {
      id: this.generateEventId(),
      type: 'BRANCH_CREATED',
      source: 'push',
      timestamp: Date.now(),
      payload: {
        operation: 'branch-create',
        branchName,
        sha
      },
      sequence: this.nextSequence(),
      version: 1
    }
    await this.emitEvent(event)
  }

  async onBranchDeleted(branchName: string): Promise<void> {
    const event: CDCEvent = {
      id: this.generateEventId(),
      type: 'BRANCH_DELETED',
      source: 'push',
      timestamp: Date.now(),
      payload: {
        operation: 'branch-delete',
        branchName
      },
      sequence: this.nextSequence(),
      version: 1
    }
    await this.emitEvent(event)
  }

  async onTagCreated(tagName: string, sha: string): Promise<void> {
    const event: CDCEvent = {
      id: this.generateEventId(),
      type: 'TAG_CREATED',
      source: 'push',
      timestamp: Date.now(),
      payload: {
        operation: 'tag-create',
        tagName,
        sha
      },
      sequence: this.nextSequence(),
      version: 1
    }
    await this.emitEvent(event)
  }

  async onMergeCompleted(mergeSha: string, baseSha: string, headSha: string): Promise<void> {
    const event: CDCEvent = {
      id: this.generateEventId(),
      type: 'MERGE_COMPLETED',
      source: 'push',
      timestamp: Date.now(),
      payload: {
        operation: 'merge-complete',
        sha: mergeSha,
        baseSha,
        headSha
      },
      sequence: this.nextSequence(),
      version: 1
    }
    await this.emitEvent(event)
  }

  getEvents(): CDCEvent[] {
    return [...this.events]
  }

  getBufferSize(): number {
    return this.events.length
  }

  async flush(): Promise<CDCEvent[]> {
    const flushed = [...this.events]
    this.events = []
    return flushed
  }

  addListener(listener: GitOperationListener): void {
    this.listeners.push(listener)
  }

  removeListener(listener: GitOperationListener): void {
    const index = this.listeners.indexOf(listener)
    if (index !== -1) {
      this.listeners.splice(index, 1)
    }
  }
}

// ============================================================================
// Parquet Schema
// ============================================================================

const CDC_EVENT_FIELDS: ParquetField[] = [
  { name: 'event_id', type: 'STRING', nullable: false },
  { name: 'event_type', type: 'STRING', nullable: false },
  { name: 'source', type: 'STRING', nullable: false },
  { name: 'timestamp', type: 'TIMESTAMP', nullable: false },
  { name: 'sequence', type: 'INT64', nullable: false },
  { name: 'version', type: 'INT64', nullable: false },
  { name: 'payload_json', type: 'STRING', nullable: false },
  { name: 'sha', type: 'STRING', nullable: true }
]

/**
 * Parquet schema definition for CDC events
 */
export class ParquetSchema {
  constructor(public readonly fields: ParquetField[]) {}

  static forCDCEvents(customFields?: ParquetField[]): ParquetSchema {
    const fields = [...CDC_EVENT_FIELDS]
    if (customFields) {
      fields.push(...customFields)
    }
    return new ParquetSchema(fields)
  }
}

// ============================================================================
// Parquet Transformer
// ============================================================================

export interface ParquetTransformerOptions {
  compression?: 'snappy' | 'gzip' | 'none'
}

/**
 * Transforms CDC events to Parquet format
 */
export class ParquetTransformer {
  private readonly compression: string

  constructor(options: ParquetTransformerOptions = {}) {
    this.compression = options.compression ?? 'snappy'
  }

  eventToRow(event: CDCEvent): ParquetRow {
    // Create a serializable copy of the payload (Uint8Array not JSON-serializable)
    const serializablePayload = {
      ...event.payload,
      data: event.payload.data ? Array.from(event.payload.data) : undefined
    }

    return {
      event_id: event.id,
      event_type: event.type,
      source: event.source,
      timestamp: event.timestamp,
      sequence: event.sequence,
      version: event.version,
      payload_json: JSON.stringify(serializablePayload),
      sha: event.payload.sha ?? null
    }
  }

  eventsToBatch(events: CDCEvent[]): ParquetBatch {
    const rows = events.map(e => this.eventToRow(e))
    return {
      rows,
      rowCount: rows.length,
      createdAt: Date.now(),
      schema: ParquetSchema.forCDCEvents(),
      compression: this.compression
    }
  }

  async toParquetBuffer(batch: ParquetBatch): Promise<Uint8Array> {
    // Build a simplified Parquet-like buffer
    // Real implementation would use a proper Parquet library
    const encoder = new TextEncoder()

    // Magic bytes
    const magic = encoder.encode('PAR1')

    // Serialize batch data
    const dataJson = JSON.stringify({
      rows: batch.rows,
      rowCount: batch.rowCount,
      createdAt: batch.createdAt,
      schema: batch.schema,
      compression: batch.compression
    })

    let dataBytes = encoder.encode(dataJson)

    // Apply compression
    if (this.compression === 'gzip') {
      dataBytes = await this.gzipCompress(dataBytes)
    } else if (this.compression === 'snappy') {
      // Snappy simulation (use simple compression)
      dataBytes = await this.simpleCompress(dataBytes)
    }

    // Build final buffer: PAR1 + data + length (4 bytes) + PAR1
    const lengthBytes = new Uint8Array(4)
    new DataView(lengthBytes.buffer).setUint32(0, dataBytes.length, true)

    const totalSize = 4 + dataBytes.length + 4 + 4
    const result = new Uint8Array(totalSize)

    let offset = 0
    result.set(magic, offset)
    offset += 4
    result.set(dataBytes, offset)
    offset += dataBytes.length
    result.set(lengthBytes, offset)
    offset += 4
    result.set(magic, offset)

    return result
  }

  private async gzipCompress(data: Uint8Array): Promise<Uint8Array> {
    // Use CompressionStream if available (modern browsers/Node 18+)
    if (typeof CompressionStream !== 'undefined') {
      const stream = new CompressionStream('gzip')
      const writer = stream.writable.getWriter()
      writer.write(data)
      writer.close()

      const reader = stream.readable.getReader()
      const chunks: Uint8Array[] = []

      let done = false
      while (!done) {
        const result = await reader.read()
        done = result.done
        if (result.value) {
          chunks.push(result.value)
        }
      }

      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
      const result = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.length
      }
      return result
    }

    // Fallback: return data as-is (no compression)
    return data
  }

  private async simpleCompress(data: Uint8Array): Promise<Uint8Array> {
    // For snappy, we just return data as-is (real snappy compression would require a library)
    // This is a simplified implementation that avoids async stream issues with fake timers
    return data
  }
}

// ============================================================================
// CDC Batcher
// ============================================================================

type BatchHandler = (batch: BatchResult) => void | Promise<void>

/**
 * Batches CDC events for efficient processing
 */
export class CDCBatcher {
  private readonly config: BatchConfig
  private events: CDCEvent[] = []
  private batchHandlers: BatchHandler[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = false

  constructor(config: BatchConfig) {
    this.config = config
    // Don't start timer in constructor - start when first event is added
  }

  private ensureTimerRunning(): void {
    if (this.stopped) return
    if (this.flushTimer !== null) return // Already have a timer

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null

      if (this.stopped) return

      // Process pending events if any
      if (this.events.length > 0) {
        // Build batch result
        const batchEvents = [...this.events]
        this.events = []

        const sequences = batchEvents.map(e => e.sequence)
        const timestamps = batchEvents.map(e => e.timestamp)

        const result: BatchResult = {
          events: batchEvents,
          eventCount: batchEvents.length,
          success: true,
          minSequence: Math.min(...sequences),
          maxSequence: Math.max(...sequences),
          minTimestamp: Math.min(...timestamps),
          maxTimestamp: Math.max(...timestamps)
        }

        // Notify handlers and handle promises
        const handlerPromises: Promise<void>[] = []
        for (const handler of this.batchHandlers) {
          try {
            const maybePromise = handler(result)
            if (maybePromise && typeof maybePromise.then === 'function') {
              handlerPromises.push(maybePromise as Promise<void>)
            }
          } catch {
            // Ignore handler errors in timer context
          }
        }

        // Execute all handlers and ignore the result
        if (handlerPromises.length > 0) {
          void Promise.all(handlerPromises)
        }
      }

      // DON'T reschedule here - timer will be scheduled on next add() call
    }, this.config.flushIntervalMs)
  }

  private clearFlushTimer(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }

  async add(event: CDCEvent): Promise<void> {
    this.events.push(event)

    // Ensure flush timer is running when we have pending events
    this.ensureTimerRunning()

    if (this.events.length >= this.config.batchSize) {
      this.clearFlushTimer()
      await this.flushInternal()
      // Timer will be re-started on next add() if needed
    }
  }

  private async flushInternal(): Promise<BatchResult> {
    if (this.events.length === 0) {
      return { events: [], eventCount: 0, success: true }
    }

    const batchEvents = [...this.events]
    this.events = []

    const sequences = batchEvents.map(e => e.sequence)
    const timestamps = batchEvents.map(e => e.timestamp)

    const result: BatchResult = {
      events: batchEvents,
      eventCount: batchEvents.length,
      success: true,
      minSequence: Math.min(...sequences),
      maxSequence: Math.max(...sequences),
      minTimestamp: Math.min(...timestamps),
      maxTimestamp: Math.max(...timestamps)
    }

    // Notify handlers (await async handlers)
    for (const handler of this.batchHandlers) {
      await handler(result)
    }

    return result
  }

  async flush(): Promise<BatchResult> {
    this.clearFlushTimer()
    const result = await this.flushInternal()
    // Don't restart timer - it will be started on next add() if needed
    return result
  }

  getPendingCount(): number {
    return this.events.length
  }

  onBatch(handler: BatchHandler): void {
    this.batchHandlers.push(handler)
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.clearFlushTimer()
  }
}

// ============================================================================
// CDC Pipeline
// ============================================================================

type OutputHandler = (output: PipelineOutput) => void
type DeadLetterHandler = (events: CDCEvent[], error: Error) => void

/**
 * Main CDC Pipeline for processing git operation events
 */
export class CDCPipeline {
  private readonly config: CDCPipelineConfig
  private state: CDCPipelineState = 'stopped'
  private batcher: CDCBatcher | null = null
  private transformer: ParquetTransformer
  private outputHandlers: OutputHandler[] = []
  private deadLetterHandlers: DeadLetterHandler[] = []
  private metrics: PipelineMetrics = {
    eventsProcessed: 0,
    batchesGenerated: 0,
    bytesWritten: 0,
    errors: 0,
    avgProcessingLatencyMs: 0
  }
  private processingLatencies: number[] = []
  private retryPolicy: CDCRetryPolicy

  constructor(config: CDCPipelineConfig) {
    this.config = config
    this.transformer = new ParquetTransformer({
      compression: config.parquetCompression
    })
    this.retryPolicy = new CDCRetryPolicy({
      maxRetries: config.maxRetries,
      initialDelayMs: 100,
      maxDelayMs: 5000,
      backoffMultiplier: 2
    })
  }

  getState(): CDCPipelineState {
    return this.state
  }

  async start(): Promise<void> {
    if (this.state === 'running') return

    this.batcher = new CDCBatcher({
      batchSize: this.config.batchSize,
      flushIntervalMs: this.config.flushIntervalMs
    })

    this.batcher.onBatch(async (batch) => {
      await this.handleBatch(batch)
    })

    this.state = 'running'
  }

  async stop(): Promise<StopResult> {
    if (this.state === 'stopped') {
      return { flushedCount: 0 }
    }

    let flushedCount = 0

    if (this.batcher) {
      const result = await this.batcher.flush()
      flushedCount = result.eventCount
      await this.batcher.stop()
      this.batcher = null
    }

    this.state = 'stopped'
    return { flushedCount }
  }

  async process(event: CDCEvent): Promise<ProcessResult> {
    if (this.state !== 'running') {
      throw new CDCError('PROCESSING_ERROR', 'Pipeline is not running')
    }

    // Validate event
    validateCDCEvent(event)

    const startTime = Date.now()

    await this.batcher!.add(event)
    this.metrics.eventsProcessed++

    const latency = Date.now() - startTime
    this.processingLatencies.push(latency)
    this.updateAvgLatency()

    return { success: true, eventId: event.id }
  }

  async processMany(events: CDCEvent[]): Promise<ProcessResult[]> {
    const results: ProcessResult[] = []
    for (const event of events) {
      const result = await this.process(event)
      results.push(result)
    }
    return results
  }

  async flush(): Promise<void> {
    if (this.batcher) {
      const result = await this.batcher.flush()
      if (result.eventCount > 0) {
        await this.handleBatch(result)
      }
    }
  }

  private async handleBatch(batch: BatchResult): Promise<void> {
    let attempts = 0
    let lastError: Error | null = null

    while (attempts <= this.config.maxRetries) {
      try {
        const parquetBatch = this.transformer.eventsToBatch(batch.events)
        const parquetBuffer = await this.transformer.toParquetBuffer(parquetBatch)

        const output: PipelineOutput = {
          parquetBuffer,
          events: batch.events,
          batchId: `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`
        }

        // Notify output handlers
        for (const handler of this.outputHandlers) {
          handler(output)
        }

        this.metrics.batchesGenerated++
        this.metrics.bytesWritten += parquetBuffer.length

        return // Success
      } catch (error) {
        lastError = error as Error
        attempts++
        this.metrics.errors++

        if (this.retryPolicy.shouldRetry(attempts)) {
          const delay = this.retryPolicy.getDelay(attempts)
          await this.sleep(delay)
        }
      }
    }

    // All retries exhausted - send to dead letter queue
    if (lastError) {
      for (const handler of this.deadLetterHandlers) {
        handler(batch.events, lastError)
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private updateAvgLatency(): void {
    if (this.processingLatencies.length === 0) return

    // Keep only last 1000 measurements
    if (this.processingLatencies.length > 1000) {
      this.processingLatencies = this.processingLatencies.slice(-1000)
    }

    const sum = this.processingLatencies.reduce((a, b) => a + b, 0)
    this.metrics.avgProcessingLatencyMs = sum / this.processingLatencies.length
  }

  getMetrics(): PipelineMetrics {
    return { ...this.metrics }
  }

  onOutput(handler: OutputHandler): void {
    this.outputHandlers.push(handler)
  }

  onDeadLetter(handler: DeadLetterHandler): void {
    this.deadLetterHandlers.push(handler)
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

const VALID_EVENT_TYPES: CDCEventType[] = [
  'OBJECT_CREATED',
  'OBJECT_DELETED',
  'REF_UPDATED',
  'PACK_RECEIVED',
  'COMMIT_CREATED',
  'TREE_MODIFIED',
  'BRANCH_CREATED',
  'BRANCH_DELETED',
  'TAG_CREATED',
  'MERGE_COMPLETED'
]

/**
 * Create a new CDC event
 */
export function createCDCEvent(
  type: CDCEventType,
  source: CDCEventSource,
  payload: CDCEventPayload,
  options?: { sequence?: number }
): CDCEvent {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    source,
    timestamp: Date.now(),
    payload,
    sequence: options?.sequence ?? 0,
    version: 1
  }
}

/**
 * Serialize a CDC event to bytes
 */
export function serializeEvent(event: CDCEvent): Uint8Array {
  // Create a serializable copy (Uint8Array is not JSON-serializable)
  const serializable = {
    ...event,
    payload: {
      ...event.payload,
      data: event.payload.data ? Array.from(event.payload.data) : undefined
    }
  }
  const json = JSON.stringify(serializable)
  return new TextEncoder().encode(json)
}

/**
 * Deserialize bytes to a CDC event
 */
export function deserializeEvent(bytes: Uint8Array): CDCEvent {
  const json = new TextDecoder().decode(bytes)
  const parsed = JSON.parse(json)

  // Restore Uint8Array if data was serialized
  if (parsed.payload?.data && Array.isArray(parsed.payload.data)) {
    parsed.payload.data = new Uint8Array(parsed.payload.data)
  }

  return parsed as CDCEvent
}

/**
 * Validate a CDC event
 */
export function validateCDCEvent(event: CDCEvent): CDCEvent {
  if (!event) {
    throw new CDCError('VALIDATION_ERROR', 'Event is null or undefined')
  }

  if (!event.id || typeof event.id !== 'string' || event.id.length === 0) {
    throw new CDCError('VALIDATION_ERROR', 'Event id is missing or invalid')
  }

  if (!VALID_EVENT_TYPES.includes(event.type)) {
    throw new CDCError('VALIDATION_ERROR', `Invalid event type: ${event.type}`)
  }

  if (typeof event.timestamp !== 'number' || event.timestamp < 0) {
    throw new CDCError('VALIDATION_ERROR', 'Invalid timestamp')
  }

  if (typeof event.sequence !== 'number' || event.sequence < 0) {
    throw new CDCError('VALIDATION_ERROR', 'Invalid sequence number')
  }

  return event
}

// ============================================================================
// Pipeline Operations
// ============================================================================

const activePipelines: Map<string, CDCPipeline> = new Map()

/**
 * Start a pipeline with the given configuration
 */
export function startPipeline(id: string, config: CDCPipelineConfig): CDCPipeline {
  const pipeline = new CDCPipeline(config)
  pipeline.start()
  activePipelines.set(id, pipeline)
  return pipeline
}

/**
 * Stop a pipeline by ID
 */
export async function stopPipeline(id: string): Promise<StopResult> {
  const pipeline = activePipelines.get(id)
  if (!pipeline) {
    return { flushedCount: 0 }
  }

  const result = await pipeline.stop()
  activePipelines.delete(id)
  return result
}

/**
 * Flush a pipeline by ID
 */
export async function flushPipeline(id: string): Promise<void> {
  const pipeline = activePipelines.get(id)
  if (pipeline) {
    await pipeline.flush()
  }
}

/**
 * Get metrics for a pipeline by ID
 */
export function getPipelineMetrics(id: string): PipelineMetrics | null {
  const pipeline = activePipelines.get(id)
  if (!pipeline) {
    return null
  }
  return pipeline.getMetrics()
}
