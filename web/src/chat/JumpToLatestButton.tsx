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
      className="absolute bottom-4 right-4 flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-md hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
    >
      <span aria-hidden>↓</span>
      <span>Jump to latest</span>
    </button>
  )
}
