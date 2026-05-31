import type { ReactElement } from 'react'

type JumpToLatestButtonProps = {
  onClick: () => void
}

export function JumpToLatestButton({ onClick }: JumpToLatestButtonProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="jump-to-latest"
      className="absolute bottom-4 right-4 flex items-center gap-1 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-fg shadow-md hover:bg-surface-2"
    >
      <span aria-hidden>↓</span>
      <span>Jump to latest</span>
    </button>
  )
}
