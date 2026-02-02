// Loading Spinner Component for gitx terminal UI
// GREEN phase implementation

export interface LoadingSpinnerProps {
  message?: string
}

export interface LoadingSpinnerElement {
  type: 'LoadingSpinner'
  props: LoadingSpinnerProps
  message?: string
}

export function LoadingSpinner(props: LoadingSpinnerProps): LoadingSpinnerElement {
  const result: LoadingSpinnerElement = {
    type: 'LoadingSpinner',
    props
  }
  if (props.message !== undefined) result.message = props.message
  return result
}
