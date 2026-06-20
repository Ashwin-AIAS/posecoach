import { ChevronDown } from "lucide-react"
import { memo, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { Icon } from "./ui/Icon"

interface CollapsibleSelectProps {
  /** Compact trigger-row content shown to the left of the chevron button. */
  readonly label: ReactNode
  readonly open: boolean
  readonly onToggle: () => void
  readonly dialogLabel: string
  /** Accessible name for the icon-only trigger button, e.g. "Change pose". */
  readonly triggerAriaLabel: string
  readonly children: ReactNode
  readonly disabled?: boolean
  readonly triggerTestId?: string
}

/**
 * Generic "collapsed chip, expand on tap" disclosure (P21). Keeps a picker row
 * to a single compact line; tapping the chevron opens a centered sheet with
 * the full option list (passed as children) and closes on select / tap-outside.
 * Icon-only trigger (not a text "Change" button) so two or three of these can
 * share one row down to a 320px phone without wrapping.
 */
function CollapsibleSelectInner({
  label,
  open,
  onToggle,
  dialogLabel,
  triggerAriaLabel,
  children,
  disabled = false,
  triggerTestId,
}: CollapsibleSelectProps): JSX.Element {
  return (
    <div className="relative min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        {label}
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="true"
          aria-label={triggerAriaLabel}
          title={triggerAriaLabel}
          className="grid h-11 w-11 shrink-0 place-content-center rounded-full bg-surface-raised text-gray-300 shadow-elev-1 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] hover:text-white disabled:translate-y-0 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid={triggerTestId}
        >
          <Icon icon={ChevronDown} size={15} />
        </button>
      </div>

      {open &&
        // P23: portal to document.body. The trigger row above is a descendant
        // of `selector-row`, which is itself `relative z-20` — a positioned
        // ancestor that creates its own stacking context. A nested `fixed
        // z-40` cannot escape that local context to out-rank a *sibling*
        // element like the app header (`z-30` at the document root), so
        // without the portal this sheet rendered visually under the header on
        // short phones. Portaling makes it a direct child of <body>, in the
        // same root stacking context as the header, where z-40 actually wins.
        createPortal(
          <div
            className="fixed inset-0 z-40 flex items-start justify-center bg-black/70 p-4 backdrop-blur-sm"
            // Clears the app header (its own height = safe-area-inset-top +
            // ~3.25rem of button row) instead of a flat pt-20, which fell
            // short on notch/Dynamic-Island phones and let this sheet's first
            // child render under the header.
            style={{ paddingTop: "calc(max(0.375rem, env(safe-area-inset-top)) + 3.25rem)" }}
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
          </div>,
          document.body,
        )}
    </div>
  )
}

export const CollapsibleSelect = memo(CollapsibleSelectInner)
