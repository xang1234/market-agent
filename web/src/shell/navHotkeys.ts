// Video-style single-key workspace switching. Pure key→path table so the
// sidebar chips and the keydown handler can't drift apart.
export const NAV_HOTKEYS: ReadonlyArray<{ key: string; to: string }> = [
  { key: 'h', to: '/home' },
  { key: 'a', to: '/agents' },
  { key: 'c', to: '/chat' },
  { key: 's', to: '/screener' },
  { key: 'g', to: '/analyst-grids' },
]

export function navPathForKey(key: string): string | null {
  const hit = NAV_HOTKEYS.find((item) => item.key === key)
  return hit ? hit.to : null
}
