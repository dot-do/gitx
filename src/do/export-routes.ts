/**
 * @fileoverview Export route handlers for GitRepoDO.
 *
 * Domain-specific handlers for Parquet and Iceberg export operations.
 *
 * @module do/export-routes
 */

import type { GitRepoDOInstance, RouteContext } from './routes'
import type { DurableObjectStorage } from './schema'
import { EXPORT_COMMITS_SCHEMA } from '../storage/parquet-schemas'
import { SqliteObjectStore } from './object-store'
import { parquetWriteBuffer, encodeVariant } from 'hyparquet-writer'
import type { CompressionCodec } from 'hyparquet'
import type { GitCommitData, GitRefData } from '../export/git-parquet'
import * as lz4js from 'lz4js'
import {
  R2DataCatalog,
  IcebergTableManager,
  createDataFile,
} from '../export/iceberg'
import { COMMITS_SCHEMA, REFS_SCHEMA } from '../export/schemas'

// ============================================================================
// Types
// ============================================================================

/**
 * Export request payload.
 */
export interface ExportRequest {
  /** Tables to export (commits, refs, files, or all) */
  tables?: ('commits' | 'refs' | 'files')[]
  /** Force full export even if incremental is available */
  fullExport?: boolean
  /** Repository name (e.g., "owner/repo") - used as fallback if DO ns not set */
  repository?: string
  /** Compression codec: 'LZ4', 'UNCOMPRESSED', or 'SNAPPY' (default) */
  codec?: 'LZ4' | 'LZ4_RAW' | 'UNCOMPRESSED' | 'SNAPPY'
  /** Export format: 'parquet' (raw files) or 'iceberg' (with table metadata) */
  format?: 'parquet' | 'iceberg'
}

/**
 * Export job status.
 */
export interface ExportJobStatus {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  tables: string[]
  startedAt: number
  completedAt?: number
  error?: string
  results?: {
    table: string
    rowCount: number
    fileSize: number
    path: string
  }[]
}

// ============================================================================
// LZ4 Compression
// ============================================================================

/**
 * LZ4 compressor function for hyparquet-writer.
 * Uses raw LZ4 block compression (no framing) for Parquet LZ4_RAW codec.
 * Uses lz4js.compressBlock which produces raw block format compatible with DuckDB.
 */
function lz4Compress(input: Uint8Array): Uint8Array {
  // LZ4 block format max size: inputSize + inputSize/255 + 16
  const maxSize = input.length + Math.ceil(input.length / 255) + 16
  const output = new Uint8Array(maxSize)
  // compressBlock returns the number of bytes written
  const compressedSize = lz4js.compressBlock(input, output, 0, input.length, lz4js.makeHashTable())
  if (compressedSize === 0) {
    // Data is incompressible, return as-is
    return input
  }
  return output.slice(0, compressedSize)
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * Export route handler - exports git data to Parquet and uploads to R2.
 * Supports both raw Parquet export and Iceberg format with table metadata.
 *
 * @param c - Hono context
 * @param instance - GitRepoDO instance
 * @returns Export result with file paths and row counts
 */
export async function handleExport(
  c: RouteContext,
  instance: GitRepoDOInstance
): Promise<Response> {
  try {
    const body = await c.req.json<ExportRequest>().catch(() => ({} as ExportRequest))
    const tables = body.tables ?? ['commits', 'refs']
    const exportId = crypto.randomUUID()
    const timestamp = Date.now()
    const format = body.format ?? 'parquet'

    // Get compression codec - default to SNAPPY (built-in support, DuckDB compatible)
    // LZ4_RAW requires proper raw block format which lz4js doesn't produce correctly
    const codec: CompressionCodec = body.codec ?? 'SNAPPY'

    // Build compressors map for LZ4 support (only include if using LZ4)
    const useLZ4 = codec === 'LZ4' || codec === 'LZ4_RAW'
    const lz4Compressors = { LZ4: lz4Compress, LZ4_RAW: lz4Compress }

    // Get repository name from namespace or request body
    const ns = instance.ns
    let repoName = body.repository
    if (ns) {
      // Extract repo name from namespace (e.g., "github:owner/repo" -> "owner/repo")
      repoName = ns.replace(/^github:/, '')
    }
    if (!repoName) {
      return c.json({ success: false, error: 'Repository not specified (provide "repository" in request body)' }, 400)
    }

    // Get R2 bucket
    const bucket = instance.getAnalyticsBucket()
    if (!bucket) {
      return c.json({ success: false, error: 'Analytics bucket not available' }, 500)
    }

    // Use cached schema manager and object store from DO instance
    const schemaManager = instance.getSchemaManager()
    await schemaManager.initializeSchema()
    const objectStore = instance.getObjectStore()
    const storage = instance.getStorage()

    const results: ExportJobStatus['results'] = []

    // For Iceberg format, use IcebergTableManager to create proper table metadata
    if (format === 'iceberg') {
      const catalog = new R2DataCatalog({
        bucket,
        warehouseLocation: `r2://gitx-analytics/${repoName}`,
      })
      const tableManager = new IcebergTableManager({
        catalog,
        bucket,
      })

      // Export commits to Iceberg table
      if (tables.includes('commits')) {
        const commits = await readCommitsFromStorage(objectStore)
        if (commits.length > 0) {
          // Encode parent_shas as VARIANT binary format
          const parentShasData = commits.map(c => {
            const encoded = encodeVariant(c.parentShas)
            return { metadata: encoded.metadata, value: encoded.value }
          })

          const buffer = parquetWriteBuffer({
            codec,
            ...(useLZ4 && { compressors: lz4Compressors }),
            schema: EXPORT_COMMITS_SCHEMA,
            columnData: [
              { name: 'sha', data: commits.map(c => c.sha) },
              { name: 'tree_sha', data: commits.map(c => c.treeSha) },
              { name: 'parent_shas', data: parentShasData },
              { name: 'author_name', data: commits.map(c => c.author.name) },
              { name: 'author_email', data: commits.map(c => c.author.email) },
              { name: 'author_date', data: commits.map(c => BigInt(toTimestamp(c.author.date))) },
              { name: 'committer_name', data: commits.map(c => c.committer.name) },
              { name: 'committer_email', data: commits.map(c => c.committer.email) },
              { name: 'committer_date', data: commits.map(c => BigInt(toTimestamp(c.committer.date))) },
              { name: 'message', data: commits.map(c => c.message) },
              { name: 'repository', data: commits.map(() => repoName) },
            ],
          })

          // Write Parquet data file
          const dataPath = `${repoName}/commits/data/${exportId}.parquet`
          await bucket.put(dataPath, buffer)

          // Create or get Iceberg table and append files
          try {
            await tableManager.createTable(repoName!, 'commits', {
              schema: COMMITS_SCHEMA,
              properties: { 'write.format.default': 'parquet' },
            })
          } catch (e) {
            // Table may already exist, which is fine
            if (!(e instanceof Error && e.message.includes('already exists'))) {
              throw e
            }
          }

          // Create data file entry and append to table
          const dataFile = createDataFile(
            `r2://gitx-analytics/${dataPath}`,
            commits.length,
            buffer.byteLength
          )
          const snapshot = await tableManager.appendFiles(repoName!, 'commits', {
            files: [dataFile],
          })

          results.push({
            table: 'commits',
            rowCount: commits.length,
            fileSize: buffer.byteLength,
            path: dataPath,
          })

          // Log snapshot info for debugging
          console.log(`[Export] Created Iceberg snapshot ${snapshot.snapshot_id} for commits table`)
        }
      }

      // Export refs to Iceberg table
      if (tables.includes('refs')) {
        const refs = await readRefsFromStorage(storage)
        if (refs.length > 0) {
          const buffer = parquetWriteBuffer({
            codec,
            ...(useLZ4 && { compressors: lz4Compressors }),
            columnData: [
              { name: 'name', data: refs.map(r => r.name), type: 'STRING' },
              { name: 'target_sha', data: refs.map(r => r.targetSha), type: 'STRING' },
              { name: 'repository', data: refs.map(() => repoName), type: 'STRING' },
            ],
          })

          // Write Parquet data file
          const dataPath = `${repoName}/refs/data/${exportId}.parquet`
          await bucket.put(dataPath, buffer)

          // Create or get Iceberg table and append files
          try {
            await tableManager.createTable(repoName!, 'refs', {
              schema: REFS_SCHEMA,
              properties: { 'write.format.default': 'parquet' },
            })
          } catch (e) {
            // Table may already exist, which is fine
            if (!(e instanceof Error && e.message.includes('already exists'))) {
              throw e
            }
          }

          // Create data file entry and append to table
          const dataFile = createDataFile(
            `r2://gitx-analytics/${dataPath}`,
            refs.length,
            buffer.byteLength
          )
          const snapshot = await tableManager.appendFiles(repoName!, 'refs', {
            files: [dataFile],
          })

          results.push({
            table: 'refs',
            rowCount: refs.length,
            fileSize: buffer.byteLength,
            path: dataPath,
          })

          // Log snapshot info for debugging
          console.log(`[Export] Created Iceberg snapshot ${snapshot.snapshot_id} for refs table`)
        }
      }

      return c.json({
        success: true,
        exportId,
        repository: repoName,
        format: 'iceberg',
        codec,
        timestamp,
        results,
        message: `Exported ${results.length} table(s) to Iceberg format with ${codec} compression`,
      })
    }

    // Default: Export to raw Parquet files (no Iceberg metadata)
    // Export commits to Parquet with VARIANT type for parent_shas
    if (tables.includes('commits')) {
      const commits = await readCommitsFromStorage(objectStore)
      if (commits.length > 0) {
        // Encode parent_shas as VARIANT binary format
        const parentShasData = commits.map(c => {
          const encoded = encodeVariant(c.parentShas)
          return { metadata: encoded.metadata, value: encoded.value }
        })

        const buffer = parquetWriteBuffer({
          codec,
          ...(useLZ4 && { compressors: lz4Compressors }),
          schema: EXPORT_COMMITS_SCHEMA,
          columnData: [
            { name: 'sha', data: commits.map(c => c.sha) },
            { name: 'tree_sha', data: commits.map(c => c.treeSha) },
            { name: 'parent_shas', data: parentShasData },
            { name: 'author_name', data: commits.map(c => c.author.name) },
            { name: 'author_email', data: commits.map(c => c.author.email) },
            { name: 'author_date', data: commits.map(c => BigInt(toTimestamp(c.author.date))) },
            { name: 'committer_name', data: commits.map(c => c.committer.name) },
            { name: 'committer_email', data: commits.map(c => c.committer.email) },
            { name: 'committer_date', data: commits.map(c => BigInt(toTimestamp(c.committer.date))) },
            { name: 'message', data: commits.map(c => c.message) },
            { name: 'repository', data: commits.map(() => repoName) },
          ],
        })
        const path = `${repoName}/commits/${exportId}.parquet`
        await bucket.put(path, buffer)
        results.push({
          table: 'commits',
          rowCount: commits.length,
          fileSize: buffer.byteLength,
          path,
        })
      }
    }

    // Export refs to Parquet
    if (tables.includes('refs')) {
      const refs = await readRefsFromStorage(storage)
      if (refs.length > 0) {
        const buffer = parquetWriteBuffer({
          codec,
          ...(useLZ4 && { compressors: lz4Compressors }),
          columnData: [
            { name: 'name', data: refs.map(r => r.name), type: 'STRING' },
            { name: 'target_sha', data: refs.map(r => r.targetSha), type: 'STRING' },
            { name: 'repository', data: refs.map(() => repoName), type: 'STRING' },
          ],
        })
        const path = `${repoName}/refs/${exportId}.parquet`
        await bucket.put(path, buffer)
        results.push({
          table: 'refs',
          rowCount: refs.length,
          fileSize: buffer.byteLength,
          path,
        })
      }
    }

    return c.json({
      success: true,
      exportId,
      repository: repoName,
      format: 'parquet',
      codec,
      timestamp,
      results,
      message: `Exported ${results.length} table(s) to Parquet with ${codec} compression`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Export failed'
    console.error('[Export] Error:', error)
    return c.json({ success: false, error: message }, 500)
  }
}

/**
 * Export status route handler.
 *
 * @param c - Hono context
 * @param _instance - GitRepoDO instance
 * @returns Export job status
 */
export async function handleExportStatus(
  c: RouteContext,
  _instance: GitRepoDOInstance
): Promise<Response> {
  const jobId = c.req.param('jobId')

  // In a full implementation, this would look up the job status from storage
  // For now, return a mock status
  return c.json({
    id: jobId,
    status: 'completed',
    message: 'Export job status lookup not yet implemented',
  })
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert a date value (number or Date) to a timestamp number.
 */
function toTimestamp(date: number | Date | undefined): number {
  if (date === undefined) return Date.now()
  if (date instanceof Date) return date.getTime()
  return date || Date.now()
}

/**
 * Read commits from ObjectStore and convert to GitCommitData format.
 */
async function readCommitsFromStorage(store: SqliteObjectStore): Promise<GitCommitData[]> {
  const commits: GitCommitData[] = []

  try {
    const rows = await store.listObjectsByType('commit')

    for (const row of rows) {
      const commit = parseCommitObject(row.sha, row.data)
      if (commit) {
        commits.push(commit)
      }
    }
  } catch (error) {
    console.error('[Export] Error reading commits:', error)
  }

  return commits
}

/**
 * Parse a raw git commit object into GitCommitData format.
 */
function parseCommitObject(sha: string, data: Uint8Array): GitCommitData | null {
  try {
    const content = new TextDecoder().decode(data)
    const lines = content.split('\n')

    let treeSha = ''
    const parentShas: string[] = []
    let author = { name: '', email: '', date: 0 }
    let committer = { name: '', email: '', date: 0 }
    let messageStartIndex = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (line === '') {
        messageStartIndex = i + 1
        break
      }

      if (line.startsWith('tree ')) {
        treeSha = line.slice(5)
      } else if (line.startsWith('parent ')) {
        parentShas.push(line.slice(7))
      } else if (line.startsWith('author ')) {
        author = parseAuthorLine(line.slice(7))
      } else if (line.startsWith('committer ')) {
        committer = parseAuthorLine(line.slice(10))
      }
    }

    const message = lines.slice(messageStartIndex).join('\n')

    return {
      sha,
      treeSha,
      parentShas,
      author,
      committer,
      message,
    }
  } catch {
    return null
  }
}

/**
 * Parse author/committer line: "Name <email> timestamp timezone"
 */
function parseAuthorLine(line: string): { name: string; email: string; date: number } {
  const match = line.match(/^(.+) <(.+)> (\d+) ([+-]\d{4})$/)
  if (!match) {
    // Fallback: try simpler pattern without timezone
    const simpleMatch = line.match(/^(.+) <(.+)> (\d+)/)
    if (simpleMatch) {
      const timestamp = parseInt(simpleMatch[3]!, 10)
      return {
        name: simpleMatch[1]!,
        email: simpleMatch[2]!,
        date: isNaN(timestamp) ? 0 : timestamp * 1000,
      }
    }
    return { name: '', email: '', date: 0 }
  }
  const timestamp = parseInt(match[3]!, 10)
  return {
    name: match[1]!,
    email: match[2]!,
    date: isNaN(timestamp) ? 0 : timestamp * 1000, // Convert to milliseconds
  }
}

/**
 * Read refs from storage.
 */
async function readRefsFromStorage(storage: DurableObjectStorage): Promise<GitRefData[]> {
  const refs: GitRefData[] = []

  try {
    const result = storage.sql.exec(
      "SELECT name, target FROM refs WHERE name LIKE 'refs/%' ORDER BY name"
    )
    const rows = result.toArray() as { name: string; target: string }[]

    for (const row of rows) {
      refs.push({
        name: row.name,
        targetSha: row.target,
      })
    }
  } catch (error) {
    console.error('[Export] Error reading refs:', error)
  }

  return refs
}
