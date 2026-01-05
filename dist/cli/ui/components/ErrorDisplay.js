// Error Display Component for gitx terminal UI
// GREEN phase implementation
export function ErrorDisplay(props) {
    const message = props.error instanceof Error ? props.error.message : props.error;
    return {
        type: 'ErrorDisplay',
        props,
        message
    };
}
//# sourceMappingURL=ErrorDisplay.js.map