/**
 * @fileoverview Code Template Generator for Sandbox Execution
 *
 * Generates secure wrapper code for sandboxed execution.
 */
/**
 * Validates user code for dangerous patterns that could escape the sandbox
 */
export declare function validateUserCode(code: string): {
    valid: boolean;
    error?: string;
};
/**
 * Generates sandbox wrapper code for user code execution
 */
export declare function generateSandboxCode(userCode: string): string;
//# sourceMappingURL=template.d.ts.map