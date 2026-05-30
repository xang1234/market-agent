# Task 3: Web Evidence Inspector Shell


**Files:**
- Create: `web/src/evidence/inspectionTypes.ts`
- Create: `web/src/evidence/inspectionClient.ts`
- Create: `web/src/evidence/EvidenceInspectorProvider.tsx`
- Create: `web/src/evidence/EvidenceInspectorDrawer.tsx`
- Modify: `web/src/shell/WorkspaceShell.tsx`
- Test: `web/src/evidence/inspectionClient.test.ts`
- Test: `web/src/evidence/EvidenceInspectorProvider.test.tsx`

- [ ] **Step 1: Write failing client test**

Create `web/src/evidence/inspectionClient.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { fetchEvidenceInspection } from "./inspectionClient.ts";

test("fetchEvidenceInspection requests the normalized inspect endpoint", async () => {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const result = await fetchEvidenceInspection({
    userId: "00000000-0000-4000-8000-000000000001",
    snapshotId: "11111111-1111-4111-8111-111111111111",
    ref: { kind: "source", id: "22222222-2222-4222-8222-222222222222" },
    fetchImpl: async (input, init) => {
      calls.push(String(input));
      assert.equal((init?.headers as Record<string, string>)["x-user-id"], "00000000-0000-4000-8000-000000000001");
      assert.equal((init?.headers as Record<string, string>)["content-type"], "application/json");
      assert.equal(init?.method, "POST");
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        snapshot_id: "11111111-1111-4111-8111-111111111111",
        ref: { kind: "source", id: "22222222-2222-4222-8222-222222222222" },
        kind: "source",
        title: "sec filing",
        subtitle: null,
        badges: ["primary"],
        rows: [{ label: "Provider", value: "sec" }],
        links: [],
        related_refs: [],
      }), { status: 200 });
    },
  });
  assert.equal(calls[0], "/v1/evidence/inspect");
  assert.deepEqual(bodies[0], {
    snapshot_id: "11111111-1111-4111-8111-111111111111",
    ref: { kind: "source", id: "22222222-2222-4222-8222-222222222222" },
  });
  assert.equal(result.title, "sec filing");
});
```

- [ ] **Step 2: Run client test to verify failure**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/web
npm test -- src/evidence/inspectionClient.test.ts
```

Expected: FAIL with module-not-found for `inspectionClient.ts`.

- [ ] **Step 3: Add web inspection types and fetch helper**

Create `web/src/evidence/inspectionTypes.ts`:

```ts
export type EvidenceInspectionRefKind =
  | "source"
  | "document"
  | "claim"
  | "event"
  | "fact";

export type EvidenceInspectionRef = {
  kind: EvidenceInspectionRefKind;
  id: string;
};

export type EvidenceInspection = {
  snapshot_id: string;
  ref: EvidenceInspectionRef;
  kind: EvidenceInspectionRefKind;
  title: string;
  subtitle: string | null;
  badges: ReadonlyArray<string>;
  rows: ReadonlyArray<{ label: string; value: string }>;
  links: ReadonlyArray<{ label: string; href: string }>;
  related_refs: ReadonlyArray<EvidenceInspectionRef>;
};
```

Create `web/src/evidence/inspectionClient.ts`:

```ts
import { authenticatedJson, type FetchImpl } from "../http/authFetch.ts";
import type { EvidenceInspection, EvidenceInspectionRef } from "./inspectionTypes.ts";

export async function fetchEvidenceInspection(input: {
  userId: string;
  snapshotId: string;
  ref: EvidenceInspectionRef;
  fetchImpl?: FetchImpl;
}): Promise<EvidenceInspection> {
  return authenticatedJson<EvidenceInspection>("/v1/evidence/inspect", {
    method: "POST",
    userId: input.userId,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      snapshot_id: input.snapshotId,
      ref: input.ref,
    }),
    fetchImpl: input.fetchImpl,
  });
}
```

- [ ] **Step 4: Add provider and drawer**

Create `web/src/evidence/EvidenceInspectorProvider.tsx`:

```tsx
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { fetchEvidenceInspection } from "./inspectionClient.ts";
import type { EvidenceInspection, EvidenceInspectionRef } from "./inspectionTypes.ts";
import { EvidenceInspectorDrawer } from "./EvidenceInspectorDrawer.tsx";
import { useAuth } from "../shell/useAuth.ts";

const EVIDENCE_INSPECTION_UNAVAILABLE_MESSAGE = "Evidence is not available for this artifact.";

type InspectorState =
  | { kind: "closed" }
  | { kind: "loading"; snapshotId: string; ref: EvidenceInspectionRef }
  | { kind: "ready"; inspection: EvidenceInspection }
  | { kind: "error"; snapshotId: string; ref: EvidenceInspectionRef; message: string };

type EvidenceInspectorContextValue = {
  openInspection(input: { snapshotId: string; ref: EvidenceInspectionRef }): void;
  closeInspection(): void;
};

const EvidenceInspectorContext = createContext<EvidenceInspectorContextValue | null>(null);

export function EvidenceInspectorProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [state, setState] = useState<InspectorState>({ kind: "closed" });

  const value = useMemo<EvidenceInspectorContextValue>(() => ({
    openInspection({ snapshotId, ref }) {
      if (!session) {
        setState({ kind: "error", snapshotId, ref, message: "Sign in to inspect evidence." });
        return;
      }
      setState({ kind: "loading", snapshotId, ref });
      fetchEvidenceInspection({ userId: session.userId, snapshotId, ref })
        .then((inspection) => setState({ kind: "ready", inspection }))
        .catch((error) =>
          setState({
            kind: "error",
            snapshotId,
            ref,
            message: inspectionErrorMessage(error),
          }),
        );
    },
    closeInspection() {
      setState({ kind: "closed" });
    },
  }), [session]);

  return (
    <EvidenceInspectorContext.Provider value={value}>
      {children}
      <EvidenceInspectorDrawer state={state} onClose={value.closeInspection} />
    </EvidenceInspectorContext.Provider>
  );
}

export function useEvidenceInspector(): EvidenceInspectorContextValue | null {
  const value = useContext(EvidenceInspectorContext);
  return value;
}

function inspectionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("evidence is not available for this artifact")
    ? EVIDENCE_INSPECTION_UNAVAILABLE_MESSAGE
    : message;
}
```

Create `web/src/evidence/EvidenceInspectorDrawer.tsx`:

```tsx
import type { EvidenceInspection, EvidenceInspectionRef } from "./inspectionTypes.ts";

type InspectorState =
  | { kind: "closed" }
  | { kind: "loading"; snapshotId: string; ref: EvidenceInspectionRef }
  | { kind: "ready"; inspection: EvidenceInspection }
  | { kind: "error"; snapshotId: string; ref: EvidenceInspectionRef; message: string };

export function EvidenceInspectorDrawer({
  state,
  onClose,
}: {
  state: InspectorState;
  onClose(): void;
}) {
  if (state.kind === "closed") return null;
  return (
    <aside
      aria-label="Evidence inspector"
      className="fixed bottom-0 right-0 top-0 z-50 flex w-[420px] max-w-full flex-col border-l border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-950"
    >
      <header className="flex items-start justify-between gap-3 border-b border-neutral-200 p-4 dark:border-neutral-800">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Evidence</h2>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {state.kind === "ready" ? state.inspection.snapshot_id : state.snapshotId}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700">
          Close
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {state.kind === "loading" ? <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading evidence.</p> : null}
        {state.kind === "error" ? <p className="text-sm text-neutral-600 dark:text-neutral-300">{state.message}</p> : null}
        {state.kind === "ready" ? <InspectionBody inspection={state.inspection} /> : null}
      </div>
    </aside>
  );
}

function InspectionBody({ inspection }: { inspection: EvidenceInspection }) {
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{inspection.title}</h3>
        {inspection.subtitle ? <p className="mt-1 break-words text-xs text-neutral-500 dark:text-neutral-400">{inspection.subtitle}</p> : null}
        {inspection.badges.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {inspection.badges.map((badge) => (
              <span key={badge} className="rounded border border-neutral-300 px-2 py-0.5 text-xs dark:border-neutral-700">
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
              <a href={link.href} target="_blank" rel="noreferrer" className="text-sm underline">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Wrap the shell**

Modify `web/src/shell/WorkspaceShell.tsx`:

```tsx
import { EvidenceInspectorProvider } from "../evidence/EvidenceInspectorProvider.tsx";
```

Wrap the existing `WatchlistProvider` body:

```tsx
<WatchlistProvider userId={userId}>
  <EvidenceInspectorProvider>
    <div className="flex h-full w-full bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <WatchlistSlot />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <PrimaryTabs />
        <div className="flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <RouteScopeGate />
          </main>
          <RightRailSlot />
        </div>
      </div>
    </div>
    <AuthInterrupt />
  </EvidenceInspectorProvider>
</WatchlistProvider>
```

- [ ] **Step 6: Run web evidence tests**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/web
npm test -- src/evidence/inspectionClient.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/evidence web/src/shell/WorkspaceShell.tsx
git commit -m "feat(web): add evidence inspector shell"
```
