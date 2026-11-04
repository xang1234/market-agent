import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { PRIMARY_BUTTON_CLASS } from '../shell/buttonStyles.ts'

import {
  AgentPayloadValidationError,
  buildAgentPayload,
  canRoundTripAlertRules,
  canRoundTripUniverse,
  isAgentSubjectKind,
  subjectRefsText,
  type AgentPayload,
  type AgentUniverse,
} from '../agents/agentPayload.ts'
import type {
  AgentActivityRow,
  AgentFindingRow,
  AgentRow,
  AgentRunRow,
} from '../agents/agentRows.ts'
import { AgentRoster } from '../agents/AgentRoster.tsx'
import { AgentDetailPanels } from '../agents/AgentDetailPanels.tsx'
import { ThesisPanel } from '../agents/ThesisPanel.tsx'
import { alertRuleLabel, dynamicUniverseIdFor, universeLabel } from '../agents/agentLabels.ts'
import { readThesisHandoff } from '../analyze/thesisHandoff.ts'
import type { SubjectKind } from '../subject/subjectRef.ts'
import { authenticatedFetch } from '../http/authFetch.ts'
import { useAuth } from '../shell/useAuth.ts'
import { PageHeader } from '../ui/PageHeader.tsx'
import {
  FIELD_CLASS,
  FIELD_LABEL_CLASS,
  FIELDSET_CLASS,
  PAGE_CLASS,
  PAGE_PANEL_CLASS,
  PANEL_TITLE_CLASS,
  SECTION_LABEL_CLASS,
} from '../ui/pageStyles.ts'

export function AgentsPage() {
  const { session } = useAuth()
  const location = useLocation()
  const thesisHandoff = useMemo(() => readThesisHandoff(location.state), [location.state])
  const discoveryHandoff = thesisHandoff?.kind === 'discovery' ? thesisHandoff : null
  const [agents, setAgents] = useState<ReadonlyArray<AgentRow>>([])
  const [rosterSettled, setRosterSettled] = useState(false)
  const [runs, setRuns] = useState<ReadonlyArray<AgentRunRow>>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [findings, setFindings] = useState<ReadonlyArray<AgentFindingRow>>([])
  const [runActivities, setRunActivities] = useState<ReadonlyArray<AgentActivityRow>>([])
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [detailsAgentId, setDetailsAgentId] = useState<string | null>(null)
  const [detailsRefreshKey, setDetailsRefreshKey] = useState(0)
  const [thesisRefreshKey, setThesisRefreshKey] = useState(0)
  const [structuredAgentIds, setStructuredAgentIds] = useState<ReadonlySet<string>>(new Set())
  const [name, setName] = useState(thesisHandoff?.name ?? '')
  const [thesis, setThesis] = useState(thesisHandoff?.thesis ?? '')
  const [cadence, setCadence] = useState('daily')
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null)
  const [editingAgent, setEditingAgent] = useState<AgentRow | null>(null)
  const [universeMode, setUniverseMode] = useState<AgentUniverse['mode']>('static')
  const [staticSubjectRefsText, setStaticSubjectRefsText] = useState(
    thesisHandoff ? `${thesisHandoff.subjectRef.kind}:${thesisHandoff.subjectRef.id}` : '',
  )
  const [dynamicUniverseId, setDynamicUniverseId] = useState('')
  const [subjectKind, setSubjectKind] = useState<SubjectKind>(thesisHandoff?.subjectRef.kind ?? 'issuer')
  const [subjectId, setSubjectId] = useState(thesisHandoff?.subjectRef.id ?? '')
  const [alertRuleId, setAlertRuleId] = useState('')
  const [alertSeverity, setAlertSeverity] = useState('high')
  const [alertHeadline, setAlertHeadline] = useState('')
  const [alertEmail, setAlertEmail] = useState(false)
  const [alertWebPush, setAlertWebPush] = useState(false)
  const [alertSms, setAlertSms] = useState(false)
  const [alertMobilePush, setAlertMobilePush] = useState(false)
  const [alertDigest, setAlertDigest] = useState(false)
  const [activity, setActivity] = useState('Idle')
  const [formMessage, setFormMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(thesisHandoff
    ? {
        tone: 'info',
        text: thesisHandoff.kind === 'discovery'
          ? 'Review this cited discovery research, create the agent, then draft and save its conditions.'
          : 'Review this Analyze memo, create the agent, then draft and save its conditions.',
      }
    : null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const preservesUnsupportedUniverse =
    editingAgent?.universe !== undefined && !canRoundTripUniverse(editingAgent.universe)
  const preservesUnsupportedAlertRules =
    editingAgent?.alert_rules !== undefined && !canRoundTripAlertRules(editingAgent.alert_rules)
  const editingStructuredThesis = editingAgentId !== null && structuredAgentIds.has(editingAgentId)
  const universeEditingDisabled = preservesUnsupportedUniverse || editingStructuredThesis
  const detailsMatchSelection = session && selectedAgentId && detailsAgentId === selectedAgentId
  const visibleFindings = detailsMatchSelection ? findings : []
  const visibleRunActivities = detailsMatchSelection ? runActivities : []
  const visibleDetailsError = detailsMatchSelection ? detailsError : null

  useEffect(() => {
    if (!session) return
    const controller = new AbortController()
    authenticatedFetch('/v1/agents', {
      userId: session.userId,
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return (await response.json()) as { agents?: AgentRow[]; runs?: AgentRunRow[] }
      })
      .then((body) => {
        setLoadError(null)
        if (body.agents) {
          setAgents(body.agents)
          setSelectedAgentId((current) => {
            if (current && body.agents?.some((agent) => agent.agent_id === current)) return current
            return body.agents?.[0]?.agent_id ?? null
          })
        }
        if (body.runs) setRuns(body.runs)
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setLoadError(caught instanceof Error ? caught.message : String(caught))
      })
      .finally(() => {
        if (!controller.signal.aborted) setRosterSettled(true)
      })
    return () => controller.abort()
  }, [session])

  useEffect(() => {
    if (!session || !selectedAgentId) {
      return
    }
    let ignore = false
    const controller = new AbortController()
    const encodedAgentId = encodeURIComponent(selectedAgentId)
    Promise.all([
      authenticatedFetch(`/v1/agents/${encodedAgentId}/findings`, {
        userId: session.userId,
        signal: controller.signal,
      }),
      authenticatedFetch(`/v1/agents/${encodedAgentId}/activity`, {
        userId: session.userId,
        signal: controller.signal,
      }),
    ])
      .then(async ([findingsResponse, activityResponse]) => {
        if (!findingsResponse.ok || !activityResponse.ok) {
          throw new Error(`details fetch failed with HTTP ${findingsResponse.status}/${activityResponse.status}`)
        }
        const findingsBody = (await findingsResponse.json()) as { findings?: AgentFindingRow[] }
        const activityBody = (await activityResponse.json()) as { activity?: AgentActivityRow[] }
        return { findings: findingsBody.findings ?? [], activity: activityBody.activity ?? [] }
      })
      .then((body) => {
        if (ignore) return
        setDetailsAgentId(selectedAgentId)
        setDetailsError(null)
        setFindings(body.findings)
        setRunActivities(body.activity)
      })
      .catch((caught) => {
        if (ignore || controller.signal.aborted) return
        setDetailsAgentId(selectedAgentId)
        setFindings([])
        setRunActivities([])
        setDetailsError(caught instanceof Error ? caught.message : String(caught))
      })
    return () => {
      ignore = true
      controller.abort()
    }
  }, [session, selectedAgentId, detailsRefreshKey])

  const resetForm = () => {
    setEditingAgentId(null)
    setEditingAgent(null)
    setName('')
    setThesis('')
    setCadence('daily')
    setUniverseMode('static')
    setStaticSubjectRefsText('')
    setDynamicUniverseId('')
    setSubjectKind('issuer')
    setSubjectId('')
    setAlertRuleId('')
    setAlertSeverity('high')
    setAlertHeadline('')
    setAlertEmail(false)
    setAlertWebPush(false)
    setAlertSms(false)
    setAlertMobilePush(false)
    setAlertDigest(false)
    setFormMessage(null)
  }

  // Async handlers settle after the roster has moved on, so the selected and
  // edited agents are checked against the roster here rather than in each one.
  if (selectedAgentId && !agents.some((agent) => agent.agent_id === selectedAgentId)) {
    setSelectedAgentId(agents[0]?.agent_id ?? null)
  }
  if (editingAgentId && !agents.some((agent) => agent.agent_id === editingAgentId)) {
    resetForm()
  }

  const submitAgent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!session) return
    let input: AgentPayload
    try {
      input = buildAgentPayload({
        name,
        thesis,
        cadence,
        universeMode,
        staticSubjectRefsText,
        dynamicUniverseId,
        subjectKind,
        subjectId,
        alertRuleId,
        alertSeverity,
        alertHeadline,
        alertEmail,
        alertWebPush,
        alertSms,
        alertMobilePush,
        alertDigest,
      }, editingAgent ?? undefined)
    } catch (caught) {
      setFormMessage({ tone: 'error', text: caught instanceof AgentPayloadValidationError ? caught.message : String(caught) })
      return
    }
    if (!input.name || !input.thesis) return
    setFormMessage({ tone: 'info', text: editingAgentId ? 'Updating agent' : 'Creating agent' })
    const response = await authenticatedFetch(editingAgentId ? `/v1/agents/${encodeURIComponent(editingAgentId)}` : '/v1/agents', {
      userId: session.userId,
      method: editingAgentId ? 'PATCH' : 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    })
    if (response.ok) {
      const saved = (await response.json()) as AgentRow
      setAgents((current) => [saved, ...current.filter((agent) => agent.agent_id !== saved.agent_id)])
      setSelectedAgentId(saved.agent_id)
      setDetailsRefreshKey((current) => current + 1)
      resetForm()
      setActivity(editingAgentId ? 'Agent updated' : 'Agent created')
    } else {
      setFormMessage({ tone: 'error', text: `${editingAgentId ? 'Update' : 'Create'} failed: HTTP ${response.status}` })
    }
  }

  const editAgent = (agent: AgentRow) => {
    const universe = agent.universe?.mode === 'static' ? agent.universe : null
    const subject = universe?.subject_refs[0] ?? null
    const alert = agent.alert_rules?.[0] ?? null
    const channels = alert?.channels ?? []
    setEditingAgentId(agent.agent_id)
    setSelectedAgentId(agent.agent_id)
    setEditingAgent(agent)
    setName(agent.name)
    setThesis(agent.thesis)
    setCadence(agent.cadence)
    setUniverseMode(agent.universe?.mode ?? 'static')
    setStaticSubjectRefsText(subjectRefsText(universe?.subject_refs))
    setDynamicUniverseId(dynamicUniverseIdFor(agent.universe))
    setSubjectKind(subject?.kind ?? 'issuer')
    setSubjectId(subject?.id ?? '')
    setAlertRuleId(alert?.rule_id ?? '')
    setAlertSeverity(alert?.severity_at_least ?? 'high')
    setAlertHeadline(alert?.headline_contains ?? '')
    setAlertEmail(channels.includes('email'))
    setAlertWebPush(channels.includes('web_push'))
    setAlertSms(channels.includes('sms'))
    setAlertMobilePush(channels.includes('mobile_push'))
    setAlertDigest(channels.includes('digest'))
    setFormMessage({
      tone: 'info',
      text: structuredAgentIds.has(agent.agent_id)
        ? 'Edit thesis text and conditions in Thesis conditions. Other agent settings remain editable here.'
        : 'Editing agent',
    })
  }

  const updateAgent = async (
    agentId: string,
    patch: Partial<Pick<AgentRow, 'enabled' | 'name' | 'thesis' | 'cadence' | 'universe' | 'alert_rules'>>,
  ) => {
    if (!session) return
    setActivity('Updating agent')
    const response = await authenticatedFetch(`/v1/agents/${encodeURIComponent(agentId)}`, {
      userId: session.userId,
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(patch),
    })
    if (response.ok) {
      const updated = (await response.json()) as AgentRow
      setAgents((current) => current.map((agent) => (agent.agent_id === updated.agent_id ? updated : agent)))
      setSelectedAgentId(updated.agent_id)
      setActivity('Agent updated')
    } else {
      setActivity(`Update failed: HTTP ${response.status}`)
    }
  }

  const deleteAgent = async (agentId: string) => {
    if (!session) return
    setActivity('Deleting agent')
    const response = await authenticatedFetch(`/v1/agents/${encodeURIComponent(agentId)}`, {
      userId: session.userId,
      method: 'DELETE',
    })
    if (response.ok) {
      setAgents((current) => current.filter((agent) => agent.agent_id !== agentId))
      setRuns((current) => current.filter((run) => run.agent_id !== agentId))
      setActivity('Agent deleted')
    } else {
      setActivity(`Delete failed: HTTP ${response.status}`)
    }
  }

  const runAgent = async (agentId: string) => {
    if (!session) return
    setActivity('Starting run')
    const response = await authenticatedFetch(`/v1/agents/${encodeURIComponent(agentId)}/runs`, {
      userId: session.userId,
      method: 'POST',
    })
    if (response.ok) {
      const run = (await response.json()) as AgentRunRow
      setRuns((current) => [run, ...current])
      setSelectedAgentId(agentId)
      setDetailsRefreshKey((current) => current + 1)
      if (run.status === 'completed') setThesisRefreshKey((current) => current + 1)
      setActivity(run.status === 'completed' ? 'Run completed' : 'Run queued')
    } else {
      setActivity(`Run failed: HTTP ${response.status}`)
    }
  }

  const handleStructuredChange = useCallback((agentId: string, hasStructuredThesis: boolean) => {
    setStructuredAgentIds((current) => {
      const alreadyTracked = current.has(agentId)
      if (alreadyTracked === hasStructuredThesis) return current
      const next = new Set(current)
      if (hasStructuredThesis) next.add(agentId)
      else next.delete(agentId)
      return next
    })
  }, [])

  const handleThesisSaved = useCallback((saved: import('../../../services/agents/src/thesis-types.ts').ThesisVersion) => {
    setAgents((current) => current.map((agent) => agent.agent_id === saved.agent_id
      ? { ...agent, thesis: saved.thesis }
      : agent))
    setThesis((current) => editingAgentId === saved.agent_id ? saved.thesis : current)
    setActivity(`Thesis version ${saved.version} saved`)
  }, [editingAgentId])

  const showDetail = session !== null && selectedAgentId !== null
  const agentForm = (
    <form
      onSubmit={submitAgent}
      className={`flex min-w-0 flex-col gap-4 ${PAGE_PANEL_CLASS} ${showDetail ? 'xl:col-start-1 xl:row-start-2' : 'xl:col-start-2 xl:row-start-1'}`}
    >
      <h2 className={PANEL_TITLE_CLASS}>{editingAgentId ? 'Edit agent' : 'Create agent'}</h2>
      <label className={FIELD_LABEL_CLASS}>
        Name
        <input
          name="agent-name"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          className={FIELD_CLASS}
        />
      </label>
      <label className={FIELD_LABEL_CLASS}>
        Thesis
        <textarea
          name="agent-thesis"
          value={thesis}
          onChange={(event) => setThesis(event.currentTarget.value)}
          disabled={editingStructuredThesis}
          rows={4}
          className={FIELD_CLASS}
        />
      </label>
      {discoveryHandoff ? (
        <section aria-label="Discovery research conditions" className="rounded-md border border-line bg-surface-2 p-3 text-sm text-fg">
          <h3 className="font-medium">Research starter conditions</h3>
          <p className="mt-1 text-xs text-muted">{discoveryHandoff.conditions.length} of {discoveryHandoff.conditions.length + discoveryHandoff.trimmedConditions} research conditions are shown. They are not saved until you use the existing thesis actions.</p>
          {discoveryHandoff.trimmedConditions > 0 ? <p className="mt-1 text-xs text-muted">{discoveryHandoff.trimmedConditions} conditions were trimmed to keep this handoff reviewable.</p> : null}
          {discoveryHandoff.conditions.length > 0 ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{discoveryHandoff.conditions.map((condition, index) => <li key={`${condition.statement}:${index}`}>{condition.statement} — falsifier: {condition.falsifier} · {condition.horizon}</li>)}</ul> : <p className="mt-2 text-xs text-muted">No research conditions were included in this handoff.</p>}
        </section>
      ) : null}
      {editingStructuredThesis ? (
        <p className="rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-xs text-fg-soft">
          This agent has a versioned thesis. Edit its thesis and conditions in the Thesis conditions panel. Create another agent to monitor a different company.
        </p>
      ) : null}
      <label className={FIELD_LABEL_CLASS}>
        Cadence
        <select
          name="agent-cadence"
          value={cadence}
          onChange={(event) => setCadence(event.currentTarget.value)}
          className={FIELD_CLASS}
        >
          <option value="hourly">hourly</option>
          <option value="daily">daily</option>
          <option value="weekly">weekly</option>
        </select>
      </label>
      <fieldset className={FIELDSET_CLASS}>
        <legend className={`px-1 ${SECTION_LABEL_CLASS}`}>Universe</legend>
        {preservesUnsupportedUniverse ? (
          <p className="rounded-md border border-warning bg-warning-soft px-3 py-2 text-xs text-warning">
            Existing {universeLabel(editingAgent.universe)} universe is preserved by this edit.
          </p>
        ) : null}
        <label className={FIELD_LABEL_CLASS}>
          Mode
          <select
            name="universe-mode"
            value={universeMode}
            onChange={(event) => setUniverseMode(event.currentTarget.value as AgentUniverse['mode'])}
            disabled={universeEditingDisabled}
            className={FIELD_CLASS}
          >
            <option value="static">static subjects</option>
            <option value="screen">saved screen</option>
            <option value="theme">theme</option>
            <option value="portfolio">portfolio</option>
            <option value="agent">agent-derived</option>
          </select>
        </label>
        {universeMode === 'static' ? (
          <label className={FIELD_LABEL_CLASS}>
            Subject refs
            <textarea
              name="static-subject-refs"
              value={staticSubjectRefsText}
              onChange={(event) => setStaticSubjectRefsText(event.currentTarget.value)}
              disabled={universeEditingDisabled}
              rows={4}
              placeholder={'issuer:...\nlisting:...'}
              className={FIELD_CLASS}
            />
          </label>
        ) : (
          <label className={FIELD_LABEL_CLASS}>
            {universeMode} id
            <input
              name="dynamic-universe-id"
              value={dynamicUniverseId}
              onChange={(event) => setDynamicUniverseId(event.currentTarget.value)}
              disabled={universeEditingDisabled}
              className={FIELD_CLASS}
            />
          </label>
        )}
        <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <label className={FIELD_LABEL_CLASS}>
            Quick kind
            <select
              name="subject-kind"
              value={subjectKind}
              onChange={(event) => {
                const next = event.currentTarget.value
                if (isAgentSubjectKind(next)) setSubjectKind(next)
              }}
              disabled={universeEditingDisabled || universeMode !== 'static'}
              className={FIELD_CLASS}
            >
              <option value="issuer">issuer</option>
              <option value="instrument">instrument</option>
              <option value="listing">listing</option>
              <option value="theme">theme</option>
              <option value="macro_topic">macro_topic</option>
            </select>
          </label>
          <label className={FIELD_LABEL_CLASS}>
            Quick subject id
            <input
              name="subject-id"
              value={subjectId}
              onChange={(event) => setSubjectId(event.currentTarget.value)}
              disabled={universeEditingDisabled || universeMode !== 'static'}
              className={FIELD_CLASS}
            />
          </label>
        </div>
      </fieldset>
      <fieldset className={FIELDSET_CLASS}>
        <legend className={`px-1 ${SECTION_LABEL_CLASS}`}>Alert rule</legend>
        {preservesUnsupportedAlertRules ? (
          <p className="rounded-md border border-warning bg-warning-soft px-3 py-2 text-xs text-warning">
            Existing {alertRuleLabel(editingAgent.alert_rules)} alert rules are preserved by this edit.
          </p>
        ) : null}
        <div className="grid gap-3">
          <label className={FIELD_LABEL_CLASS}>
            Rule id
            <input
              name="alert-rule-id"
              value={alertRuleId}
              onChange={(event) => setAlertRuleId(event.currentTarget.value)}
              disabled={preservesUnsupportedAlertRules}
              className={FIELD_CLASS}
            />
          </label>
          <label className={FIELD_LABEL_CLASS}>
            Severity
            <select
              name="alert-severity"
              value={alertSeverity}
              onChange={(event) => setAlertSeverity(event.currentTarget.value)}
              disabled={preservesUnsupportedAlertRules}
              className={FIELD_CLASS}
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="critical">critical</option>
            </select>
          </label>
          <label className={FIELD_LABEL_CLASS}>
            Headline contains
            <input
              name="alert-headline"
              value={alertHeadline}
              onChange={(event) => setAlertHeadline(event.currentTarget.value)}
              disabled={preservesUnsupportedAlertRules}
              className={FIELD_CLASS}
            />
          </label>
          <div role="group" aria-label="Delivery channels" className="grid gap-2 sm:grid-cols-3">
            <label className="inline-flex items-center gap-2 text-sm text-fg">
              <input
                name="alert-email"
                type="checkbox"
                checked={alertEmail}
                onChange={(event) => setAlertEmail(event.currentTarget.checked)}
                disabled={preservesUnsupportedAlertRules}
                className="size-4 accent-accent"
              />
              Email
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-fg">
              <input
                name="alert-web-push"
                type="checkbox"
                checked={alertWebPush}
                onChange={(event) => setAlertWebPush(event.currentTarget.checked)}
                disabled={preservesUnsupportedAlertRules}
                className="size-4 accent-accent"
              />
              Web push
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-fg">
              <input
                name="alert-sms"
                type="checkbox"
                checked={alertSms}
                onChange={(event) => setAlertSms(event.currentTarget.checked)}
                disabled={preservesUnsupportedAlertRules}
                className="size-4 accent-accent"
              />
              SMS
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-fg">
              <input
                name="alert-mobile-push"
                type="checkbox"
                checked={alertMobilePush}
                onChange={(event) => setAlertMobilePush(event.currentTarget.checked)}
                disabled={preservesUnsupportedAlertRules}
                className="size-4 accent-accent"
              />
              Mobile push
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-fg">
              <input
                name="alert-digest"
                type="checkbox"
                checked={alertDigest}
                onChange={(event) => setAlertDigest(event.currentTarget.checked)}
                disabled={preservesUnsupportedAlertRules}
                className="size-4 accent-accent"
              />
              Digest
            </label>
          </div>
        </div>
      </fieldset>
      <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
        {formMessage ? (
          <p role={formMessage.tone === 'error' ? 'alert' : 'status'} className={`mr-auto text-sm ${formMessage.tone === 'error' ? 'text-negative' : 'text-muted'}`}>
            {formMessage.text}
          </p>
        ) : null}
        <button type="submit" className={PRIMARY_BUTTON_CLASS}>
          {editingAgentId ? 'Save agent' : 'Create agent'}
        </button>
      </div>
    </form>
  )
  return (
    <div className={PAGE_CLASS}>
      <PageHeader
        title="Agents"
        description="Research monitors that watch a universe on a schedule and raise findings against your thesis."
      />
      {/* The form moves between columns by class, never by parent, so selecting an agent does not remount it and drop focus.
          auto_1fr keeps the roster row at its own height when the detail column outgrows roster and form. */}
      <div className={`grid items-start gap-6 xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] ${showDetail ? 'xl:grid-rows-[auto_1fr]' : ''}`}>
        <div className="min-w-0 xl:col-start-1 xl:row-start-1">
          <AgentRoster
            agents={agents}
            runs={runs}
            selectedAgentId={selectedAgentId}
            activity={activity}
            loading={session !== null && !rosterSettled}
            loadError={loadError}
            onSelect={setSelectedAgentId}
            onEdit={editAgent}
            onRun={(id) => void runAgent(id)}
            onToggleEnabled={(agent) => void updateAgent(agent.agent_id, { enabled: !agent.enabled })}
            onDelete={(id) => void deleteAgent(id)}
          />
        </div>
        {agentForm}
        {showDetail ? (
          <div className="flex min-w-0 flex-col gap-6 xl:col-start-2 xl:row-start-1 xl:row-span-2">
            <ThesisPanel
              userId={session.userId}
              agentId={selectedAgentId}
              initialThesis={agents.find((agent) => agent.agent_id === selectedAgentId)?.thesis ?? ''}
              refreshKey={thesisRefreshKey}
              onStructuredChange={handleStructuredChange}
              onSaved={handleThesisSaved}
            />
            <AgentDetailPanels
              findings={visibleFindings}
              detailsError={visibleDetailsError}
              runs={runs.filter((run) => run.agent_id === selectedAgentId)}
              runActivities={visibleRunActivities}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
