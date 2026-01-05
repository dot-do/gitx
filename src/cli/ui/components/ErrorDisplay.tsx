// Error Display Component for gitx terminal UI
// GREEN phase implementation

import type { ReactNode } from 'react'

export interface ErrorDisplayProps {
  error: Error | string
}

export function ErrorDisplay(props: ErrorDisplayProps): ReactNode {
  const message = props.error instanceof Error ? props.error.message : props.error
  return {
    type: 'ErrorDisplay',
    props,
    message
  }
}
