import type { ProtectedAction, ProtectedActionKind } from './authInterruptState'

export type ProtectedActionHandler<K extends ProtectedActionKind> = (
  action: Extract<ProtectedAction, { actionType: K }>,
) => void

type AnyProtectedActionHandler = (action: ProtectedAction) => void

const handlersByType = new Map<ProtectedActionKind, Set<AnyProtectedActionHandler>>()
const queuedActionsByType = new Map<ProtectedActionKind, ProtectedAction>()

export function registerProtectedActionHandler<K extends ProtectedActionKind>(
  actionType: K,
  handler: ProtectedActionHandler<K>,
): () => void {
  const typedHandler = handler as AnyProtectedActionHandler
  const handlers = handlersByType.get(actionType) ?? new Set<AnyProtectedActionHandler>()

  handlers.add(typedHandler)
  handlersByType.set(actionType, handlers)

  const queuedAction = queuedActionsByType.get(actionType)
  if (queuedAction) {
    queuedActionsByType.delete(actionType)
    typedHandler(queuedAction)
  }

  return () => {
    handlers.delete(typedHandler)
    if (handlers.size === 0) {
      handlersByType.delete(actionType)
    }
  }
}

export function dispatchProtectedAction(action: ProtectedAction): boolean {
  const handlers = handlersByType.get(action.actionType)

  if (!handlers || handlers.size === 0) {
    queuedActionsByType.set(action.actionType, action)
    return false
  }

  for (const handler of handlers) {
    handler(action)
  }

  return true
}

export function clearProtectedActionRegistryForTests() {
  handlersByType.clear()
  queuedActionsByType.clear()
}
