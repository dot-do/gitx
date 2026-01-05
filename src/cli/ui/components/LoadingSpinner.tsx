// Loading Spinner Component for gitx terminal UI
// GREEN phase implementation

import type { ReactNode } from 'react'

export interface LoadingSpinnerProps {
  message?: string
}

export function LoadingSpinner(props: LoadingSpinnerProps): ReactNode {
  return {
    type: 'LoadingSpinner',
    props,
    message: props.message
  }
}
