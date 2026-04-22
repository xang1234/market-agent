import { createContext } from 'react'

// Metadata attached to a pending protected action. The `action` closure is
// invoked once when auth transitions from signed-out to signed-in (or runs
// immediately if the user is already authed when the action is requested).
// `title` / `description` populate the interrupt modal.
export type ProtectedActionRequest = {
  title: string
  description?: string
  action: () => void
}

export type AuthInterruptContextValue = {
  // Request a protected action. If the user is authed, the action runs
  // synchronously and no modal opens. If not, the action is stashed and
  // the interrupt modal opens with the supplied title/description.
  requestProtectedAction: (req: ProtectedActionRequest) => void
  // The currently pending request, or null. When non-null the modal is open.
  pending: ProtectedActionRequest | null
  // Dismiss the interrupt without running the action.
  cancel: () => void
}

export const AuthInterruptContext = createContext<AuthInterruptContextValue | null>(null)
