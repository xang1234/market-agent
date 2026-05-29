import type { EvidenceInspection, EvidenceInspectionRef } from './inspectionTypes.ts'

export type EvidenceInspectorState =
  | { kind: 'closed' }
  | { kind: 'loading'; snapshotId: string; ref: EvidenceInspectionRef }
  | { kind: 'ready'; inspection: EvidenceInspection }
  | { kind: 'error'; snapshotId: string; ref: EvidenceInspectionRef; message: string }

export function EvidenceInspectorDrawer({
  state,
  onClose,
}: {
  state: EvidenceInspectorState
  onClose(): void
}) {
  if (state.kind === 'closed') return null

  const snapshotId = state.kind === 'ready' ? state.inspection.snapshot_id : state.snapshotId

  return (
    <aside
      aria-label="Evidence inspector"
      className="fixed bottom-0 right-0 top-0 z-50 flex w-[420px] max-w-full flex-col border-l border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-950"
    >
      <header className="flex items-start justify-between gap-3 border-b border-neutral-200 p-4 dark:border-neutral-800">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Evidence</h2>
          <p className="mt-1 break-all text-xs text-neutral-500 dark:text-neutral-400">{snapshotId}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
        >
          Close
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {state.kind === 'loading' ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading evidence.</p>
        ) : null}
        {state.kind === 'error' ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-300">{state.message}</p>
        ) : null}
        {state.kind === 'ready' ? <InspectionBody inspection={state.inspection} /> : null}
      </div>
    </aside>
  )
}

function InspectionBody({ inspection }: { inspection: EvidenceInspection }) {
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{inspection.title}</h3>
        {inspection.subtitle ? (
          <p className="mt-1 break-words text-xs text-neutral-500 dark:text-neutral-400">{inspection.subtitle}</p>
        ) : null}
        {inspection.badges.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {inspection.badges.map((badge) => (
              <span
                key={badge}
                className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
              >
                {badge}
              </span>
            ))}
          </div>
        ) : null}
      </section>
      <dl className="grid gap-2">
        {inspection.rows.map((row) => (
          <div key={`${row.label}:${row.value}`} className="grid gap-1 border-t border-neutral-200 pt-2 dark:border-neutral-800">
            <dt className="text-xs uppercase text-neutral-500 dark:text-neutral-400">{row.label}</dt>
            <dd className="break-words text-sm text-neutral-900 dark:text-neutral-100">{row.value}</dd>
          </div>
        ))}
      </dl>
      {inspection.links.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {inspection.links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-blue-700 underline underline-offset-2 dark:text-blue-300"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
