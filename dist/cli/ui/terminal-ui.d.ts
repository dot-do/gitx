import type { ReactNode } from 'react';
export interface TerminalUIProps {
    children?: ReactNode;
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
export declare function TerminalUIApp(props: TerminalUIProps): ReactNode;
export declare function handleKeyboardInput(_event: KeyboardEvent): void;
export declare function handleMouseClick(_event: MouseEvent): void;
export declare function getTerminalDimensions(): TerminalDimensions;
export declare function adaptLayoutForWidth(width: number): 'wide' | 'narrow';
export declare function DiffView(props: DiffViewProps): ReactNode;
export declare function selectDiffViewMode(terminalWidth: number): 'split' | 'unified';
export declare function LoadingSpinner(props: LoadingSpinnerProps): ReactNode;
export declare function ErrorDisplay(props: ErrorDisplayProps): ReactNode;
export declare function ScrollableContent(props: ScrollableContentProps): ReactNode;
export declare function FuzzySearch(props: FuzzySearchProps): ReactNode;
export declare function render(_element: ReactNode): void;
//# sourceMappingURL=terminal-ui.d.ts.map