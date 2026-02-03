// Loading Spinner Component for gitx terminal UI
// GREEN phase implementation
export function LoadingSpinner(props) {
    const result = {
        type: 'LoadingSpinner',
        props
    };
    if (props.message !== undefined)
        result.message = props.message;
    return result;
}
//# sourceMappingURL=LoadingSpinner.js.map