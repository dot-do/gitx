export interface ScrollableContentProps {
    content: string;
    height: number;
    onScroll?: (scrollPosition: number) => void;
}
export interface ScrollableContentElement {
    type: 'ScrollableContent';
    props: ScrollableContentProps;
    content: string;
    height: number;
}
export declare function ScrollableContent(props: ScrollableContentProps): ScrollableContentElement;
//# sourceMappingURL=ScrollableContent.d.ts.map