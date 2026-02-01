/**
 * Type declarations for hyparquet module from local fork.
 *
 * @module types/hyparquet
 */

declare module 'hyparquet' {
  export type CompressionCodec =
    | 'UNCOMPRESSED'
    | 'SNAPPY'
    | 'GZIP'
    | 'LZO'
    | 'BROTLI'
    | 'LZ4'
    | 'ZSTD'
    | 'LZ4_RAW'

  export interface SchemaElement {
    name: string
    type?: string
    type_length?: number
    repetition_type?: 'REQUIRED' | 'OPTIONAL' | 'REPEATED'
    num_children?: number
    converted_type?: string
    scale?: number
    precision?: number
    field_id?: number
    logical_type?: {
      type: string
      isAdjustedToUTC?: boolean
      unit?: string
    }
  }

  export type KeyValue = {
    key: string
    value?: string
  }

  export type DecodedArray = unknown[]
  export type Encoding = string
  export type ParquetReadOptions = Record<string, unknown>
  export type FileMetaData = Record<string, unknown>

  export function parquetRead(options: ParquetReadOptions): Promise<void>
  export function parquetReadObjects(options: Omit<ParquetReadOptions, 'onComplete'>): Promise<Record<string, unknown>[]>
  export function parquetMetadata(buffer: ArrayBuffer): FileMetaData
  export function parquetMetadataAsync(buffer: { byteLength: number; slice(start: number, end: number): Promise<ArrayBuffer> }): Promise<FileMetaData>
}
