// Terminal UI for gitx CLI using @opentui/react
// GREEN phase implementation - minimum code to pass tests
// ============================================================================
// Terminal UI App Component
// ============================================================================
export function TerminalUIApp(props) {
    // Returns a simple representation of the app
    return {
        type: 'TerminalUIApp',
        props,
        children: props.children
    };
}
// ============================================================================
// Keyboard Input Handler
// ============================================================================
export function handleKeyboardInput(_event) {
    // Handles all keyboard events without throwing
    // Arrow keys, Enter, Escape, vim-style navigation, etc.
    // This is a minimal implementation that just accepts all events
}
// ============================================================================
// Mouse Event Handler
// ============================================================================
export function handleMouseClick(_event) {
    // Handles all mouse click events without throwing
    // Supports left, right, and middle clicks at any coordinates
}
// ============================================================================
// Terminal Dimensions
// ============================================================================
export function getTerminalDimensions() {
    // Get terminal dimensions from process.stdout or fallback to defaults
    const width = process.stdout?.columns ?? 80;
    const height = process.stdout?.rows ?? 24;
    return { width, height };
}
export function adaptLayoutForWidth(width) {
    // Wide layout for terminals >= 120 columns
    // Narrow layout for terminals < 120 columns
    if (width >= 120) {
        return 'wide';
    }
    return 'narrow';
}
// ============================================================================
// Diff View
// ============================================================================
export function DiffView(props) {
    // Returns a representation of the diff view component
    return {
        type: 'DiffView',
        props,
        diff: props.diff,
        viewMode: props.viewMode
    };
}
export function selectDiffViewMode(terminalWidth) {
    // Wide terminals (>= 120 columns) should use split view
    // Narrow terminals (< 120 columns) should use unified view
    if (terminalWidth >= 120) {
        return 'split';
    }
    return 'unified';
}
// ============================================================================
// Loading Spinner
// ============================================================================
export function LoadingSpinner(props) {
    // Returns a representation of the loading spinner component
    return {
        type: 'LoadingSpinner',
        props,
        message: props.message
    };
}
// ============================================================================
// Error Display
// ============================================================================
export function ErrorDisplay(props) {
    // Returns a representation of the error display component
    const message = props.error instanceof Error ? props.error.message : props.error;
    return {
        type: 'ErrorDisplay',
        props,
        message
    };
}
// ============================================================================
// Scrollable Content
// ============================================================================
export function ScrollableContent(props) {
    // Returns a representation of the scrollable content component
    return {
        type: 'ScrollableContent',
        props,
        content: props.content,
        height: props.height
    };
}
// ============================================================================
// Fuzzy Search
// ============================================================================
export function FuzzySearch(props) {
    // Returns a representation of the fuzzy search component
    return {
        type: 'FuzzySearch',
        props,
        items: props.items,
        onSelect: props.onSelect,
        onCancel: props.onCancel
    };
}
// ============================================================================
// Render Function
// ============================================================================
export function render(_element) {
    // Minimal render function that accepts any element
    // In a real implementation, this would render to the terminal
}
//# sourceMappingURL=terminal-ui.js.map