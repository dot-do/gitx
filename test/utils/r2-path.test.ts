/**
 * @fileoverview Tests for R2 path utilities
 *
 * These tests ensure the R2 path conversion functions work correctly
 * for both r2:// URLs and direct paths.
 */

import { describe, it, expect } from 'vitest'
import {
  r2PathFromLocation,
  r2PathWithPrefix,
  createR2PathConverter,
} from '../../src/utils/r2-path'

// ============================================================================
// r2PathFromLocation Tests
// ============================================================================

describe('r2PathFromLocation', () => {
  describe('r2:// URL conversion', () => {
    it('should convert r2:// URL to bucket path', () => {
      expect(r2PathFromLocation('r2://my-bucket/data/file.parquet'))
        .toBe('data/file.parquet')
    })

    it('should handle single-level paths', () => {
      expect(r2PathFromLocation('r2://bucket/file.json'))
        .toBe('file.json')
    })

    it('should handle deeply nested paths', () => {
      expect(r2PathFromLocation('r2://analytics-bucket/owner/repo/objects/v1.parquet'))
        .toBe('owner/repo/objects/v1.parquet')
    })

    it('should handle bucket names with hyphens', () => {
      expect(r2PathFromLocation('r2://my-analytics-bucket/path/to/file'))
        .toBe('path/to/file')
    })

    it('should handle bucket names with numbers', () => {
      expect(r2PathFromLocation('r2://bucket123/data/file.parquet'))
        .toBe('data/file.parquet')
    })

    it('should handle empty path after bucket', () => {
      // Edge case: r2://bucket/ should return empty string
      expect(r2PathFromLocation('r2://bucket/'))
        .toBe('')
    })
  })

  describe('direct path passthrough', () => {
    it('should return direct paths unchanged', () => {
      expect(r2PathFromLocation('data/file.parquet'))
        .toBe('data/file.parquet')
    })

    it('should return absolute paths unchanged', () => {
      expect(r2PathFromLocation('/absolute/path/file.json'))
        .toBe('/absolute/path/file.json')
    })

    it('should return simple filenames unchanged', () => {
      expect(r2PathFromLocation('file.parquet'))
        .toBe('file.parquet')
    })

    it('should not modify paths with "r2" in them', () => {
      expect(r2PathFromLocation('data/r2-files/archive.parquet'))
        .toBe('data/r2-files/archive.parquet')
    })

    it('should not modify https:// URLs', () => {
      expect(r2PathFromLocation('https://example.com/file.parquet'))
        .toBe('https://example.com/file.parquet')
    })
  })
})

// ============================================================================
// r2PathWithPrefix Tests
// ============================================================================

describe('r2PathWithPrefix', () => {
  describe('with prefix', () => {
    it('should prepend prefix to r2:// URL path', () => {
      expect(r2PathWithPrefix('r2://bucket/data/file.parquet', 'analytics'))
        .toBe('analytics/data/file.parquet')
    })

    it('should prepend prefix to direct path', () => {
      expect(r2PathWithPrefix('data/file.parquet', 'analytics'))
        .toBe('analytics/data/file.parquet')
    })

    it('should handle nested prefixes', () => {
      expect(r2PathWithPrefix('r2://bucket/file.parquet', 'org/repo'))
        .toBe('org/repo/file.parquet')
    })
  })

  describe('without prefix', () => {
    it('should work with empty string prefix', () => {
      expect(r2PathWithPrefix('r2://bucket/data/file.parquet', ''))
        .toBe('data/file.parquet')
    })

    it('should work with undefined prefix', () => {
      expect(r2PathWithPrefix('r2://bucket/data/file.parquet', undefined))
        .toBe('data/file.parquet')
    })

    it('should work with no second argument', () => {
      expect(r2PathWithPrefix('r2://bucket/data/file.parquet'))
        .toBe('data/file.parquet')
    })
  })

  describe('edge cases', () => {
    it('should handle prefix with trailing slash', () => {
      // The function adds a slash between prefix and path
      // If prefix has trailing slash, result may have double slash
      // This tests current behavior - may want to normalize
      expect(r2PathWithPrefix('r2://bucket/file.parquet', 'prefix/'))
        .toBe('prefix//file.parquet')
    })

    it('should handle empty path after r2:// conversion', () => {
      expect(r2PathWithPrefix('r2://bucket/', 'analytics'))
        .toBe('analytics/')
    })
  })
})

// ============================================================================
// createR2PathConverter Tests
// ============================================================================

describe('createR2PathConverter', () => {
  it('should create a converter with bound prefix', () => {
    const toPath = createR2PathConverter('analytics')

    expect(toPath('r2://bucket/data/file1.parquet'))
      .toBe('analytics/data/file1.parquet')
    expect(toPath('r2://bucket/data/file2.parquet'))
      .toBe('analytics/data/file2.parquet')
  })

  it('should create a converter without prefix', () => {
    const toPath = createR2PathConverter()

    expect(toPath('r2://bucket/data/file.parquet'))
      .toBe('data/file.parquet')
  })

  it('should create a converter with empty prefix', () => {
    const toPath = createR2PathConverter('')

    expect(toPath('r2://bucket/data/file.parquet'))
      .toBe('data/file.parquet')
  })

  it('should handle direct paths with converter', () => {
    const toPath = createR2PathConverter('prefix')

    expect(toPath('direct/path/file.parquet'))
      .toBe('prefix/direct/path/file.parquet')
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration scenarios', () => {
  it('should work for Iceberg metadata paths', () => {
    const toPath = createR2PathConverter('gitx')
    const metadataPath = 'r2://analytics-bucket/owner/repo/metadata/v1.metadata.json'

    expect(toPath(metadataPath))
      .toBe('gitx/owner/repo/metadata/v1.metadata.json')
  })

  it('should work for Iceberg data file paths', () => {
    const prefix = 'warehouse'
    const dataFilePath = 'r2://iceberg-data/namespace/table/data/00001.parquet'

    expect(r2PathWithPrefix(dataFilePath, prefix))
      .toBe('warehouse/namespace/table/data/00001.parquet')
  })

  it('should work for manifest list paths', () => {
    const toPath = createR2PathConverter('')
    const manifestPath = 'r2://bucket/namespace/table/metadata/snap-123456.avro'

    expect(toPath(manifestPath))
      .toBe('namespace/table/metadata/snap-123456.avro')
  })
})
