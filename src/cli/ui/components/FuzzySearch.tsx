// Fuzzy Search Component for gitx terminal UI
// GREEN phase implementation

import type { ReactNode } from 'react'

export interface FuzzySearchProps {
  items: string[]
  onSelect: (item: string) => void
  onCancel: () => void
  placeholder?: string
}

export function FuzzySearch(props: FuzzySearchProps): ReactNode {
  return {
    type: 'FuzzySearch',
    props,
    items: props.items,
    onSelect: props.onSelect,
    onCancel: props.onCancel
  }
}
