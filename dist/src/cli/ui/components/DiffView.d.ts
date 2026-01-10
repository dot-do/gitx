export interface DiffViewProps {
    diff: string;
    viewMode: 'split' | 'unified';
}
export interface DiffViewElement {
    type: 'DiffView';
    props: DiffViewProps;
    diff: string;
    viewMode: 'split' | 'unified';
}
export declare function DiffView(props: DiffViewProps): DiffViewElement;
//# sourceMappingURL=DiffView.d.ts.map