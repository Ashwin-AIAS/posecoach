import { memo } from "react"
import { LogIn } from "lucide-react"

import { Icon } from "./ui/Icon"

interface SignInPromptProps {
  /** Contextual copy, e.g. "Sign in to track workouts". */
  readonly message: string
  readonly onSignIn?: () => void
}

/**
 * Shown wherever an authenticated action 401s (P29): every workouts/nutrition
 * route requires sign-in, so a signed-out tap should explain why and offer a
 * way there, not fail silently. `onSignIn` deep-links to the Settings tab.
 */
function SignInPromptInner({ message, onSignIn }: SignInPromptProps): JSX.Element {
  return (
    <div
      className="mt-4 flex flex-col items-center rounded-2xl bg-surface-raised px-6 py-8 text-center shadow-elev-1"
      data-testid="sign-in-prompt"
    >
      <p className="max-w-xs text-sm text-gray-300">{message}</p>
      <button
        type="button"
        onClick={onSignIn}
        className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-gray-950 transition ease-spring hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
        data-testid="sign-in-prompt-btn"
      >
        <Icon icon={LogIn} size={16} />
        Sign in
      </button>
    </div>
  )
}

export const SignInPrompt = memo(SignInPromptInner)
