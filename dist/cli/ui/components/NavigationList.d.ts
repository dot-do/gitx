import type { ReactNode } from 'react';
export interface NavigationListProps {
    items: string[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    onNavigate: (direction: 'up' | 'down') => void;
}
export declare function NavigationList(props: NavigationListProps): ReactNode;
//# sourceMappingURL=NavigationList.d.ts.map