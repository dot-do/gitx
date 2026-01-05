// Diff View Component for gitx terminal UI
// GREEN phase implementation

import type { ReactNode } from 'react'

export interface DiffViewProps {
  diff: string
  viewMode: 'split' | 'unified'
}

export function DiffView(props: DiffViewProps): ReactNode {
  return {
    type: 'DiffView',
    props,
    diff: props.diff,
    viewMode: props.viewMode
  }
}
