export interface NavigationListProps {
    items: string[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    onNavigate: (direction: 'up' | 'down') => void;
}
export interface NavigationListElement {
    type: 'NavigationList';
    props: NavigationListProps;
    items: string[];
    selectedIndex: number;
}
export declare function NavigationList(props: NavigationListProps): NavigationListElement;
//# sourceMappingURL=NavigationList.d.ts.map