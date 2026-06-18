import { memo, type ReactNode } from "react"

interface CollapsibleSelectProps {
  /** Compact trigger-row content shown to the left of the "Change" button. */
  readonly label: ReactNode
  readonly open: boolean
  readonly onToggle: () => void
  readonly dialogLabel: string
  readonly children: ReactNode
  readonly disabled?: boolean
  readonly triggerTestId?: string
}

/**
 * Generic "collapsed chip, expand on tap" disclosure (P21). Keeps a picker row
 * to a single compact line; tapping "Change" opens a centered sheet with the
 * full option list (passed as children) and closes on select / tap-outside.
 */
function CollapsibleSelectInner({
  label,
  open,
  onToggle,
  dialogLabel,
  children,
  disabled = false,
  triggerTestId,
}: CollapsibleSelectProps): JSX.Element {
  return (
    <div className="relative min-w-0">
      <div className="flex min-w-0 items-center gap-3">
        {label}
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="true"
          className="flex min-h-11 shrink-0 items-center justify-center rounded-full bg-surface-raised px-3 text-xs font-medium text-gray-300 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:text-white disabled:translate-y-0 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid={triggerTestId}
        >
          Change ▾
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center bg-black/70 p-4 pt-20 backdrop-blur-sm"
          onClick={onToggle}
          role="dialog"
          aria-modal="true"
          aria-label={dialogLabel}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[70vh] w-full max-w-[640px] overflow-y-auto rounded-2xl bg-surface-raised p-4 shadow-elev-3 animate-scale-in"
          >
            {children}
          </div>
        </div>
      )}
    </div>
  )
}

export const CollapsibleSelect = memo(CollapsibleSelectInner)
