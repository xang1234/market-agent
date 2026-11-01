import { SeverityBadge } from '../blocks/SeverityBadge.tsx'
import { FINDING_SEVERITIES, type FindingSeverity } from '../blocks/types.ts'
import type { AgentActivityRow, AgentFindingRow, AgentRunRow } from './agentRows.ts'
import { PAGE_PANEL_CLASS, PANEL_TITLE_CLASS } from '../ui/pageStyles.ts'

type AgentDetailPanelsProps = {
  findings: ReadonlyArray<AgentFindingRow>
  detailsError: string | null
  runs: ReadonlyArray<AgentRunRow>
  runActivities: ReadonlyArray<AgentActivityRow>
}

// Read-only detail panels for the selected agent: findings, run history, and
// run activity. Extracted from AgentsPage alongside the roster so the page is
// orchestration + form, not a wall of list-rendering.
export function AgentDetailPanels({ findings, detailsError, runs, runActivities }: AgentDetailPanelsProps) {
  return (
    <>
      <section className={PAGE_PANEL_CLASS}>
        <h2 className={PANEL_TITLE_CLASS}>Findings</h2>
        {detailsError ? <p className="mt-3 text-sm text-negative">Details failed: {detailsError}</p> : null}
        {findings.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No findings for this agent yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {findings.map((finding) => (
              <li key={finding.finding_id} className="rounded-lg border border-line p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium text-fg">{finding.headline}</span>
                  <FindingSeverityBadge severity={finding.severity} />
                </div>
                <p className="mt-2 text-xs text-muted">{finding.created_at}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={PAGE_PANEL_CLASS}>
        <h2 className={PANEL_TITLE_CLASS}>Run history</h2>
        {runs.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No recorded runs yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {runs.map((run) => (
              <li key={run.agent_run_log_id} className="rounded-lg border border-line p-3 text-sm">
                <span className="font-medium">{run.status}</span>
                <span className="ml-2 text-muted">{run.started_at}</span>
                {run.error ? <p className="mt-1 text-negative">{run.error}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={PAGE_PANEL_CLASS}>
        <h2 className={PANEL_TITLE_CLASS}>Run activity</h2>
        {runActivities.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No activity for this agent yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {runActivities.map((item) => (
              <li key={item.run_activity_id} className="rounded-lg border border-line p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium capitalize text-fg">{item.stage}</span>
                  <span className="text-xs text-muted">{item.ts}</span>
                </div>
                <p className="mt-2 text-fg-soft">{item.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

// Reuse the canonical severity tone map for known severities; an unrecognized
// value (the field is a free string on the wire) falls back to a muted pill.
function FindingSeverityBadge({ severity }: { severity: string }) {
  if ((FINDING_SEVERITIES as readonly string[]).includes(severity)) {
    return <SeverityBadge severity={severity as FindingSeverity} />
  }
  return <span className="rounded border border-line-strong px-2 py-0.5 text-xs text-muted">{severity}</span>
}
