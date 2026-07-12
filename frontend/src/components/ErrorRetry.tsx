import { memo } from "react"
import { RefreshCw } from "lucide-react"

import { Icon } from "./ui/Icon"

interface ErrorRetryProps {
  readonly message: string
  readonly onRetry: () => void
}

/** A failed action, offline or server-side (P29): message + a way to retry it. */
function ErrorRetryInner({ message, onRetry }: ErrorRetryProps): JSX.Element {
  return (
    <div
      className="mt-4 flex flex-col items-center rounded-2xl bg-surface-raised px-6 py-8 text-center shadow-elev-1"
      data-testid="error-retry"
    >
      <p role="alert" className="max-w-xs text-sm text-red-400">
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium text-gray-300 shadow-elev-1 transition ease-spring hover:text-white active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
        data-testid="error-retry-btn"
      >
        <Icon icon={RefreshCw} size={16} />
        Retry
      </button>
    </div>
  )
}

export const ErrorRetry = memo(ErrorRetryInner)
