import { SeverityBadge } from '../blocks/SeverityBadge.tsx'
import { FINDING_SEVERITIES, type FindingSeverity } from '../blocks/types.ts'
import type { AgentActivityRow, AgentFindingRow, AgentRunRow } from './agentRows.ts'
import { PAGE_PANEL_CLASS, PANEL_TITLE_CLASS } from '../ui/pageStyles.ts'
import type { ThesisAssessment } from '../../../services/agents/src/thesis-types.ts'

type AgentDetailPanelsProps = {
  findings: ReadonlyArray<AgentFindingRow>
  assessments: ReadonlyArray<ThesisAssessment>
  detailsError: string | null
  runs: ReadonlyArray<AgentRunRow>
  runActivities: ReadonlyArray<AgentActivityRow>
}

// Read-only detail panels for the selected agent: findings, run history, and
// run activity. Extracted from AgentsPage alongside the roster so the page is
// orchestration + form, not a wall of list-rendering.
export function AgentDetailPanels({ findings, assessments, detailsError, runs, runActivities }: AgentDetailPanelsProps) {
  const supportedSnapshots = snapshotsWithoutChallenge(assessments)
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
                  <FindingSeverityBadge severity={finding.severity} supported={supportedSnapshots.has(finding.snapshot_id)} />
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

// A thesis run writes findings only for supported and challenged results, so a
// run that challenged nothing wrote only supported ones. A finding carries no
// status of its own, so the supported findings of a mixed run keep the severity tone.
function snapshotsWithoutChallenge(assessments: ReadonlyArray<ThesisAssessment>): ReadonlySet<string> {
  return new Set(
    assessments
      .filter((assessment) => !assessment.results.some((result) => result.status === 'challenged'))
      .map((assessment) => assessment.snapshot_id),
  )
}

// Reuse the canonical severity tone map for known severities; an unrecognized
// value (the field is a free string on the wire) falls back to a muted pill. A
// supported finding keeps its severity word but is good news, so it is never red.
function FindingSeverityBadge({ severity, supported }: { severity: string; supported: boolean }) {
  if ((FINDING_SEVERITIES as readonly string[]).includes(severity)) {
    return (
      <SeverityBadge
        severity={severity as FindingSeverity}
        toneClass={supported ? 'bg-positive-soft text-positive' : undefined}
      />
    )
  }
  return <span className="rounded border border-line-strong px-2 py-0.5 text-xs text-muted">{severity}</span>
}
