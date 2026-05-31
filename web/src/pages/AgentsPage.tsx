import { useEffect, useState, type FormEvent } from 'react'

import {
  AgentPayloadValidationError,
  buildAgentPayload,
  canRoundTripAlertRules,
  canRoundTripUniverse,
  isAgentSubjectKind,
  subjectRefsText,
  type AgentAlertRule,
  type AgentPayload,
  type AgentUniverse,
} from '../agents/agentPayload.ts'
import type { SubjectKind } from '../subject/subjectRef.ts'
import { authenticatedFetch } from '../http/authFetch.ts'
import { useAuth } from '../shell/useAuth.ts'

type AgentRow = {
  agent_id: string
  name: string
  thesis: string
  cadence: string
  enabled: boolean
  universe?: AgentUniverse
  alert_rules?: ReadonlyArray<AgentAlertRule>
  updated_at: string
}

type AgentRunRow = {
  agent_run_log_id: string
  agent_id: string
  status: 'running' | 'completed' | 'failed'
  started_at: string
  ended_at: string | null
  error: string | null
}

type AgentFindingRow = {
  finding_id: string
  agent_id: string
  snapshot_id: string
  headline: string
  severity: string
  created_at: string
}

type AgentActivityRow = {
  run_activity_id: string
  agent_id: string
  stage: string
  summary: string
  ts: string
}

const DEMO_AGENTS: ReadonlyArray<AgentRow> = [
  {
    agent_id: 'demo-quality',
    name: 'Quality monitor',
    thesis: 'Find margin, cash conversion, and guidance changes in covered names.',
    cadence: 'daily',
    enabled: true,
    universe: { mode: 'static', subject_refs: [{ kind: 'issuer', id: '99999999-9999-4999-8999-999999999999' }] },
    alert_rules: [
      {
        rule_id: 'demo-margin',
        severity_at_least: 'critical',
        headline_contains: 'margin',
        channels: ['email'],
      },
    ],
    updated_at: '2026-05-06T00:00:00.000Z',
  },
]

export function AgentsPage() {
  const { session } = useAuth()
  const [agents, setAgents] = useState<ReadonlyArray<AgentRow>>(DEMO_AGENTS)
  const [runs, setRuns] = useState<ReadonlyArray<AgentRunRow>>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [findings, setFindings] = useState<ReadonlyArray<AgentFindingRow>>([])
  const [runActivities, setRunActivities] = useState<ReadonlyArray<AgentActivityRow>>([])
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [detailsAgentId, setDetailsAgentId] = useState<string | null>(null)
  const [detailsRefreshKey, setDetailsRefreshKey] = useState(0)
  const [name, setName] = useState('')
  const [thesis, setThesis] = useState('')
  const [cadence, setCadence] = useState('daily')
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null)
  const [editingAgent, setEditingAgent] = useState<AgentRow | null>(null)
  const [universeMode, setUniverseMode] = useState<AgentUniverse['mode']>('static')
  const [staticSubjectRefsText, setStaticSubjectRefsText] = useState('')
  const [dynamicUniverseId, setDynamicUniverseId] = useState('')
  const [subjectKind, setSubjectKind] = useState<SubjectKind>('issuer')
  const [subjectId, setSubjectId] = useState('')
  const [alertRuleId, setAlertRuleId] = useState('')
  const [alertSeverity, setAlertSeverity] = useState('high')
  const [alertHeadline, setAlertHeadline] = useState('')
  const [alertEmail, setAlertEmail] = useState(false)
  const [alertWebPush, setAlertWebPush] = useState(false)
  const [alertSms, setAlertSms] = useState(false)
  const [alertMobilePush, setAlertMobilePush] = useState(false)
  const [alertDigest, setAlertDigest] = useState(false)
  const [activity, setActivity] = useState('Idle')
  const [loadError, setLoadError] = useState<string | null>(null)
  const preservesUnsupportedUniverse =
    editingAgent?.universe !== undefined && !canRoundTripUniverse(editingAgent.universe)
  const preservesUnsupportedAlertRules =
    editingAgent?.alert_rules !== undefined && !canRoundTripAlertRules(editingAgent.alert_rules)
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
        if (!response.ok) return null
        return (await response.json()) as { agents?: AgentRow[]; runs?: AgentRunRow[] }
      })
      .then((body) => {
        setLoadError(null)
        if (body?.agents) {
          setAgents(body.agents)
          setSelectedAgentId((current) => {
            if (current && body.agents?.some((agent) => agent.agent_id === current)) return current
            return body.agents?.[0]?.agent_id ?? null
          })
        }
        if (body?.runs) setRuns(body.runs)
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setLoadError(caught instanceof Error ? caught.message : String(caught))
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
      setActivity(caught instanceof AgentPayloadValidationError ? caught.message : String(caught))
      return
    }
    if (!input.name || !input.thesis) return
    setActivity(editingAgentId ? 'Updating agent' : 'Creating agent')
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
      setActivity(`${editingAgentId ? 'Update' : 'Create'} failed: HTTP ${response.status}`)
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
    setActivity('Editing agent')
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
      const nextAgentId = agents.find((agent) => agent.agent_id !== agentId)?.agent_id ?? null
      setAgents((current) => current.filter((agent) => agent.agent_id !== agentId))
      setRuns((current) => current.filter((run) => run.agent_id !== agentId))
      setSelectedAgentId((current) => (current === agentId ? nextAgentId : current))
      if (selectedAgentId === agentId && nextAgentId === null) {
        setFindings([])
        setRunActivities([])
      }
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
      setActivity(run.status === 'completed' ? 'Run completed' : 'Run queued')
    } else {
      setActivity(`Run failed: HTTP ${response.status}`)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-8">
      <header>
        <h1 className="text-2xl font-semibold">Agents</h1>
        <p className="mt-1 text-sm text-muted">
          Session-scoped research monitors with durable configuration, run history, and live activity.
        </p>
      </header>
      <section className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <form onSubmit={submitAgent} className="flex flex-col gap-4 rounded-md border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-lg font-semibold text-fg">{editingAgentId ? 'Edit agent' : 'Create agent'}</h2>
          <label className="flex flex-col gap-2 text-sm font-medium text-fg">
            Name
            <input
              name="agent-name"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-fg">
            Thesis
            <textarea
              name="agent-thesis"
              value={thesis}
              onChange={(event) => setThesis(event.currentTarget.value)}
              rows={4}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-fg">
            Cadence
            <select
              name="agent-cadence"
              value={cadence}
              onChange={(event) => setCadence(event.currentTarget.value)}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            >
              <option value="hourly">hourly</option>
              <option value="daily">daily</option>
              <option value="weekly">weekly</option>
            </select>
          </label>
          <fieldset className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
            <legend className="px-1 text-sm font-semibold text-fg">Universe</legend>
            {preservesUnsupportedUniverse ? (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                Existing {universeLabel(editingAgent.universe)} universe is preserved by this edit.
              </p>
            ) : null}
            <label className="mt-3 flex flex-col gap-2 text-sm font-medium text-fg">
              Mode
              <select
                name="universe-mode"
                value={universeMode}
                onChange={(event) => setUniverseMode(event.currentTarget.value as AgentUniverse['mode'])}
                disabled={preservesUnsupportedUniverse}
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              >
                <option value="static">static subjects</option>
                <option value="screen">saved screen</option>
                <option value="theme">theme</option>
                <option value="portfolio">portfolio</option>
                <option value="agent">agent-derived</option>
              </select>
            </label>
            {universeMode === 'static' ? (
              <label className="mt-3 flex flex-col gap-2 text-sm font-medium text-fg">
                Subject refs
                <textarea
                  name="static-subject-refs"
                  value={staticSubjectRefsText}
                  onChange={(event) => setStaticSubjectRefsText(event.currentTarget.value)}
                  disabled={preservesUnsupportedUniverse}
                  rows={4}
                  placeholder="issuer:...\nlisting:..."
                  className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                />
              </label>
            ) : (
              <label className="mt-3 flex flex-col gap-2 text-sm font-medium text-fg">
                {universeMode} id
                <input
                  name="dynamic-universe-id"
                  value={dynamicUniverseId}
                  onChange={(event) => setDynamicUniverseId(event.currentTarget.value)}
                  disabled={preservesUnsupportedUniverse}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                />
              </label>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
              <label className="flex flex-col gap-2 text-sm font-medium text-fg">
                Quick kind
                <select
                  name="subject-kind"
                  value={subjectKind}
                  onChange={(event) => {
                    const next = event.currentTarget.value
                    if (isAgentSubjectKind(next)) setSubjectKind(next)
                  }}
                  disabled={preservesUnsupportedUniverse || universeMode !== 'static'}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                >
                  <option value="issuer">issuer</option>
                  <option value="instrument">instrument</option>
                  <option value="listing">listing</option>
                  <option value="theme">theme</option>
                  <option value="macro_topic">macro_topic</option>
                </select>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-fg">
                Quick subject id
                <input
                  name="subject-id"
                  value={subjectId}
                  onChange={(event) => setSubjectId(event.currentTarget.value)}
                  disabled={preservesUnsupportedUniverse || universeMode !== 'static'}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                />
              </label>
            </div>
          </fieldset>
          <fieldset className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
            <legend className="px-1 text-sm font-semibold text-fg">Alert rule</legend>
            {preservesUnsupportedAlertRules ? (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                Existing {alertRuleLabel(editingAgent.alert_rules)} alert rules are preserved by this edit.
              </p>
            ) : null}
            <div className="mt-3 grid gap-3">
              <label className="flex flex-col gap-2 text-sm font-medium text-fg">
                Rule id
                <input
                  name="alert-rule-id"
                  value={alertRuleId}
                  onChange={(event) => setAlertRuleId(event.currentTarget.value)}
                  disabled={preservesUnsupportedAlertRules}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-fg">
                Severity
                <select
                  name="alert-severity"
                  value={alertSeverity}
                  onChange={(event) => setAlertSeverity(event.currentTarget.value)}
                  disabled={preservesUnsupportedAlertRules}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="critical">critical</option>
                </select>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-fg">
                Headline contains
                <input
                  name="alert-headline"
                  value={alertHeadline}
                  onChange={(event) => setAlertHeadline(event.currentTarget.value)}
                  disabled={preservesUnsupportedAlertRules}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                />
              </label>
              <label className="inline-flex items-center gap-2 text-sm font-medium text-fg">
                <input
                  name="alert-email"
                  type="checkbox"
                  checked={alertEmail}
                  onChange={(event) => setAlertEmail(event.currentTarget.checked)}
                  disabled={preservesUnsupportedAlertRules}
                  className="size-4"
                />
                Email
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="inline-flex items-center gap-2 text-sm font-medium text-fg">
                  <input
                    name="alert-web-push"
                    type="checkbox"
                    checked={alertWebPush}
                    onChange={(event) => setAlertWebPush(event.currentTarget.checked)}
                    disabled={preservesUnsupportedAlertRules}
                    className="size-4"
                  />
                  Web push
                </label>
                <label className="inline-flex items-center gap-2 text-sm font-medium text-fg">
                  <input
                    name="alert-sms"
                    type="checkbox"
                    checked={alertSms}
                    onChange={(event) => setAlertSms(event.currentTarget.checked)}
                    disabled={preservesUnsupportedAlertRules}
                    className="size-4"
                  />
                  SMS
                </label>
                <label className="inline-flex items-center gap-2 text-sm font-medium text-fg">
                  <input
                    name="alert-mobile-push"
                    type="checkbox"
                    checked={alertMobilePush}
                    onChange={(event) => setAlertMobilePush(event.currentTarget.checked)}
                    disabled={preservesUnsupportedAlertRules}
                    className="size-4"
                  />
                  Mobile push
                </label>
                <label className="inline-flex items-center gap-2 text-sm font-medium text-fg">
                  <input
                    name="alert-digest"
                    type="checkbox"
                    checked={alertDigest}
                    onChange={(event) => setAlertDigest(event.currentTarget.checked)}
                    disabled={preservesUnsupportedAlertRules}
                    className="size-4"
                  />
                  Digest
                </label>
              </div>
            </div>
          </fieldset>
          <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">
            {editingAgentId ? 'Save agent' : 'Create agent'}
          </button>
        </form>
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-md border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="text-lg font-semibold text-fg">Agents</h2>
            {loadError ? (
              <p className="mt-3 text-sm text-rose-600 dark:text-rose-300">Load failed: {loadError}</p>
            ) : null}
            <ul className="mt-4 flex flex-col gap-3">
              {agents.map((agent) => (
                <li
                  key={agent.agent_id}
                  className={`rounded-md border p-3 ${
                    selectedAgentId === agent.agent_id
                      ? 'border-neutral-900 dark:border-neutral-100'
                      : 'border-line'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-fg">{agent.name}</h3>
                      <p className="mt-1 text-sm text-fg-soft">{agent.thesis}</p>
                      <p className="mt-2 text-xs text-muted">
                        {agent.enabled ? 'enabled' : 'disabled'} · {agent.cadence}
                      </p>
                      <p className="mt-2 text-xs text-muted">
                        Universe: {universeLabel(agent.universe)}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        Alert rule: {alertRuleLabel(agent.alert_rules)}
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedAgentId(agent.agent_id)}
                        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium dark:border-neutral-700"
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => editAgent(agent)}
                        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium dark:border-neutral-700"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void runAgent(agent.agent_id)}
                        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium dark:border-neutral-700"
                      >
                        Run
                      </button>
                      <button
                        type="button"
                        onClick={() => void updateAgent(agent.agent_id, { enabled: !agent.enabled })}
                        className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium dark:border-neutral-700"
                      >
                        {agent.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteAgent(agent.agent_id)}
                        className="rounded-md border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 dark:border-rose-700 dark:text-rose-200"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-md border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="text-lg font-semibold text-fg">Findings</h2>
            {visibleDetailsError ? (
              <p className="mt-3 text-sm text-rose-600 dark:text-rose-300">Details failed: {visibleDetailsError}</p>
            ) : null}
            {visibleFindings.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No findings for this agent yet.</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {visibleFindings.map((finding) => (
                  <li key={finding.finding_id} className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-medium text-fg">{finding.headline}</span>
                      <span className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
                        {finding.severity}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted">{finding.created_at}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-md border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="text-lg font-semibold text-fg">Run history</h2>
            {runs.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No recorded runs yet.</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {runs.map((run) => (
                  <li key={run.agent_run_log_id} className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                    <span className="font-medium">{run.status}</span>
                    <span className="ml-2 text-muted">{run.started_at}</span>
                    {run.error ? <p className="mt-1 text-rose-600 dark:text-rose-300">{run.error}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-md border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="text-lg font-semibold text-fg">Run activity</h2>
            {visibleRunActivities.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No activity for this agent yet.</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {visibleRunActivities.map((item) => (
                  <li key={item.run_activity_id} className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
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
        </div>
      </section>
      <section className="rounded-md border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold text-fg">Activity</h2>
        <p className="mt-2 text-sm text-fg-soft">{activity}</p>
      </section>
    </div>
  )
}

function universeLabel(universe: AgentRow['universe']): string {
  if (!universe) return 'not configured'
  if (universe.mode === 'static') {
    if (universe.subject_refs.length === 0) return 'static empty'
    return universe.subject_refs.map((ref) => `${ref.kind}: ${ref.id}`).join(', ')
  }
  if (universe.mode === 'screen') return `screen: ${universe.screen_id}`
  if (universe.mode === 'theme') return `theme: ${universe.theme_id}`
  if (universe.mode === 'portfolio') return `portfolio: ${universe.portfolio_id}`
  return `agent: ${universe.agent_id}`
}

function alertRuleLabel(alertRules: AgentRow['alert_rules']): string {
  const rule = alertRules?.[0]
  if (!rule) return 'not configured'
  const severity = rule.severity_at_least ?? 'any'
  const headline = rule.headline_contains ? ` headline contains ${rule.headline_contains}` : ''
  const channels = rule.channels?.length ? ` via ${rule.channels.join(', ')}` : ''
  return `${severity}+${headline}${channels}`.trim()
}

function dynamicUniverseIdFor(universe: AgentRow['universe']): string {
  if (!universe || universe.mode === 'static') return ''
  if (universe.mode === 'screen') return universe.screen_id
  if (universe.mode === 'theme') return universe.theme_id
  if (universe.mode === 'portfolio') return universe.portfolio_id
  return universe.agent_id
}
