/**
 * @fileoverview Base DO class for GitRepoDO and other Durable Objects.
 *
 * Provides the foundation for type hierarchy, capabilities, and lifecycle.
 *
 * @module do/DO
 */
import type { DOState, BaseEnv } from './types';
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
export declare class DO<TEnv extends BaseEnv = BaseEnv> {
    static $type: string;
    protected state: DOState;
    protected env: TEnv;
    protected _ns?: string;
    protected _capabilities: Set<string>;
    protected _initialized: boolean;
    protected _startTime: number;
    constructor(state: DOState, env: TEnv);
    /**
     * Get the static $type of this DO class.
     */
    get $type(): string;
    /**
     * Get the namespace of this DO instance.
     */
    get ns(): string | undefined;
    /**
     * Check if this DO has been initialized.
     */
    get initialized(): boolean;
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
    getTypeHierarchy(): string[];
    /**
     * Check if this DO is an instance of a specific type.
     * Returns true if the type is in the hierarchy.
     *
     * @param typeName - Type name to check
     * @returns True if DO is instance of type
     */
    isInstanceOfType(typeName: string): boolean;
    /**
     * Check if this DO is exactly a specific type (not a subtype).
     *
     * @param typeName - Type name to check
     * @returns True if DO is exactly this type
     */
    isType(typeName: string): boolean;
    /**
     * Check if this DO extends a specific type.
     * Alias for isInstanceOfType.
     *
     * @param typeName - Type name to check
     * @returns True if DO extends this type
     */
    extendsType(typeName: string): boolean;
    /**
     * Check if this DO has a specific capability.
     *
     * @param capability - Capability name to check
     * @returns True if DO has this capability
     */
    hasCapability(capability: string): boolean;
    /**
     * Get all capabilities of this DO.
     *
     * @returns Array of capability names
     */
    getCapabilities(): string[];
    /**
     * Convert to JSON representation.
     *
     * @returns JSON-serializable object
     */
    toJSON(): Record<string, unknown>;
    /**
     * Get the underlying storage.
     * Protected method for subclasses.
     */
    protected get storage(): import("./types").DOStorage<unknown>;
    /**
     * Get the DO ID as a string.
     */
    protected get id(): string;
}
/**
 * Check if a value is a DO instance.
 *
 * @param value - Value to check
 * @returns True if value is a DO
 */
export declare function isDO(value: unknown): value is DO;
//# sourceMappingURL=do-base.d.ts.map