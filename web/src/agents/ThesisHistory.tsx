import { InspectableRef } from '../evidence/InspectableRef.tsx'
import { VerificationLabel } from '../blocks/VerificationLabel.tsx'
import type { VerificationKind } from '../blocks/verification.ts'
import type { ConditionAssessment, ThesisAssessment, ThesisHistoryResponse, ThesisVersion } from '../../../services/agents/src/thesis-types.ts'

/** One label per condition: a certified calculation, model commentary on cited sources, or an older stored-fact check. */
function verificationOf(result: ConditionAssessment): VerificationKind | null {
  if (result.financial) return 'verified'
  if (result.method === 'model') return 'narrative'
  if (result.method === 'metric') return 'legacy'
  return null
}

const METHOD_LABELS: Readonly<Record<ConditionAssessment['method'], string>> = {
  metric: 'Checked an authoritative numeric fact against this threshold.',
  model: 'Assessed against the cited certified figures (F) and stored claims (C) only.',
  no_evidence: 'No stored source covered this condition at the assessment cutoff.',
}

type Entry = { assessment: ThesisAssessment; result: ConditionAssessment; version: ThesisVersion | undefined }
type Timeline = { conditionId: string; statement: string | null; entries: Entry[] }

/** Each condition's assessments, newest first, in the order the newest assessment lists its conditions. */
function conditionTimelines(history: ThesisHistoryResponse): Timeline[] {
  const versions = new Map(history.versions.map((version) => [version.thesis_version_id, version]))
  const newestFirst = [...history.assessments].sort((a, b) => Date.parse(b.assessed_at) - Date.parse(a.assessed_at))
  const timelines = new Map<string, Timeline>()
  for (const assessment of newestFirst) {
    const version = versions.get(assessment.thesis_version_id)
    for (const result of assessment.results) {
      const timeline = timelines.get(result.condition_id) ?? { conditionId: result.condition_id, statement: null, entries: [] }
      timeline.statement ??= version?.conditions.find((condition) => condition.condition_id === result.condition_id)?.statement ?? null
      timeline.entries.push({ assessment, result, version })
      timelines.set(result.condition_id, timeline)
    }
  }
  return [...timelines.values()]
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
  return (
    <section className="mt-6 border-t border-line pt-4">
      <h3 className="text-sm font-semibold text-fg">Assessment history</h3>
      <p className="mt-1 text-xs text-muted">Each condition's assessments, newest first. Open a condition to see them.</p>
      <ul className="mt-3 flex flex-col gap-3">
        {conditionTimelines(history).map((timeline) => (
          <ConditionTimeline key={timeline.conditionId} timeline={timeline} currentVersion={history.thesis?.version ?? null} />
        ))}
      </ul>
    </section>
  )
}

function ConditionTimeline({ timeline, currentVersion }: { timeline: Timeline; currentVersion: number | null }) {
  const latest = timeline.entries[0]!
  return (
    <li className="min-w-0 rounded-md border border-line" data-condition-id={timeline.conditionId}>
      <details>
        <summary className="flex cursor-pointer flex-wrap items-start justify-between gap-2 p-3">
          <span className="min-w-0 break-words text-sm font-medium text-fg">
            {timeline.statement ?? 'Condition details are outside recent history'}
          </span>
          <span className="flex items-center gap-2 text-xs text-muted">
            <StatusBadge result={latest.result} />
            {timeline.entries.length === 1 ? '1 assessment' : `${timeline.entries.length} assessments`}
          </span>
        </summary>
        <ol className="flex flex-col gap-2 border-t border-line p-3">
          {timeline.entries.map((entry) => (
            <AssessmentEntry key={entry.assessment.assessment_id} entry={entry} currentVersion={currentVersion} />
          ))}
        </ol>
      </details>
    </li>
  )
}

function AssessmentEntry({ entry: { assessment, result, version }, currentVersion }: { entry: Entry; currentVersion: number | null }) {
  const older = version !== undefined && currentVersion !== null && version.version !== currentVersion
  const verification = verificationOf(result)
  return (
    <li className="min-w-0 rounded bg-surface-2 p-3" data-assessment-id={assessment.assessment_id}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <time dateTime={assessment.assessed_at}>{formatDate(assessment.assessed_at)}</time>
        <span className="flex items-center gap-2">
          {verification ? <VerificationLabel kind={verification} /> : null}
          <StatusBadge result={result} />
        </span>
      </div>
      <p className="mt-1 break-words text-xs text-muted">
        {version === undefined ? 'Older thesis version · details outside recent history' : `Thesis v${version.version}${older ? ' · older version' : ''}`}
        {' · '}
        {assessment.model_version ? `Model ${assessment.model_version}` : 'Deterministic assessment'} · Prompt {assessment.prompt_version}
      </p>
      <p className="mt-2 break-words text-sm text-fg-soft">{result.reason}</p>
      <p className="mt-2 text-xs text-muted">
        {result.financial
          ? `Verified against the saved threshold at the assessment cutoff · certificate ${result.financial.certificate_digest?.slice(0, 12) ?? 'unavailable'}`
          : METHOD_LABELS[result.method]}
      </p>
      {(result.fact_refs.length > 0 || result.claim_refs.length > 0) ? (
        <div className="mt-2 flex flex-wrap gap-2" aria-label="Cited refs">
          {result.fact_refs.map((id, index) => (
            <InspectableRef key={id} snapshotId={assessment.snapshot_id} inspectionRef={{ kind: 'fact', id }} className={REF_CLASS}>
              <span className="sr-only">Inspect fact evidence </span>F{index + 1}
            </InspectableRef>
          ))}
          {result.claim_refs.map((id, index) => (
            <InspectableRef key={id} snapshotId={assessment.snapshot_id} inspectionRef={{ kind: 'claim', id }} className={REF_CLASS}>
              <span className="sr-only">Inspect claim evidence </span>C{index + 1}
            </InspectableRef>
          ))}
        </div>
      ) : null}
    </li>
  )
}

const REF_CLASS = 'rounded border border-line px-1.5 py-0.5 font-mono text-xs font-medium text-blue-700 underline decoration-dotted dark:text-blue-300'

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

function StatusBadge({ result }: { result: ConditionAssessment }) {
  const classes = result.status === 'supported'
    ? 'border-positive/40 bg-positive-soft text-positive'
    : result.status === 'challenged'
      ? 'border-negative/40 bg-negative-soft text-negative'
      : 'border-line-strong bg-surface text-muted'
  const label = result.method === 'no_evidence' ? 'Not enough evidence' : result.status
  return <span className={`whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium first-letter:uppercase ${classes}`}>{label}</span>
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value
}
