export interface FuzzySearchProps {
    items: string[];
    onSelect: (item: string) => void;
    onCancel: () => void;
    placeholder?: string;
}
export interface FuzzySearchElement {
    type: 'FuzzySearch';
    props: FuzzySearchProps;
    items: string[];
    onSelect: (item: string) => void;
    onCancel: () => void;
}
export declare function FuzzySearch(props: FuzzySearchProps): FuzzySearchElement;
//# sourceMappingURL=FuzzySearch.d.ts.map