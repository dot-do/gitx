/**
 * ObjectStore - Git object storage implementation
 *
 * Handles CRUD operations for git objects (blob, tree, commit, tag)
 * with SHA-1 hash computation and proper git object format.
 */

import { DurableObjectStorage } from './schema'
import {
  ObjectType,
  BlobObject,
  TreeObject,
  CommitObject,
  TagObject,
  TreeEntry,
  Author
} from '../types/objects'
import { hashObject } from '../utils/hash'

/**
 * Stored object record in SQLite
 */
export interface StoredObject {
  sha: string
  type: ObjectType
  size: number
  data: Uint8Array
  createdAt: number
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * ObjectStore class for managing git objects in SQLite storage
 */
export class ObjectStore {
  constructor(private storage: DurableObjectStorage) {}

  /**
   * Store a raw object and return its SHA
   */
  async putObject(type: ObjectType, data: Uint8Array): Promise<string> {
    // Compute SHA-1 hash using git object format: "type size\0content"
    const sha = await hashObject(type, data)

    // Log to WAL first
    await this.logToWAL('PUT', sha, type, data)

    // Store the object
    this.storage.sql.exec(
      'INSERT OR REPLACE INTO objects (sha, type, size, data, created_at) VALUES (?, ?, ?, ?, ?)',
      sha,
      type,
      data.length,
      data,
      Date.now()
    )

    // Update object index
    this.storage.sql.exec(
      'INSERT OR REPLACE INTO object_index (sha, tier, location, size, type) VALUES (?, ?, ?, ?, ?)',
      sha,
      'hot',
      'local',
      data.length,
      type
    )

    return sha
  }

  /**
   * Store a tree object with entries
   */
  async putTreeObject(entries: TreeEntry[]): Promise<string> {
    // Sort entries by name (directories get trailing / for sorting)
    const sortedEntries = [...entries].sort((a, b) => {
      const aName = a.mode === '040000' ? a.name + '/' : a.name
      const bName = b.mode === '040000' ? b.name + '/' : b.name
      return aName.localeCompare(bName)
    })

    // Build tree content (without header)
    const entryParts: Uint8Array[] = []
    for (const entry of sortedEntries) {
      const modeName = encoder.encode(`${entry.mode} ${entry.name}\0`)
      const sha20 = hexToBytes(entry.sha)
      const entryData = new Uint8Array(modeName.length + 20)
      entryData.set(modeName)
      entryData.set(sha20, modeName.length)
      entryParts.push(entryData)
    }

    // Combine all entry parts
    const contentLength = entryParts.reduce((sum, part) => sum + part.length, 0)
    const content = new Uint8Array(contentLength)
    let offset = 0
    for (const part of entryParts) {
      content.set(part, offset)
      offset += part.length
    }

    return this.putObject('tree', content)
  }

  /**
   * Store a commit object
   */
  async putCommitObject(commit: {
    tree: string
    parents: string[]
    author: Author
    committer: Author
    message: string
  }): Promise<string> {
    // Build commit content (without header)
    const lines: string[] = []
    lines.push(`tree ${commit.tree}`)
    for (const parent of commit.parents) {
      lines.push(`parent ${parent}`)
    }
    lines.push(`author ${commit.author.name} <${commit.author.email}> ${commit.author.timestamp} ${commit.author.timezone}`)
    lines.push(`committer ${commit.committer.name} <${commit.committer.email}> ${commit.committer.timestamp} ${commit.committer.timezone}`)
    lines.push('')
    lines.push(commit.message)

    const content = encoder.encode(lines.join('\n'))
    return this.putObject('commit', content)
  }

  /**
   * Store a tag object
   */
  async putTagObject(tag: {
    object: string
    objectType: ObjectType
    tagger: Author
    message: string
    name: string
  }): Promise<string> {
    // Build tag content (without header)
    const lines: string[] = []
    lines.push(`object ${tag.object}`)
    lines.push(`type ${tag.objectType}`)
    lines.push(`tag ${tag.name}`)
    lines.push(`tagger ${tag.tagger.name} <${tag.tagger.email}> ${tag.tagger.timestamp} ${tag.tagger.timezone}`)
    lines.push('')
    lines.push(tag.message)

    const content = encoder.encode(lines.join('\n'))
    return this.putObject('tag', content)
  }

  /**
   * Retrieve an object by SHA
   */
  async getObject(sha: string): Promise<StoredObject | null> {
    if (!sha || sha.length < 4) {
      return null
    }

    const result = this.storage.sql.exec(
      'SELECT sha, type, size, data, created_at as createdAt FROM objects WHERE sha = ?',
      sha
    )
    const rows = result.toArray() as StoredObject[]

    if (rows.length === 0) {
      return null
    }

    return rows[0]
  }

  /**
   * Delete an object by SHA
   */
  async deleteObject(sha: string): Promise<boolean> {
    // Check if object exists first
    const exists = await this.hasObject(sha)
    if (!exists) {
      return false
    }

    // Log to WAL
    await this.logToWAL('DELETE', sha, 'blob', new Uint8Array(0))

    // Delete from objects table
    this.storage.sql.exec('DELETE FROM objects WHERE sha = ?', sha)

    // Delete from object index
    this.storage.sql.exec('DELETE FROM object_index WHERE sha = ?', sha)

    return true
  }

  /**
   * Check if an object exists
   */
  async hasObject(sha: string): Promise<boolean> {
    if (!sha || sha.length < 4) {
      return false
    }

    // Use getObject and check for null - this works better with the mock
    const obj = await this.getObject(sha)
    return obj !== null
  }

  /**
   * Verify an object's integrity by recomputing its hash
   */
  async verifyObject(sha: string): Promise<boolean> {
    const obj = await this.getObject(sha)
    if (!obj) {
      return false
    }

    const computedSha = await hashObject(obj.type, obj.data)
    return computedSha === sha
  }

  /**
   * Get object type by SHA
   */
  async getObjectType(sha: string): Promise<ObjectType | null> {
    const obj = await this.getObject(sha)
    return obj?.type ?? null
  }

  /**
   * Get object size by SHA
   */
  async getObjectSize(sha: string): Promise<number | null> {
    const obj = await this.getObject(sha)
    return obj?.size ?? null
  }

  /**
   * Store multiple objects in a batch
   */
  async putObjects(objects: { type: ObjectType; data: Uint8Array }[]): Promise<string[]> {
    const shas: string[] = []
    for (const obj of objects) {
      const sha = await this.putObject(obj.type, obj.data)
      shas.push(sha)
    }
    return shas
  }

  /**
   * Retrieve multiple objects by SHA
   */
  async getObjects(shas: string[]): Promise<(StoredObject | null)[]> {
    const results: (StoredObject | null)[] = []
    for (const sha of shas) {
      const obj = await this.getObject(sha)
      results.push(obj)
    }
    return results
  }

  /**
   * Get a blob object with parsed content
   */
  async getBlobObject(sha: string): Promise<BlobObject | null> {
    const obj = await this.getObject(sha)
    if (!obj || obj.type !== 'blob') {
      return null
    }

    return {
      type: 'blob',
      data: obj.data
    }
  }

  /**
   * Get a tree object with parsed entries
   */
  async getTreeObject(sha: string): Promise<TreeObject | null> {
    const obj = await this.getObject(sha)
    if (!obj || obj.type !== 'tree') {
      return null
    }

    // Parse tree entries from raw data
    const entries: TreeEntry[] = []
    let offset = 0
    const data = obj.data

    while (offset < data.length) {
      // Find the null byte after mode+name
      let nullIndex = offset
      while (nullIndex < data.length && data[nullIndex] !== 0) {
        nullIndex++
      }

      const modeNameStr = decoder.decode(data.slice(offset, nullIndex))
      const spaceIndex = modeNameStr.indexOf(' ')
      const mode = modeNameStr.slice(0, spaceIndex)
      const name = modeNameStr.slice(spaceIndex + 1)

      // Read 20-byte SHA
      const sha20 = data.slice(nullIndex + 1, nullIndex + 21)
      const entrySha = bytesToHex(sha20)

      entries.push({ mode, name, sha: entrySha })
      offset = nullIndex + 21
    }

    return {
      type: 'tree',
      data: obj.data,
      entries
    }
  }

  /**
   * Get a commit object with parsed fields
   */
  async getCommitObject(sha: string): Promise<CommitObject | null> {
    const obj = await this.getObject(sha)
    if (!obj || obj.type !== 'commit') {
      return null
    }

    const content = decoder.decode(obj.data)
    const lines = content.split('\n')

    let tree = ''
    const parents: string[] = []
    let author: Author | null = null
    let committer: Author | null = null
    let messageStartIndex = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line === '') {
        messageStartIndex = i + 1
        break
      }

      if (line.startsWith('tree ')) {
        tree = line.slice(5)
      } else if (line.startsWith('parent ')) {
        parents.push(line.slice(7))
      } else if (line.startsWith('author ')) {
        author = parseAuthorLine(line)
      } else if (line.startsWith('committer ')) {
        committer = parseAuthorLine(line)
      }
    }

    if (!author || !committer) {
      return null
    }

    const message = lines.slice(messageStartIndex).join('\n')

    return {
      type: 'commit',
      data: obj.data,
      tree,
      parents,
      author,
      committer,
      message
    }
  }

  /**
   * Get a tag object with parsed fields
   */
  async getTagObject(sha: string): Promise<TagObject | null> {
    const obj = await this.getObject(sha)
    if (!obj || obj.type !== 'tag') {
      return null
    }

    const content = decoder.decode(obj.data)
    const lines = content.split('\n')

    let object = ''
    let objectType: ObjectType = 'commit'
    let name = ''
    let tagger: Author | null = null
    let messageStartIndex = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line === '') {
        messageStartIndex = i + 1
        break
      }

      if (line.startsWith('object ')) {
        object = line.slice(7)
      } else if (line.startsWith('type ')) {
        objectType = line.slice(5) as ObjectType
      } else if (line.startsWith('tag ')) {
        name = line.slice(4)
      } else if (line.startsWith('tagger ')) {
        tagger = parseAuthorLine(line)
      }
    }

    if (!tagger) {
      return null
    }

    const message = lines.slice(messageStartIndex).join('\n')

    return {
      type: 'tag',
      data: obj.data,
      object,
      objectType,
      name,
      tagger,
      message
    }
  }

  /**
   * Get raw serialized object with git header
   */
  async getRawObject(sha: string): Promise<Uint8Array | null> {
    const obj = await this.getObject(sha)
    if (!obj) {
      return null
    }

    // Build git object format: "type size\0content"
    const header = encoder.encode(`${obj.type} ${obj.data.length}\0`)
    const result = new Uint8Array(header.length + obj.data.length)
    result.set(header)
    result.set(obj.data, header.length)
    return result
  }

  /**
   * Log operation to WAL
   */
  private async logToWAL(
    operation: string,
    sha: string,
    type: ObjectType,
    _data: Uint8Array
  ): Promise<void> {
    // Create payload with operation details
    const payload = encoder.encode(JSON.stringify({
      sha,
      type,
      timestamp: Date.now()
    }))

    this.storage.sql.exec(
      'INSERT INTO wal (operation, payload, created_at, flushed) VALUES (?, ?, ?, 0)',
      operation,
      payload,
      Date.now()
    )
  }
}

/**
 * Helper: Convert hex string to bytes
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

/**
 * Helper: Convert bytes to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Helper: Parse author/committer/tagger line
 */
function parseAuthorLine(line: string): Author {
  const match = line.match(/^(?:author|committer|tagger) (.+) <(.+)> (\d+) ([+-]\d{4})$/)
  if (!match) {
    throw new Error(`Invalid author line: ${line}`)
  }
  return {
    name: match[1],
    email: match[2],
    timestamp: parseInt(match[3], 10),
    timezone: match[4]
  }
}
