export interface ErrorDisplayProps {
    error: Error | string;
}
export interface ErrorDisplayElement {
    type: 'ErrorDisplay';
    props: ErrorDisplayProps;
    message: string;
}
export declare function ErrorDisplay(props: ErrorDisplayProps): ErrorDisplayElement;
//# sourceMappingURL=ErrorDisplay.d.ts.map