/**
 * Git Packfile Format Implementation
 *
 * The packfile format is used by git for efficient storage and transfer of objects.
 * Format:
 * - 4 bytes: "PACK" signature
 * - 4 bytes: version number (network byte order, big-endian)
 * - 4 bytes: number of objects (network byte order)
 * - N objects: each object has header + compressed data
 * - 20 bytes: SHA-1 checksum of all preceding content
 *
 * Object header encoding:
 * - First byte: (MSB) continuation bit | 3-bit type | 4-bit size LSB
 * - Subsequent bytes: (MSB) continuation bit | 7-bit size
 *
 * Object types:
 * - 1: commit
 * - 2: tree
 * - 3: blob
 * - 4: tag
 * - 6: ofs_delta (offset delta)
 * - 7: ref_delta (reference delta)
 */

import pako from 'pako'
import { sha1 } from '../utils/sha1'

// Constants
export const PACK_SIGNATURE = 'PACK'
export const PACK_VERSION = 2

// Pack object types
export enum PackObjectType {
  OBJ_COMMIT = 1,
  OBJ_TREE = 2,
  OBJ_BLOB = 3,
  OBJ_TAG = 4,
  OBJ_OFS_DELTA = 6,
  OBJ_REF_DELTA = 7
}

// Type conversion utilities
export function packObjectTypeToString(type: PackObjectType): string {
  switch (type) {
    case PackObjectType.OBJ_COMMIT:
      return 'commit'
    case PackObjectType.OBJ_TREE:
      return 'tree'
    case PackObjectType.OBJ_BLOB:
      return 'blob'
    case PackObjectType.OBJ_TAG:
      return 'tag'
    case PackObjectType.OBJ_OFS_DELTA:
      return 'ofs_delta'
    case PackObjectType.OBJ_REF_DELTA:
      return 'ref_delta'
    default:
      throw new Error(`Invalid pack object type: ${type}`)
  }
}

export function stringToPackObjectType(str: string): PackObjectType {
  switch (str) {
    case 'commit':
      return PackObjectType.OBJ_COMMIT
    case 'tree':
      return PackObjectType.OBJ_TREE
    case 'blob':
      return PackObjectType.OBJ_BLOB
    case 'tag':
      return PackObjectType.OBJ_TAG
    default:
      throw new Error(`Invalid object type string: ${str}`)
  }
}

// Variable-length integer encoding (similar to Git's varint encoding)
export function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = []

  // Encode value in 7-bit chunks with continuation bit
  do {
    let byte = value & 0x7f
    value >>>= 7
    if (value > 0) {
      byte |= 0x80 // Set continuation bit
    }
    bytes.push(byte)
  } while (value > 0)

  return new Uint8Array(bytes)
}

export function decodeVarint(data: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = 0
  let shift = 0
  let bytesRead = 0

  // Maximum bytes for a 64-bit varint is 10 (ceil(64/7))
  // For JavaScript's safe integer range, 8 bytes is sufficient
  const MAX_VARINT_BYTES = 10

  while (true) {
    if (offset + bytesRead >= data.length) {
      throw new Error(`Varint decoding failed: unexpected end of data at offset ${offset + bytesRead}`)
    }
    if (bytesRead >= MAX_VARINT_BYTES) {
      throw new Error(`Varint decoding failed: exceeded maximum length of ${MAX_VARINT_BYTES} bytes (possible infinite loop or corrupted data)`)
    }

    const byte = data[offset + bytesRead]
    bytesRead++
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) {
      break
    }
    shift += 7
  }

  return { value, bytesRead }
}

/**
 * Encode object type and size into pack object header format
 *
 * First byte: MSB continuation bit | 3-bit type | 4-bit size LSB
 * Subsequent bytes: MSB continuation bit | 7-bit size continuation
 */
export function encodeTypeAndSize(type: PackObjectType, size: number): Uint8Array {
  const bytes: number[] = []

  // First byte: continuation bit (if needed) | type (3 bits) | size low 4 bits
  let firstByte = (type << 4) | (size & 0x0f)
  size >>>= 4

  if (size > 0) {
    firstByte |= 0x80 // Set continuation bit
  }
  bytes.push(firstByte)

  // Subsequent bytes: continuation bit | 7 bits of size
  while (size > 0) {
    let byte = size & 0x7f
    size >>>= 7
    if (size > 0) {
      byte |= 0x80
    }
    bytes.push(byte)
  }

  return new Uint8Array(bytes)
}

export function decodeTypeAndSize(data: Uint8Array, offset: number): {
  type: PackObjectType
  size: number
  bytesRead: number
} {
  // Maximum bytes for type+size header (first byte + continuation bytes)
  // Similar to varint, limit to prevent infinite loops
  const MAX_HEADER_BYTES = 10

  if (offset >= data.length) {
    throw new Error(`decodeTypeAndSize failed: offset ${offset} is beyond data length ${data.length}`)
  }

  let bytesRead = 0
  const firstByte = data[offset + bytesRead]
  bytesRead++

  // Extract type (bits 4-6 of first byte)
  const type = ((firstByte >> 4) & 0x07) as PackObjectType

  // Extract initial size (low 4 bits)
  let size = firstByte & 0x0f
  let shift = 4

  // Read continuation bytes if MSB is set
  if (firstByte & 0x80) {
    while (true) {
      if (offset + bytesRead >= data.length) {
        throw new Error(`decodeTypeAndSize failed: unexpected end of data at offset ${offset + bytesRead}`)
      }
      if (bytesRead >= MAX_HEADER_BYTES) {
        throw new Error(`decodeTypeAndSize failed: exceeded maximum header length of ${MAX_HEADER_BYTES} bytes (possible infinite loop or corrupted data)`)
      }

      const byte = data[offset + bytesRead]
      bytesRead++
      size |= (byte & 0x7f) << shift
      shift += 7
      if ((byte & 0x80) === 0) {
        break
      }
    }
  }

  return { type, size, bytesRead }
}

// Pack header structure
export interface PackHeader {
  signature: string
  version: number
  objectCount: number
}

/**
 * Parse pack file header
 * @param data - The packfile data
 * @returns Parsed header information
 */
export function parsePackHeader(data: Uint8Array): PackHeader {
  if (data.length < 12) {
    throw new Error('Packfile header too short: expected at least 12 bytes')
  }

  // Read signature (4 bytes)
  const signature = String.fromCharCode(data[0], data[1], data[2], data[3])
  if (signature !== PACK_SIGNATURE) {
    throw new Error(`Invalid pack signature: expected "${PACK_SIGNATURE}", got "${signature}"`)
  }

  // Read version (4 bytes, big-endian)
  const version = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7]
  if (version !== 2) {
    throw new Error(`Unsupported pack version: ${version} (only version 2 is supported)`)
  }

  // Read object count (4 bytes, big-endian)
  const objectCount = (data[8] << 24) | (data[9] << 16) | (data[10] << 8) | data[11]

  return { signature, version, objectCount }
}

// Parsed pack object structure
export interface ParsedPackObject {
  type: PackObjectType
  size: number
  headerSize: number
}

/**
 * Parse individual pack object header
 * Note: This only parses the header, not the compressed data
 */
export function parsePackObject(data: Uint8Array, offset: number): ParsedPackObject {
  const { type, size, bytesRead } = decodeTypeAndSize(data, offset)

  return {
    type,
    size,
    headerSize: bytesRead
  }
}

// Object for creating packfile
export interface PackableObject {
  type: 'blob' | 'tree' | 'commit' | 'tag'
  data: Uint8Array
}

/**
 * Create a packfile from a list of objects
 * @param objects - Array of objects to pack
 * @returns Complete packfile as Uint8Array
 */
export function createPackfile(objects: PackableObject[]): Uint8Array {
  const parts: Uint8Array[] = []

  // Create header
  const header = new Uint8Array(12)
  // Signature: "PACK"
  header[0] = 0x50 // P
  header[1] = 0x41 // A
  header[2] = 0x43 // C
  header[3] = 0x4b // K
  // Version: 2 (big-endian)
  header[4] = 0
  header[5] = 0
  header[6] = 0
  header[7] = 2
  // Object count (big-endian)
  const count = objects.length
  header[8] = (count >> 24) & 0xff
  header[9] = (count >> 16) & 0xff
  header[10] = (count >> 8) & 0xff
  header[11] = count & 0xff

  parts.push(header)

  // Add each object
  for (const obj of objects) {
    const type = stringToPackObjectType(obj.type)
    const typeAndSize = encodeTypeAndSize(type, obj.data.length)

    // Compress the data using zlib deflate
    const compressed = pako.deflate(obj.data)

    parts.push(typeAndSize)
    parts.push(compressed)
  }

  // Calculate total length
  let totalLength = 0
  for (const part of parts) {
    totalLength += part.length
  }

  // Combine all parts
  const packData = new Uint8Array(totalLength)
  let offset = 0
  for (const part of parts) {
    packData.set(part, offset)
    offset += part.length
  }

  // Calculate SHA-1 checksum of the pack data
  const checksum = sha1(packData)

  // Create final packfile with checksum
  const finalPack = new Uint8Array(packData.length + 20)
  finalPack.set(packData, 0)
  finalPack.set(checksum, packData.length)

  return finalPack
}
