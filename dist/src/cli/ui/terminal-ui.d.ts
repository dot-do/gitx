export interface TerminalUIProps {
    children?: unknown;
}
export interface KeyboardEvent {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
}
export interface MouseEvent {
    x: number;
    y: number;
    button: 'left' | 'right' | 'middle';
}
export interface TerminalDimensions {
    width: number;
    height: number;
}
export interface DiffViewProps {
    diff: string;
    viewMode: 'split' | 'unified';
}
export interface LoadingSpinnerProps {
    message?: string;
}
export interface ErrorDisplayProps {
    error: Error | string;
}
export interface ScrollableContentProps {
    content: string;
    height: number;
}
export interface FuzzySearchProps {
    items: string[];
    onSelect: (item: string) => void;
    onCancel: () => void;
}
export interface TerminalUIAppElement {
    type: 'TerminalUIApp';
    props: TerminalUIProps;
    children?: unknown;
}
export interface DiffViewElement {
    type: 'DiffView';
    props: DiffViewProps;
    diff: string;
    viewMode: 'split' | 'unified';
}
export interface LoadingSpinnerElement {
    type: 'LoadingSpinner';
    props: LoadingSpinnerProps;
    message?: string;
}
export interface ErrorDisplayElement {
    type: 'ErrorDisplay';
    props: ErrorDisplayProps;
    message: string;
}
export interface ScrollableContentElement {
    type: 'ScrollableContent';
    props: ScrollableContentProps;
    content: string;
    height: number;
}
export interface FuzzySearchElement {
    type: 'FuzzySearch';
    props: FuzzySearchProps;
    items: string[];
    onSelect: (item: string) => void;
    onCancel: () => void;
}
export declare function TerminalUIApp(props: TerminalUIProps): TerminalUIAppElement;
export declare function handleKeyboardInput(_event: KeyboardEvent): void;
export declare function handleMouseClick(_event: MouseEvent): void;
export declare function getTerminalDimensions(): TerminalDimensions;
export declare function adaptLayoutForWidth(width: number): 'wide' | 'narrow';
export declare function DiffView(props: DiffViewProps): DiffViewElement;
export declare function selectDiffViewMode(terminalWidth: number): 'split' | 'unified';
export declare function LoadingSpinner(props: LoadingSpinnerProps): LoadingSpinnerElement;
export declare function ErrorDisplay(props: ErrorDisplayProps): ErrorDisplayElement;
export declare function ScrollableContent(props: ScrollableContentProps): ScrollableContentElement;
export declare function FuzzySearch(props: FuzzySearchProps): FuzzySearchElement;
export declare function render(_element: unknown): void;
//# sourceMappingURL=terminal-ui.d.ts.map