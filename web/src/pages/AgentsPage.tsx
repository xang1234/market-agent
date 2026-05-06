import { useEffect, useState, type FormEvent } from 'react'

import { useAuth } from '../shell/useAuth.ts'

type AgentRow = {
  agent_id: string
  name: string
  thesis: string
  cadence: string
  enabled: boolean
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

const DEMO_AGENTS: ReadonlyArray<AgentRow> = [
  {
    agent_id: 'demo-quality',
    name: 'Quality monitor',
    thesis: 'Find margin, cash conversion, and guidance changes in covered names.',
    cadence: 'daily',
    enabled: true,
    updated_at: '2026-05-06T00:00:00.000Z',
  },
]

export function AgentsPage() {
  const { session } = useAuth()
  const [agents, setAgents] = useState<ReadonlyArray<AgentRow>>(DEMO_AGENTS)
  const [runs, setRuns] = useState<ReadonlyArray<AgentRunRow>>([])
  const [name, setName] = useState('')
  const [thesis, setThesis] = useState('')
  const [cadence, setCadence] = useState('daily')
  const [activity, setActivity] = useState('Idle')
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!session) return
    const controller = new AbortController()
    fetch('/v1/agents', {
      headers: { 'x-user-id': session.userId },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null
        return (await response.json()) as { agents?: AgentRow[]; runs?: AgentRunRow[] }
      })
      .then((body) => {
        setLoadError(null)
        if (body?.agents) setAgents(body.agents)
        if (body?.runs) setRuns(body.runs)
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setLoadError(caught instanceof Error ? caught.message : String(caught))
      })
    return () => controller.abort()
  }, [session])

  const createAgent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!session) return
    const input = {
      name: name.trim(),
      thesis: thesis.trim(),
      cadence,
      universe: { mode: 'static', subject_refs: [] },
    }
    if (!input.name || !input.thesis) return
    setActivity('Creating agent')
    const response = await fetch('/v1/agents', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': session.userId,
      },
      body: JSON.stringify(input),
    })
    if (response.ok) {
      const created = (await response.json()) as AgentRow
      setAgents((current) => [created, ...current.filter((agent) => agent.agent_id !== created.agent_id)])
      setName('')
      setThesis('')
      setActivity('Agent created')
    } else {
      setActivity(`Create failed: HTTP ${response.status}`)
    }
  }

  const updateAgent = async (agentId: string, patch: Partial<Pick<AgentRow, 'enabled' | 'name' | 'thesis' | 'cadence'>>) => {
    if (!session) return
    setActivity('Updating agent')
    const response = await fetch(`/v1/agents/${encodeURIComponent(agentId)}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-user-id': session.userId,
      },
      body: JSON.stringify(patch),
    })
    if (response.ok) {
      const updated = (await response.json()) as AgentRow
      setAgents((current) => current.map((agent) => (agent.agent_id === updated.agent_id ? updated : agent)))
      setActivity('Agent updated')
    } else {
      setActivity(`Update failed: HTTP ${response.status}`)
    }
  }

  const deleteAgent = async (agentId: string) => {
    if (!session) return
    setActivity('Deleting agent')
    const response = await fetch(`/v1/agents/${encodeURIComponent(agentId)}`, {
      method: 'DELETE',
      headers: { 'x-user-id': session.userId },
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
    const response = await fetch(`/v1/agents/${encodeURIComponent(agentId)}/runs`, {
      method: 'POST',
      headers: { 'x-user-id': session.userId },
    })
    if (response.ok) {
      const run = (await response.json()) as AgentRunRow
      setRuns((current) => [run, ...current])
      setActivity(run.status === 'completed' ? 'Run completed' : 'Run queued')
    } else {
      setActivity(`Run failed: HTTP ${response.status}`)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-8">
      <header>
        <h1 className="text-2xl font-semibold">Agents</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Session-scoped research monitors with durable configuration, run history, and live activity.
        </p>
      </header>
      <section className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <form onSubmit={createAgent} className="flex flex-col gap-4 rounded-md border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Create agent</h2>
          <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-200">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-200">
            Thesis
            <textarea
              value={thesis}
              onChange={(event) => setThesis(event.currentTarget.value)}
              rows={4}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-200">
            Cadence
            <select
              value={cadence}
              onChange={(event) => setCadence(event.currentTarget.value)}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            >
              <option value="hourly">hourly</option>
              <option value="daily">daily</option>
              <option value="weekly">weekly</option>
            </select>
          </label>
          <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">
            Create agent
          </button>
        </form>
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-md border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Agents</h2>
            {loadError ? (
              <p className="mt-3 text-sm text-rose-600 dark:text-rose-300">Load failed: {loadError}</p>
            ) : null}
            <ul className="mt-4 flex flex-col gap-3">
              {agents.map((agent) => (
                <li key={agent.agent_id} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{agent.name}</h3>
                      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{agent.thesis}</p>
                      <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                        {agent.enabled ? 'enabled' : 'disabled'} · {agent.cadence}
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
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
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Run history</h2>
            {runs.length === 0 ? (
              <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">No recorded runs yet.</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {runs.map((run) => (
                  <li key={run.agent_run_log_id} className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                    <span className="font-medium">{run.status}</span>
                    <span className="ml-2 text-neutral-500 dark:text-neutral-400">{run.started_at}</span>
                    {run.error ? <p className="mt-1 text-rose-600 dark:text-rose-300">{run.error}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>
      <section className="rounded-md border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Activity</h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">{activity}</p>
      </section>
    </div>
  )
}
