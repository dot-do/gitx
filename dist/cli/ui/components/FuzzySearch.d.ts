import type { ReactNode } from 'react';
export interface FuzzySearchProps {
    items: string[];
    onSelect: (item: string) => void;
    onCancel: () => void;
    placeholder?: string;
}
export declare function FuzzySearch(props: FuzzySearchProps): ReactNode;
//# sourceMappingURL=FuzzySearch.d.ts.map