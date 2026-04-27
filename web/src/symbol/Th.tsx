type ThProps = {
  children: string
  align?: 'right'
}

export function Th({ children, align }: ThProps) {
  return (
    <th
      scope="col"
      className={`px-2 py-2 font-medium text-neutral-500 dark:text-neutral-400 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}
