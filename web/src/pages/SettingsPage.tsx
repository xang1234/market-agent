import { LlmCredentialsPanel } from '../settings/LlmCredentialsPanel.tsx'

// Protected workspace settings surface (rollout step 2 of the multi-LLM
// provider plan). Today only the Models tab exists; data-source credentials
// and other per-user preferences will land here as separate panels.
export function SettingsPage(): JSX.Element {
  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto p-8">
      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Configure the model providers used for summaries, chat answers, and document reading.
          Keys are encrypted server-side and never returned to the browser after save.
        </p>
      </header>
      <section aria-label="Model providers">
        <h2 className="mb-3 text-lg font-semibold">Models</h2>
        <LlmCredentialsPanel />
      </section>
    </div>
  )
}
