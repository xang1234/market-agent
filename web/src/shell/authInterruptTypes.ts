import { createContext } from 'react'
import type {
  PendingProtectedAction,
  ProtectedAction,
  ProtectedActionKind,
} from './authInterruptState'

// Metadata attached to a pending protected action. The action is modeled as
// serializable data so it can survive route changes and auth redirects.
export type ProtectedActionRequest = {
  title: string
  description?: string
  action: ProtectedAction
}

export type ProtectedActionOfKind<K extends ProtectedActionKind> = Extract<
  ProtectedAction,
  { actionType: K }
>

export type AuthInterruptContextValue = {
  // Request a protected action. If the user is authed, the provider dispatches
  // it through the action registry immediately. If not, the action is stashed
  // and the interrupt modal opens with the supplied title/description.
  requestProtectedAction: (req: ProtectedActionRequest) => void
  // The currently pending request, or null. When non-null the modal is open.
  pending: PendingProtectedAction | null
  // Dismiss the interrupt without running the action.
  cancel: () => void
}

export const AuthInterruptContext = createContext<AuthInterruptContextValue | null>(null)
