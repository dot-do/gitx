// Navigation List Component for gitx terminal UI
// GREEN phase implementation

import type { ReactNode } from 'react'

export interface NavigationListProps {
  items: string[]
  selectedIndex: number
  onSelect: (index: number) => void
  onNavigate: (direction: 'up' | 'down') => void
}

export function NavigationList(props: NavigationListProps): ReactNode {
  return {
    type: 'NavigationList',
    props,
    items: props.items,
    selectedIndex: props.selectedIndex
  }
}
