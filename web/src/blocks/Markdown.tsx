import type { ReactElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Themed GFM renderer for analyst answers. Block-level output (tables, headings)
// means the caller must render this inside a <div>, never a <p>.
export function Markdown({ text }: { text: string }): ReactElement {
  return (
    <div className="text-sm leading-6 text-fg-soft [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mb-2 mt-4 text-base font-semibold text-fg">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-4 text-sm font-semibold text-fg">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted">{children}</h3>,
          p: ({ children }) => <p className="my-2">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal pl-5">{children}</ol>,
          li: ({ children }) => <li className="my-0.5">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
          a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="text-accent underline">{children}</a>,
          code: ({ children }) => <code className="rounded bg-surface-2 px-1 py-0.5 text-[0.85em]">{children}</code>,
          pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-md bg-surface-2 p-3 text-xs">{children}</pre>,
          table: ({ children }) => <div className="my-2 overflow-x-auto"><table className="w-full border-collapse text-xs">{children}</table></div>,
          thead: ({ children }) => <thead className="bg-surface-2">{children}</thead>,
          th: ({ children }) => <th className="border border-line px-2 py-1 text-right first:text-left">{children}</th>,
          td: ({ children }) => <td className="num border border-line px-2 py-1 text-right first:text-left">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
