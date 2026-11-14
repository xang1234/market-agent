import type { ReactElement, ReactNode } from 'react'

import { CopyButton } from '../blocks/CopyButton.tsx'
import { isIdentifier, isTimestamp, readableDate, shortId } from './readable.ts'

/** A date or timestamp in words, with the exact text it came from on hover. */
export function Timestamp({ value }: { value: string }): ReactElement {
  return <time dateTime={value} title={value}>{readableDate(value)}</time>
}

/** An identifier shortened to scan, the full value on hover and one click from the clipboard. */
export function Identifier({ value, label }: { value: string; label: string }): ReactElement {
  return (
    <span className="-my-1.5 inline-flex min-w-0 max-w-full items-center gap-1 align-middle">
      <code className="min-w-0 truncate font-mono text-xs text-fg-soft" title={value}>{shortId(value)}</code>
      <CopyButton iconOnly text={() => value} label="Copy" what={label} purpose="to the clipboard" />
    </span>
  )
}

/** A server-supplied value read for what it is: a date in words, an identifier shortened, anything else as written. */
export function ReadableValue({ value, label }: { value: string; label: string }): ReactElement {
  if (isTimestamp(value)) return <Timestamp value={value} />
  if (/^https?:\/\//u.test(value)) return <span className="block truncate" title={value}>{value}</span>
  if (isIdentifier(value)) return <Identifier value={value} label={label} />
  return <>{value}</>
}

/** Audit material, closed until asked for. */
export function Details({ children }: { children: ReactNode }): ReactElement {
  return (
    <details className="group rounded-md border border-line" data-testid="inspector-details">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted hover:text-fg">
        Details
      </summary>
      <div className="flex flex-col gap-3 border-t border-line px-3 py-3">{children}</div>
    </details>
  )
}

/** Label and value pairs, labels in a narrow column. */
export function Facts({ rows, title }: { rows: ReadonlyArray<readonly [string, ReactNode]>; title?: string }): ReactElement {
  return (
    <section className="flex min-w-0 flex-col gap-1">
      {title ? <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h4> : null}
      <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        {rows.map(([label, value], index) => (
          <div key={`${label}-${index}`} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="min-w-0 break-words text-fg">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
