// An unsent question per user and thread, kept across thread switches and reloads.
// Storage can be unavailable (private mode, quota); the draft then lives only in memory.
const PREFIX = 'chat-draft:'
const key = (scope: string) => `${PREFIX}${scope}`

export function readDraft(scope: string): string {
  try {
    return window.localStorage.getItem(key(scope)) ?? ''
  } catch {
    return ''
  }
}

export function writeDraft(scope: string, text: string): void {
  try {
    if (text === '') window.localStorage.removeItem(key(scope))
    else window.localStorage.setItem(key(scope), text)
  } catch {
    // Unstorable: the draft stays in the composer until it unmounts.
  }
}

export function moveDraft(fromScope: string, toScope: string): void {
  writeDraft(toScope, readDraft(fromScope))
  writeDraft(fromScope, '')
}

// Signing out leaves no question text behind on a shared machine.
export function forgetDrafts(): void {
  try {
    const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
    for (const stored of keys) if (stored?.startsWith(PREFIX)) window.localStorage.removeItem(stored)
  } catch {
    // Unstorable: nothing was kept.
  }
}
