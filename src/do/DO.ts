/**
 * @fileoverview Base DO class for GitRepoDO and other Durable Objects.
 *
 * Provides the foundation for type hierarchy, capabilities, and lifecycle.
 *
 * @module do/DO
 */

import type { DOState, BaseEnv } from './types'

// ============================================================================
// DO Base Class
// ============================================================================

/**
 * Base DO class that provides common functionality for all Durable Objects.
 *
 * Features:
 * - Type hierarchy with static $type property
 * - Capability tracking
 * - Namespace management
 * - JSON serialization
 *
 * @example
 * ```typescript
 * class MyDO extends DO {
 *   static override $type = 'MyDO'
 *
 *   constructor(state: DOState, env: MyEnv) {
 *     super(state, env)
 *     this._capabilities.add('custom')
 *   }
 * }
 * ```
 */
export class DO<TEnv extends BaseEnv = BaseEnv> {
  static $type = 'DO'

  protected state: DOState
  protected env: TEnv
  protected _ns?: string
  protected _capabilities: Set<string> = new Set()
  protected _initialized = false
  protected _startTime: number = Date.now()

  constructor(state: DOState, env: TEnv) {
    this.state = state
    this.env = env
  }

  /**
   * Get the static $type of this DO class.
   */
  get $type(): string {
    return (this.constructor as typeof DO).$type
  }

  /**
   * Get the namespace of this DO instance.
   */
  get ns(): string | undefined {
    return this._ns
  }

  /**
   * Check if this DO has been initialized.
   */
  get initialized(): boolean {
    return this._initialized
  }

  /**
   * Get the type hierarchy for this DO.
   * Returns an array from most specific to least specific type.
   *
   * @example
   * ```typescript
   * const hierarchy = repo.getTypeHierarchy()
   * // ['GitRepoDO', 'DO']
   * ```
   */
  getTypeHierarchy(): string[] {
    const hierarchy: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let current: any = this.constructor

    while (current && current.$type) {
      hierarchy.push(current.$type)
      current = Object.getPrototypeOf(current)
    }

    return hierarchy
  }

  /**
   * Check if this DO is an instance of a specific type.
   * Returns true if the type is in the hierarchy.
   *
   * @param typeName - Type name to check
   * @returns True if DO is instance of type
   */
  isInstanceOfType(typeName: string): boolean {
    return this.getTypeHierarchy().includes(typeName)
  }

  /**
   * Check if this DO is exactly a specific type (not a subtype).
   *
   * @param typeName - Type name to check
   * @returns True if DO is exactly this type
   */
  isType(typeName: string): boolean {
    return this.$type === typeName
  }

  /**
   * Check if this DO extends a specific type.
   * Alias for isInstanceOfType.
   *
   * @param typeName - Type name to check
   * @returns True if DO extends this type
   */
  extendsType(typeName: string): boolean {
    return this.isInstanceOfType(typeName)
  }

  /**
   * Check if this DO has a specific capability.
   *
   * @param capability - Capability name to check
   * @returns True if DO has this capability
   */
  hasCapability(capability: string): boolean {
    return this._capabilities.has(capability)
  }

  /**
   * Get all capabilities of this DO.
   *
   * @returns Array of capability names
   */
  getCapabilities(): string[] {
    return Array.from(this._capabilities)
  }

  /**
   * Convert to JSON representation.
   *
   * @returns JSON-serializable object
   */
  toJSON(): Record<string, unknown> {
    return {
      $type: this.$type,
      ns: this._ns,
      capabilities: Array.from(this._capabilities),
      initialized: this._initialized,
    }
  }

  /**
   * Get the underlying storage.
   * Protected method for subclasses.
   */
  protected get storage() {
    return this.state.storage
  }

  /**
   * Get the DO ID as a string.
   */
  protected get id(): string {
    return this.state.id.toString()
  }
}

// ============================================================================
// Type Guard
// ============================================================================

/**
 * Check if a value is a DO instance.
 *
 * @param value - Value to check
 * @returns True if value is a DO
 */
export function isDO(value: unknown): value is DO {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.$type === 'string' &&
    typeof candidate.hasCapability === 'function' &&
    typeof candidate.getTypeHierarchy === 'function'
  )
}
