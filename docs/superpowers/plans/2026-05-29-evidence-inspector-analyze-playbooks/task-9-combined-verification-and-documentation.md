# Task 9: Combined Verification And Documentation


**Files:**
- Modify: `README.md`
- Modify: `services/evidence/README.md`
- Modify: `services/analyze/README.md` if present; otherwise modify `services/analyze/src/index.ts` only through exports already covered.
- Modify: `web/src/pages/workflowSurfaces.test.tsx`

- [ ] **Step 1: Add workflow tests for the combined surface**

Add to `web/src/pages/workflowSurfaces.test.tsx`:

```ts
test("Analyze playbooks and inspectable evidence controls are present in workflow surfaces", async () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <AuthContext.Provider value={mockSignedInAuth()}>
        <WorkspaceShell />
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  assert.match(html, /Finance Research/);
  assert.doesNotMatch(html, /raw provider payload/i);
});
```

Keep this test narrow. Detailed behavior is covered by the unit tests in previous tasks.

- [ ] **Step 2: Run service and web tests**

Run:

```bash
cd /Users/admin/Documents/Work/market-agent/services/evidence
npm test
cd /Users/admin/Documents/Work/market-agent/services/dev-api
npm test
cd /Users/admin/Documents/Work/market-agent/services/analyze
npm test
cd /Users/admin/Documents/Work/market-agent
ruby -e 'require "yaml"; YAML.load_file("spec/finance_research_openapi.yaml")'
cd /Users/admin/Documents/Work/market-agent/web
npm test
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 3: Update README product copy**

Modify `README.md` usage walkthrough:

```md
### Evidence inspector
Snapshot-backed blocks expose inspectable refs. Selecting a number, claim, event, source, or block opens the Evidence inspector with the sealed `snapshot_id`, provenance rows, quality badges, source links, and related refs.

### Analyze
A guided playbook workflow. Pick a playbook such as *Earnings quality*, *Variant view*, or *Peer comparison*, tune instructions and source categories, generate a memo, inspect its evidence, rerun it, compare it with prior runs, and add the result to chat with shared snapshot provenance.
```

- [ ] **Step 4: Update Evidence README**

Add to `services/evidence/README.md`:

```md
## Evidence Inspector

`loadEvidenceInspection(db, { user_id, snapshot_id, ref })` is the read-side contract for user-facing provenance inspection. It first verifies that the user can see an artifact referencing the sealed snapshot, then verifies that the requested ref is present in the snapshot manifest, and returns a normalized inspection envelope with title, badges, rows, links, and related refs.

The inspector is intentionally read-only. It does not retrieve raw untrusted document text and does not alter fact, claim, event, or source state.
```

- [ ] **Step 5: Final status and commit**

Run:

```bash
git status --short
```

Expected: only intended files are modified.

Commit:

```bash
git add README.md services/evidence/README.md web/src/pages/workflowSurfaces.test.tsx
git commit -m "docs: describe evidence inspector and analyze playbooks"
```

## Final Integration Checklist

- [ ] Run the full local verification command set:

```bash
cd /Users/admin/Documents/Work/market-agent/services/evidence && npm test
cd /Users/admin/Documents/Work/market-agent/services/dev-api && npm test
cd /Users/admin/Documents/Work/market-agent/services/analyze && npm test
cd /Users/admin/Documents/Work/market-agent && ruby -e 'require "yaml"; YAML.load_file("spec/finance_research_openapi.yaml")'
cd /Users/admin/Documents/Work/market-agent/web && npm test && npm run build
```

- [ ] Run database migration registry tests:

```bash
cd /Users/admin/Documents/Work/market-agent/db
npm test -- test/migration-registry.test.ts
```

- [ ] Check worktree state:

```bash
cd /Users/admin/Documents/Work/market-agent
git status --short
```

- [ ] Close the implementation bead that is used for execution.

- [ ] Sync beads and push:

```bash
bd sync
git pull --rebase
git push
git status --short --branch
```

Expected: branch reports up to date with origin.

## Plan Self-Review

- Spec coverage: Tasks 1-4 cover the universal evidence inspector from service contract through HTTP route, shell state, drawer UI, and inspectable block renderers. Tasks 5-8 cover guided Analyze playbooks from service contract through HTTP routes, web workflow, run history, rerun support, diffing, and durable metadata. Task 9 covers combined verification and docs.
- Placeholder scan: no incomplete acceptance criteria or unspecified edge handling remains in the plan.
- Type consistency: `EvidenceInspectionRef`, `EvidenceInspection`, `AnalyzePlaybook`, `AnalyzeRunHistoryItem`, and route names are introduced before use and reused consistently across backend and web tasks.
