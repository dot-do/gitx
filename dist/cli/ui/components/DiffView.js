// Diff View Component for gitx terminal UI
// GREEN phase implementation
export function DiffView(props) {
    return {
        type: 'DiffView',
        props,
        diff: props.diff,
        viewMode: props.viewMode
    };
}
//# sourceMappingURL=DiffView.js.map