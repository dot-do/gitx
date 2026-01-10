// Fuzzy Search Component for gitx terminal UI
// GREEN phase implementation
export function FuzzySearch(props) {
    return {
        type: 'FuzzySearch',
        props,
        items: props.items,
        onSelect: props.onSelect,
        onCancel: props.onCancel
    };
}
//# sourceMappingURL=FuzzySearch.js.map