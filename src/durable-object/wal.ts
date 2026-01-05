import { DurableObjectStorage } from './schema'

/**
 * WAL Operation Types
 */
export type WALOperationType = 'PUT' | 'DELETE' | 'UPDATE' | 'BATCH' | 'TX_BEGIN' | 'TX_COMMIT' | 'TX_ROLLBACK'

/**
 * Transaction States
 */
export type TransactionState = 'ACTIVE' | 'COMMITTED' | 'ROLLED_BACK'

/**
 * WAL Entry representing a single logged operation
 */
export interface WALEntry {
  id: number
  operation: WALOperationType
  payload: Uint8Array
  transactionId: string | null
  createdAt: number
  flushed: boolean
}

/**
 * Transaction metadata
 */
export interface Transaction {
  id: string
  state: TransactionState
  startedAt: number
  operations: number[]
}

/**
 * Checkpoint representing a consistent point in the WAL
 */
export interface Checkpoint {
  id: number
  walPosition: number
  createdAt: number
  metadata: string | null
}

/**
 * Generate a unique transaction ID
 */
function generateTransactionId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `tx-${timestamp}-${random}`
}

/**
 * WALManager - Write-Ahead Log Manager for transaction durability
 *
 * Provides durability guarantees by logging all operations before they are applied.
 * Supports transactions with begin/commit/rollback semantics and checkpoint management.
 */
export class WALManager {
  private storage: DurableObjectStorage
  private transactions: Map<string, Transaction> = new Map()
  private currentWalPosition: number = 0

  constructor(storage: DurableObjectStorage) {
    this.storage = storage
  }

  /**
   * Append an operation to the WAL
   * @param operation The type of operation
   * @param payload The operation payload as binary data
   * @param transactionId Optional transaction ID to associate with this operation
   * @returns The ID of the appended WAL entry
   */
  async append(operation: WALOperationType, payload: Uint8Array, transactionId?: string): Promise<number> {
    const result = this.storage.sql.exec(
      'INSERT INTO wal (operation, payload, transaction_id) VALUES (?, ?, ?)',
      operation,
      payload,
      transactionId ?? null
    )

    const rows = result.toArray() as { id: number }[]
    const entryId = rows[0]?.id ?? this.currentWalPosition + 1
    this.currentWalPosition = entryId

    // Track operation in transaction if applicable
    if (transactionId) {
      const tx = this.transactions.get(transactionId)
      if (tx) {
        tx.operations.push(entryId)
      }
    }

    return entryId
  }

  /**
   * Flush all unflushed WAL entries
   * @returns The number of entries flushed
   */
  async flush(): Promise<number> {
    // Get count of unflushed entries
    const countResult = this.storage.sql.exec(
      'SELECT COUNT(*) as count FROM wal WHERE flushed = 0'
    )
    const countRows = countResult.toArray() as { count: number }[]
    const count = countRows[0]?.count ?? 0

    if (count === 0) {
      return 0
    }

    // Mark all unflushed entries as flushed
    this.storage.sql.exec('UPDATE wal SET flushed = 1 WHERE flushed = 0')

    return count
  }

  /**
   * Recover unflushed WAL entries for replay
   * @returns Array of unflushed WAL entries in order
   */
  async recover(): Promise<WALEntry[]> {
    const result = this.storage.sql.exec(
      'SELECT id, operation, payload, transaction_id, created_at, flushed FROM wal WHERE flushed = 0 ORDER BY id ASC'
    )

    const rows = result.toArray() as WALEntry[]
    return rows.sort((a, b) => a.id - b.id)
  }

  /**
   * Begin a new transaction
   * @returns The transaction ID
   */
  async beginTransaction(): Promise<string> {
    const txId = generateTransactionId()

    const transaction: Transaction = {
      id: txId,
      state: 'ACTIVE',
      startedAt: Date.now(),
      operations: []
    }

    this.transactions.set(txId, transaction)

    // Log transaction begin
    this.storage.sql.exec(
      'INSERT INTO transactions (id, state) VALUES (?, ?)',
      txId,
      'ACTIVE'
    )

    // Append TX_BEGIN entry to WAL
    await this.append('TX_BEGIN', new TextEncoder().encode(JSON.stringify({ txId })), txId)

    return txId
  }

  /**
   * Commit a transaction
   * @param transactionId The transaction ID to commit
   */
  async commitTransaction(transactionId: string): Promise<void> {
    const tx = this.transactions.get(transactionId)

    if (!tx) {
      // Check if transaction exists in storage
      const result = this.storage.sql.exec(
        'SELECT id, state FROM transactions WHERE id = ?',
        transactionId
      )
      const rows = result.toArray() as Transaction[]
      if (rows.length === 0) {
        throw new Error('Transaction not found')
      }
      throw new Error('Transaction not active')
    }

    if (tx.state !== 'ACTIVE') {
      throw new Error('Transaction not active')
    }

    // Append TX_COMMIT entry to WAL
    await this.append('TX_COMMIT', new TextEncoder().encode(JSON.stringify({ txId: transactionId })), transactionId)

    // Update transaction state
    tx.state = 'COMMITTED'
    this.storage.sql.exec(
      'UPDATE transactions SET state = ? WHERE id = ?',
      'COMMITTED',
      transactionId
    )
  }

  /**
   * Rollback a transaction
   * @param transactionId The transaction ID to rollback
   */
  async rollbackTransaction(transactionId: string): Promise<void> {
    const tx = this.transactions.get(transactionId)

    if (!tx) {
      const result = this.storage.sql.exec(
        'SELECT id, state FROM transactions WHERE id = ?',
        transactionId
      )
      const rows = result.toArray() as Transaction[]
      if (rows.length === 0) {
        throw new Error('Transaction not found')
      }
      throw new Error('Transaction not active')
    }

    if (tx.state !== 'ACTIVE') {
      throw new Error('Transaction not active')
    }

    // Delete transaction entries from WAL (except TX_BEGIN)
    this.storage.sql.exec(
      'DELETE FROM wal WHERE transaction_id = ? AND operation NOT IN (?, ?)',
      transactionId,
      'TX_BEGIN',
      'TX_ROLLBACK'
    )

    // Append TX_ROLLBACK entry to WAL
    await this.append('TX_ROLLBACK', new TextEncoder().encode(JSON.stringify({ txId: transactionId })), transactionId)

    // Update transaction state
    tx.state = 'ROLLED_BACK'
    this.storage.sql.exec(
      'UPDATE transactions SET state = ? WHERE id = ?',
      'ROLLED_BACK',
      transactionId
    )
  }

  /**
   * Get the state of a transaction
   * @param transactionId The transaction ID
   * @returns The transaction state or null if not found
   */
  async getTransactionState(transactionId: string): Promise<TransactionState | null> {
    const tx = this.transactions.get(transactionId)
    if (tx) {
      return tx.state
    }

    const result = this.storage.sql.exec(
      'SELECT state FROM transactions WHERE id = ?',
      transactionId
    )
    const rows = result.toArray() as { state: TransactionState }[]
    return rows.length > 0 ? rows[0].state : null
  }

  /**
   * Create a checkpoint at the current WAL position
   * @param metadata Optional metadata to associate with the checkpoint
   * @returns The created checkpoint
   */
  async createCheckpoint(metadata?: string): Promise<Checkpoint> {
    // Flush all pending entries before creating checkpoint
    await this.flush()

    // Get current WAL position
    const countResult = this.storage.sql.exec(
      'SELECT MAX(id) as max_id FROM wal'
    )
    const countRows = countResult.toArray() as { max_id: number | null }[]
    const walPosition = countRows[0]?.max_id ?? 0

    // Create checkpoint entry
    const result = this.storage.sql.exec(
      'INSERT INTO checkpoints (wal_position, metadata) VALUES (?, ?)',
      walPosition,
      metadata ?? null
    )

    const rows = result.toArray() as { id: number }[]
    const checkpointId = rows[0]?.id ?? 1

    const checkpoint: Checkpoint = {
      id: checkpointId,
      walPosition,
      createdAt: Date.now(),
      metadata: metadata ?? null
    }

    return checkpoint
  }

  /**
   * Get the most recent checkpoint
   * @returns The last checkpoint or null if none exist
   */
  async getLastCheckpoint(): Promise<Checkpoint | null> {
    const result = this.storage.sql.exec(
      'SELECT id, wal_position, created_at, metadata FROM checkpoints ORDER BY id DESC LIMIT 1'
    )

    const rows = result.toArray() as Checkpoint[]
    return rows.length > 0 ? rows[0] : null
  }

  /**
   * Truncate WAL entries before a checkpoint
   * @param checkpoint The checkpoint to truncate before
   */
  async truncateBeforeCheckpoint(checkpoint: Checkpoint): Promise<void> {
    this.storage.sql.exec(
      'DELETE FROM wal WHERE id <= ? AND flushed = 1',
      checkpoint.walPosition
    )
  }

  /**
   * Get the count of unflushed WAL entries
   * @returns The number of unflushed entries
   */
  async getUnflushedCount(): Promise<number> {
    const result = this.storage.sql.exec(
      'SELECT COUNT(*) as count FROM wal WHERE flushed = 0'
    )

    const rows = result.toArray() as { count: number }[]
    return rows[0]?.count ?? 0
  }
}
