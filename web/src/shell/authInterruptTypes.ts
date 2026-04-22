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

export type ResumedProtectedAction = ProtectedAction & {
  resumeToken: number
}

export type ProtectedActionOfKind<K extends ProtectedActionKind> = Extract<
  ResumedProtectedAction,
  { kind: K }
>

export type AuthInterruptContextValue = {
  // Request a protected action. If the user is authed, the action runs
  // synchronously and no modal opens. If not, the action is stashed and the
  // interrupt modal opens with the supplied title/description.
  requestProtectedAction: (req: ProtectedActionRequest) => void
  // The currently pending request, or null. When non-null the modal is open.
  pending: PendingProtectedAction | null
  // Dismiss the interrupt without running the action.
  cancel: () => void
  // Data for a protected action that has just been resumed post-auth.
  resumedAction: ResumedProtectedAction | null
  // Clears the resumed action once the route-level consumer has handled it.
  clearResumedAction: (resumeToken: number) => void
}

export const AuthInterruptContext = createContext<AuthInterruptContextValue | null>(null)
