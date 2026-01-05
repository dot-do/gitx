// Scrollable Content Component for gitx terminal UI
// GREEN phase implementation

import type { ReactNode } from 'react'

export interface ScrollableContentProps {
  content: string
  height: number
  onScroll?: (scrollPosition: number) => void
}

export function ScrollableContent(props: ScrollableContentProps): ReactNode {
  return {
    type: 'ScrollableContent',
    props,
    content: props.content,
    height: props.height
  }
}
