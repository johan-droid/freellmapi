import { Component, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    message: '',
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || 'Unexpected dashboard error',
    }
  }

  componentDidCatch(error: Error) {
    console.error('[dashboard] uncaught render error', error)
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div className="flex min-h-[320px] items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center">
          <h2 className="text-base font-medium">Dashboard crashed</h2>
          <p className="mt-2 text-sm text-muted-foreground">{this.state.message}</p>
          <div className="mt-4 flex justify-center">
            <Button onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
