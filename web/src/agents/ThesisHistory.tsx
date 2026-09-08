import { InspectableRef } from '../evidence/InspectableRef.tsx'
import type { ConditionAssessment, ThesisAssessment, ThesisHistoryResponse, ThesisVersion } from '../../../services/agents/src/thesis-types.ts'

const METHOD_LABELS: Readonly<Record<ConditionAssessment['method'], string>> = {
  metric: 'Checked an authoritative numeric fact against this threshold.',
  model: 'Compared the condition with the cited evidence using the assessment model.',
  no_evidence: 'No eligible evidence was available, so the condition remains unresolved.',
}

export function AssessmentHistory({ history }: { history: ThesisHistoryResponse }) {
  if (history.assessments.length === 0) {
    return (
      <section className="mt-6 border-t border-line pt-4">
        <h3 className="text-sm font-semibold text-fg">Assessment history</h3>
        <p className="mt-2 text-sm text-muted">Run this agent after saving conditions to assess them against fresh evidence.</p>
      </section>
    )
  }
  const versions = new Map(history.versions.map((version) => [version.thesis_version_id, version]))
  return (
    <section className="mt-6 border-t border-line pt-4">
      <h3 className="text-sm font-semibold text-fg">Assessment history</h3>
      <ol className="mt-3 flex flex-col gap-3">
        {history.assessments.map((assessment) => (
          <AssessmentCard
            key={assessment.assessment_id}
            assessment={assessment}
            version={versions.get(assessment.thesis_version_id)}
            currentVersion={history.thesis?.version ?? null}
          />
        ))}
      </ol>
    </section>
  )
}

function AssessmentCard({
  assessment,
  version,
  currentVersion,
}: {
  assessment: ThesisAssessment
  version: ThesisVersion | undefined
  currentVersion: number | null
}) {
  const conditions = new Map(version?.conditions.map((condition) => [condition.condition_id, condition]))
  const outsideRecentHistory = version === undefined
  const older = version !== undefined && currentVersion !== null && version.version !== currentVersion
  return (
    <li className="rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          {outsideRecentHistory
            ? 'Older thesis version · details outside recent history'
            : `Thesis v${version.version}${older ? ' · older version' : ''}`}
        </span>
        <time dateTime={assessment.assessed_at}>{formatDate(assessment.assessed_at)}</time>
      </div>
      <p className="mt-1 text-xs text-muted">
        {assessment.model_version ? `Model ${assessment.model_version}` : 'Deterministic assessment'} · Prompt {assessment.prompt_version}
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {assessment.results.map((result) => (
          <li key={result.condition_id} className="rounded bg-surface-2 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm font-medium text-fg">
                {conditions.get(result.condition_id)?.statement ?? 'Condition details are outside recent history'}
              </p>
              <StatusBadge status={result.status} />
            </div>
            <p className="mt-2 text-sm text-fg-soft">{result.reason}</p>
            <p className="mt-2 text-xs text-muted">{METHOD_LABELS[result.method]}</p>
            {(result.fact_refs.length > 0 || result.claim_refs.length > 0) ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {result.fact_refs.map((id) => (
                  <InspectableRef key={id} snapshotId={assessment.snapshot_id} inspectionRef={{ kind: 'fact', id }} className="text-xs font-medium text-blue-700 underline decoration-dotted dark:text-blue-300">
                    Inspect fact evidence
                  </InspectableRef>
                ))}
                {result.claim_refs.map((id) => (
                  <InspectableRef key={id} snapshotId={assessment.snapshot_id} inspectionRef={{ kind: 'claim', id }} className="text-xs font-medium text-blue-700 underline decoration-dotted dark:text-blue-300">
                    Inspect claim evidence
                  </InspectableRef>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </li>
  )
}

export function VersionHistory({ versions, currentVersion }: { versions: ReadonlyArray<ThesisVersion>; currentVersion: number }) {
  if (versions.length === 0) return null
  return (
    <details className="mt-4 border-t border-line pt-4">
      <summary className="cursor-pointer text-sm font-semibold text-fg">Thesis version history ({versions.length})</summary>
      <ol className="mt-3 flex flex-col gap-2">
        {versions.map((version) => (
          <li key={version.thesis_version_id} className="rounded border border-line p-3 text-sm text-fg-soft">
            <span className="font-medium text-fg">Version {version.version}</span>
            {version.version !== currentVersion ? <span className="ml-2 text-xs text-muted">Older version</span> : null}
            <p className="mt-1">{version.thesis}</p>
            <p className="mt-1 text-xs text-muted">{version.conditions.length} conditions · {formatDate(version.created_at)}</p>
          </li>
        ))}
      </ol>
    </details>
  )
}

function StatusBadge({ status }: { status: ConditionAssessment['status'] }) {
  const classes = status === 'supported'
    ? 'border-positive/40 bg-positive-soft text-positive'
    : status === 'challenged'
      ? 'border-negative/40 bg-negative-soft text-negative'
      : 'border-line-strong bg-surface text-muted'
  return <span className={`rounded border px-2 py-0.5 text-xs font-medium capitalize ${classes}`}>{status}</span>
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value
}
