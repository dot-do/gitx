/**
 * MCP Tool Registry for gitx.do
 *
 * Provides a central registry for MCP tools with:
 * - Tool registration and unregistration
 * - Tool invocation via dispatcher
 * - Built-in git tools
 * - Parameter validation
 * - Middleware support
 *
 * @module mcp/tool-registry
 */
import { gitTools, requiresWriteAccess } from './tools';
// =============================================================================
// Registry Storage
// =============================================================================
/** Internal tool registry map - normalized name to tool */
const toolRegistry = new Map();
/** Set of custom (non-builtin) tool names for cleanup */
const customTools = new Set();
/** Registered middleware stack */
const middlewareStack = [];
/** Set of builtin tool names */
const builtinToolNames = new Set();
// =============================================================================
// Tool Name Utilities
// =============================================================================
/**
 * Normalize a tool name for registry lookup.
 */
function normalizeName(name) {
    return name.toLowerCase().trim();
}
/**
 * Validate a tool name.
 */
function validateToolName(name) {
    if (!name || name.trim() === '') {
        throw new Error('Tool name cannot be empty');
    }
    if (name.includes(' ')) {
        throw new Error('Tool name cannot contain spaces');
    }
    if (/^\d/.test(name)) {
        throw new Error('Tool name cannot start with a number');
    }
}
/**
 * Validate a tool schema.
 */
function validateSchema(schema) {
    if (!schema.inputSchema) {
        throw new Error('Tool schema must have inputSchema');
    }
    if (schema.inputSchema.type !== 'object') {
        throw new Error('Tool inputSchema type must be "object"');
    }
    if (schema.inputSchema.properties === undefined) {
        throw new Error('Tool inputSchema must have properties');
    }
}
// =============================================================================
// Registry Operations
// =============================================================================
/**
 * Register a custom tool.
 */
export function registerTool(schema, handler) {
    validateToolName(schema.name);
    validateSchema(schema);
    const normalizedName = normalizeName(schema.name);
    if (toolRegistry.has(normalizedName)) {
        throw new Error(`Tool "${schema.name}" is already registered`);
    }
    toolRegistry.set(normalizedName, { schema, handler });
    customTools.add(normalizedName);
}
/**
 * Unregister a tool.
 */
export function unregisterTool(name) {
    const normalizedName = normalizeName(name);
    if (!toolRegistry.has(normalizedName)) {
        throw new Error(`Tool "${name}" is not registered`);
    }
    toolRegistry.delete(normalizedName);
    customTools.delete(normalizedName);
}
/**
 * Register middleware that runs on all tool invocations.
 */
export function useMiddleware(middleware) {
    middlewareStack.push(middleware);
}
/**
 * Clear all registered middleware.
 */
export function clearMiddleware() {
    middlewareStack.length = 0;
}
/**
 * Get the tool registry interface.
 */
export function getToolRegistry() {
    return {
        has(name) {
            return toolRegistry.has(normalizeName(name));
        },
        get(name) {
            return toolRegistry.get(normalizeName(name));
        },
        list() {
            return Array.from(toolRegistry.keys());
        },
        schemas() {
            return Array.from(toolRegistry.values()).map((tool) => tool.schema);
        },
        count() {
            return toolRegistry.size;
        },
        filter(predicate) {
            return Array.from(toolRegistry.values()).filter(predicate);
        },
    };
}
/**
 * Clear all custom tools from the registry.
 */
export function clearToolRegistry() {
    for (const name of customTools) {
        toolRegistry.delete(name);
    }
    customTools.clear();
    clearMiddleware();
    registerBuiltinTools();
}
// =============================================================================
// Parameter Validation
// =============================================================================
/**
 * Validate required parameters.
 */
function validateRequiredParams(params, schema) {
    const required = schema.inputSchema.required ?? [];
    for (const paramName of required) {
        if (params[paramName] === undefined || params[paramName] === null) {
            return `Missing required parameter: ${paramName}`;
        }
    }
    return null;
}
/**
 * Validate parameter types.
 */
function validateParamTypes(params, schema) {
    const properties = schema.inputSchema.properties;
    for (const [paramName, value] of Object.entries(params)) {
        const propSchema = properties[paramName];
        if (!propSchema?.type)
            continue;
        const expectedType = propSchema.type;
        const actualType = typeof value;
        if (expectedType === 'number' && actualType !== 'number') {
            return `Parameter "${paramName}" must be a number, got ${actualType}`;
        }
        if (expectedType === 'string' && actualType !== 'string') {
            return `Parameter "${paramName}" must be a string, got ${actualType}`;
        }
        if (expectedType === 'boolean' && actualType !== 'boolean') {
            return `Parameter "${paramName}" must be a boolean, got ${actualType}`;
        }
        if (expectedType === 'array' && !Array.isArray(value)) {
            return `Parameter "${paramName}" must be an array, got ${actualType}`;
        }
    }
    return null;
}
// =============================================================================
// Tool Invocation
// =============================================================================
/**
 * Create error result helper.
 */
function errorResult(message) {
    return {
        content: [{ type: 'text', text: message }],
        isError: true,
    };
}
/**
 * Execute middleware chain with final handler.
 */
function executeWithMiddleware(context, params, handler) {
    if (middlewareStack.length === 0) {
        return handler();
    }
    let index = middlewareStack.length - 1;
    const executeNext = () => {
        if (index < 0) {
            return handler();
        }
        const middleware = middlewareStack[index];
        index--;
        if (!middleware) {
            return handler();
        }
        return middleware(context, params, executeNext);
    };
    index = middlewareStack.length - 1;
    return executeNext();
}
/**
 * Invoke a tool by name.
 */
export async function invokeTool(name, params, storage, options) {
    const safeParams = params ?? {};
    const normalizedName = normalizeName(name);
    const tool = toolRegistry.get(normalizedName);
    if (!tool) {
        return errorResult(`Unknown tool: ${name}`);
    }
    // Validate required parameters
    const requiredError = validateRequiredParams(safeParams, tool.schema);
    if (requiredError) {
        return errorResult(requiredError);
    }
    // Validate parameter types (strict mode)
    if (options?.strictValidation) {
        const typeError = validateParamTypes(safeParams, tool.schema);
        if (typeError) {
            return errorResult(typeError);
        }
    }
    // Check write access if auth context provided
    if (options?.auth) {
        const needsWrite = requiresWriteAccess(normalizedName, safeParams);
        if (needsWrite && options.auth.readonly) {
            return errorResult(`Tool "${name}" requires write access, but context is readonly`);
        }
    }
    // Create invocation context
    const context = {
        toolName: normalizedName,
        timestamp: Date.now(),
        metadata: options?.metadata,
        auth: options?.auth,
    };
    // Handler function
    const executeHandler = async () => {
        try {
            return await tool.handler(safeParams, storage, context);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return errorResult(message);
        }
    };
    // Execute with middleware chain
    return executeWithMiddleware(context, safeParams, executeHandler);
}
// =============================================================================
// Builtin Tool Registration
// =============================================================================
/**
 * Register all builtin git tools.
 */
function registerBuiltinTools() {
    for (const tool of gitTools) {
        const normalizedName = normalizeName(tool.schema.name);
        builtinToolNames.add(normalizedName);
        if (!toolRegistry.has(normalizedName)) {
            toolRegistry.set(normalizedName, tool);
        }
    }
}
/**
 * Check if a tool is a builtin tool.
 */
export function isBuiltinTool(name) {
    return builtinToolNames.has(normalizeName(name));
}
// Initialize builtin tools on module load
registerBuiltinTools();
//# sourceMappingURL=tool-registry.js.map