import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, useContext, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import type { CandidateView, CampaignDetail, CampaignEvent, RunRecord, RunView, SavedBrief } from "../../../services/discovery/src/types.ts";
import { AuthContext } from "../shell/authTypes.ts";
import { CampaignPage } from "./CampaignPage.tsx";

test("suppresses a double-click while starting a run", async () => {
  // This would catch two runs being requested before React disables the start button.
  const pending = deferred<Response>();
  const harness = await mountPage(async (url, init) => {
    if (url.includes("/campaigns/campaign-1") && !url.endsWith("/runs")) return json(detail());
    if (url.endsWith("/runs") && init?.method === "POST") return pending.promise;
    return json(emptyResponse(url));
  });
  try {
    const button = harness.button("Approve brief and start");
    await act(async () => {
      button.dispatchEvent(new harness.window.MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new harness.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(harness.startBodies.length, 1);
    pending.resolve(json(runRecord("queued"), 201));
    await act(async () => { await delay(10); });
  } finally {
    await harness.unmount();
  }
});

test("keeps one request identity when an uncertain start is retried", async () => {
  // This would catch generating a second start identity after a network failure.
  let starts = 0;
  const harness = await mountPage(async (url, init) => {
    if (url.includes("/campaigns/campaign-1") && !url.endsWith("/runs")) return json(detail());
    if (url.endsWith("/runs") && init?.method === "POST") {
      starts += 1;
      if (starts === 1) throw new Error("network interrupted");
      return json(runRecord("queued"), 201);
    }
    return json(emptyResponse(url));
  });
  try {
    await harness.click("Approve brief and start");
    assert.match(harness.document.body.textContent ?? "", /could not start/i);
    await harness.click("Approve brief and start");
    assert.equal(harness.startBodies.length, 2);
    assert.equal(harness.startBodies[0]?.request_key, harness.startBodies[1]?.request_key);
    assert.equal(harness.startBodies[0]?.brief_version, 1);
    assert.equal(harness.startBodies[0]?.brief_hash, saved().hash);
  } finally {
    await harness.unmount();
  }
});

test("refreshes all result groups and the trail after a later active poll", async () => {
  // This would catch refreshing only the compact run view while candidate groups and activity stay stale.
  let runReads = 0;
  const shortlisted = candidate("shortlisted", "Shortlisted company", "shortlisted");
  const investigated = candidate("investigated", "Investigated company", "eligible_not_shortlisted", decision());
  const unresolved = candidate("unresolved", "Unresolved company", "not_selected");
  const event = campaignEvent("New research activity");
  const harness = await mountPage(async (url) => {
    if (url.includes("/campaigns/campaign-1") && !url.endsWith("/runs")) return json(detail("campaign-1", runRecord("running")));
    if (url.includes("/runs/run-1/candidates")) return json({ items: runReads >= 2 ? [shortlisted, investigated, unresolved] : [], next_cursor: null });
    if (url.includes("/runs/run-1/events")) return json({ items: runReads >= 2 ? [event] : [], next_sequence: runReads >= 2 ? 1 : 0, has_more: false });
    if (url.includes("/runs/run-1")) {
      runReads += 1;
      return json(runView("running", runReads >= 2 ? [shortlisted] : []));
    }
    return json(emptyResponse(url));
  });
  try {
    await waitFor(() => harness.document.body.textContent?.includes("Investigated (1)") ?? false);
    assert.match(harness.document.body.textContent ?? "", /Shortlist \(1\)/);
    assert.match(harness.document.body.textContent ?? "", /Not selected & unresolved \(1\)/);
    assert.match(harness.document.body.textContent ?? "", /New research activity/);
    await harness.click("Investigated (1)");
    assert.match(harness.document.body.textContent ?? "", /Investigated company/);
    await harness.click("Not selected & unresolved (1)");
    assert.match(harness.document.body.textContent ?? "", /Unresolved company/);
  } finally {
    await harness.unmount();
  }
});

test("refreshes all result groups and the trail when a running poll reaches completion", async () => {
  // This would catch stopping the candidate/event refresh just before terminal work is published.
  let runReads = 0;
  const shortlisted = candidate("terminal-shortlisted", "Terminal shortlisted company", "shortlisted");
  const investigated = candidate("terminal-investigated", "Terminal investigated company", "eligible_not_shortlisted", decision());
  const unresolved = candidate("terminal-unresolved", "Terminal unresolved company", "not_selected");
  const event = campaignEvent("Final research activity");
  const harness = await mountPage(async (url) => {
    if (url.includes("/campaigns/campaign-1") && !url.endsWith("/runs")) return json(detail("campaign-1", runRecord("running")));
    if (url.includes("/runs/run-1/candidates")) return json({ items: runReads >= 2 ? [shortlisted, investigated, unresolved] : [], next_cursor: null });
    if (url.includes("/runs/run-1/events")) return json({ items: runReads >= 2 ? [event] : [], next_sequence: runReads >= 2 ? 1 : 0, has_more: false });
    if (url.includes("/runs/run-1")) {
      runReads += 1;
      return json(runView(runReads >= 2 ? "completed" : "running", runReads >= 2 ? [shortlisted] : []));
    }
    return json(emptyResponse(url));
  });
  try {
    await waitFor(() => harness.document.body.textContent?.includes("Investigated (1)") ?? false);
    assert.match(harness.document.body.textContent ?? "", /Shortlist \(1\)/);
    assert.match(harness.document.body.textContent ?? "", /Not selected & unresolved \(1\)/);
    assert.match(harness.document.body.textContent ?? "", /Final research activity/);
    await harness.click("Investigated (1)");
    assert.match(harness.document.body.textContent ?? "", /Terminal investigated company/);
    await harness.click("Not selected & unresolved (1)");
    assert.match(harness.document.body.textContent ?? "", /Terminal unresolved company/);
  } finally {
    await harness.unmount();
  }
});

test("does not let a cancelled route's delayed start response change the current page", async () => {
  // This would catch a stale start completion navigating back to its former campaign.
  const pending = deferred<Response>();
  const start = { signal: null as AbortSignal | null };
  const harness = await mountPage(async (url, init) => {
    if (url.includes("/campaigns/campaign-1") && !url.endsWith("/runs")) return json(detail("campaign-1"));
    if (url.includes("/campaigns/campaign-2") && !url.endsWith("/runs")) return json(detail("campaign-2"));
    if (url.endsWith("/campaigns/campaign-1/runs") && init?.method === "POST") {
      start.signal = init.signal ?? null;
      return pending.promise;
    }
    return json(emptyResponse(url));
  });
  try {
    await harness.click("Approve brief and start");
    await harness.navigate("/discovery/campaign-2");
    assert.equal(start.signal?.aborted, true, "switching campaigns aborts the old start request");
    pending.resolve(json(runRecord("queued"), 201));
    await act(async () => { await delay(20); });
    assert.equal(harness.route(), "/discovery/campaign-2");
    assert.match(harness.document.body.textContent ?? "", /Grid research campaign-2/);
  } finally {
    await harness.unmount();
  }
});

test("does not let a delayed start response replace a later run choice in the same campaign", async () => {
  // This would catch a campaign-only identity guard overwriting a later run route.
  const pending = deferred<Response>();
  const harness = await mountPage(async (url, init) => {
    if (url.includes("/campaigns/campaign-1") && !url.endsWith("/runs")) return json(detail("campaign-1"));
    if (url.endsWith("/campaigns/campaign-1/runs") && init?.method === "POST") return pending.promise;
    return json(emptyResponse(url));
  });
  try {
    await harness.click("Approve brief and start");
    await harness.navigate("/discovery/campaign-1/runs/run-existing");
    pending.resolve(json(runRecord("queued"), 201));
    await act(async () => { await delay(20); });
    assert.equal(harness.route(), "/discovery/campaign-1/runs/run-existing");
  } finally {
    await harness.unmount();
  }
});

test("shows disabled cancellation feedback while the cancellation request is pending", async () => {
  // This would catch a second cancellation remaining available while the first request is unresolved.
  const pending = deferred<Response>();
  const harness = await mountPage(async (url, init) => {
    if (url.includes("/campaigns/campaign-1") && !url.endsWith("/runs")) return json(detail("campaign-1", runRecord("running")));
    if (url.includes("/runs/run-1/cancel") && init?.method === "POST") return pending.promise;
    if (url.includes("/runs/run-1")) return json(runView("running"));
    return json(emptyResponse(url));
  });
  try {
    await waitFor(() => !!harness.findButton("Cancel research"));
    await harness.click("Cancel research");
    const button = harness.button("Requesting cancellation…") as HTMLButtonElement;
    assert.equal(button.disabled, true);
    pending.resolve(json(runRecord("running")));
    await act(async () => { await delay(20); });
  } finally {
    await harness.unmount();
  }
});

test("copying a cited shortlist rereads the authorized run and candidates without saving", async () => {
  let runReads = 0;
  let candidateReads = 0;
  const methods: string[] = [];
  const visible = researchCandidate();
  const harness = await mountPage(async (url, init) => {
    methods.push(init?.method ?? "GET");
    if (url.includes("/campaigns/campaign-1") && !url.endsWith("/runs")) return json(detail("campaign-1", runRecord("completed")));
    if (url.includes("/runs/run-1/candidates")) { candidateReads += 1; return json({ items: [visible], next_cursor: null }); }
    if (url.includes("/runs/run-1/events")) return json({ items: [], next_sequence: 0, has_more: false });
    if (url.includes("/runs/run-1")) { runReads += 1; return json(runView("completed", [visible])); }
    return json(emptyResponse(url));
  });
  try {
    await waitFor(() => !!harness.findButton("Copy cited shortlist"));
    await harness.click("Copy cited shortlist");
    assert.ok(runReads >= 2, "export must fetch a fresh authorized run");
    assert.ok(candidateReads >= 2, "export must fetch a fresh authorized candidate listing");
    assert.ok(harness.document.querySelector<HTMLTextAreaElement>('[aria-label="Cited research export"]')?.value.includes("Research shortlist"));
    assert.equal(methods.some((method) => method !== "GET"), false);
  } finally {
    await harness.unmount();
  }
});

test("a revoked fresh export read cancels the action and keeps stale research out of the export", async () => {
  let runReads = 0;
  const visible = researchCandidate();
  const harness = await mountPage(async (url) => {
    if (url.includes("/campaigns/campaign-1") && !url.endsWith("/runs")) return json(detail("campaign-1", runRecord("completed")));
    if (url.includes("/runs/run-1/candidates")) return json({ items: [visible], next_cursor: null });
    if (url.includes("/runs/run-1/events")) return json({ items: [], next_sequence: 0, has_more: false });
    if (url.includes("/runs/run-1")) {
      runReads += 1;
      return runReads === 1 ? json(runView("completed", [visible])) : json({ error: "revoked" }, 403);
    }
    return json(emptyResponse(url));
  });
  try {
    await waitFor(() => !!harness.findButton("Copy cited shortlist"));
    await harness.click("Copy cited shortlist");
    assert.match(harness.document.body.textContent ?? "", /research access changed; export cancelled/i);
    assert.equal(harness.document.querySelector('[aria-label="Cited research export"]'), null);
  } finally {
    await harness.unmount();
  }
});

test("does not retain Run A's cited export after the selected route changes to Run B", { timeout: 5_000 }, async () => {
  const runA = { ...runView("completed"), run_id: "run-a" };
  const runB = { ...runView("completed"), run_id: "run-b" };
  const candidateA = { ...researchCandidate(), candidate_id: "candidate-a", name: "Run A private company" };
  const candidateB = { ...researchCandidate(), candidate_id: "candidate-b", name: "Run B company" };
  const harness = await mountPage(async (url) => {
    if (url.endsWith("/campaigns/campaign-1")) return json(detail("campaign-1", runA));
    if (url.includes("/runs/run-a/candidates")) return json({ items: [candidateA], next_cursor: null });
    if (url.includes("/runs/run-b/candidates")) return json({ items: [candidateB], next_cursor: null });
    if (url.includes("/runs/run-a/events") || url.includes("/runs/run-b/events")) return json({ items: [], next_sequence: 0, has_more: false });
    if (url.includes("/runs/run-a")) return json({ ...runA, shortlist: [candidateA] });
    if (url.includes("/runs/run-b")) return json({ ...runB, shortlist: [candidateB] });
    return json(emptyResponse(url));
  }, "/discovery/campaign-1/runs/run-a");
  try {
    await waitFor(() => !!harness.findButton("Copy cited shortlist"));
    await harness.click("Copy cited shortlist");
    assert.match(harness.document.querySelector<HTMLTextAreaElement>('[aria-label="Cited research export"]')?.value ?? "", /Run A private company/);

    await harness.navigate("/discovery/campaign-1/runs/run-b");

    assert.equal(harness.document.querySelector('[aria-label="Cited research export"]') === null, true);
    assert.doesNotMatch(harness.document.body.textContent ?? "", /Run A private company/);
  } finally {
    await harness.unmount();
  }
});

test("cancels a cited export when the route changes while clipboard writing is pending", async () => {
  const runA = { ...runView("completed"), run_id: "run-a" };
  const runB = { ...runView("completed"), run_id: "run-b" };
  const candidateA = { ...researchCandidate(), candidate_id: "candidate-a", name: "Run A private company" };
  const candidateB = { ...researchCandidate(), candidate_id: "candidate-b", name: "Run B company" };
  const clipboardWrite = deferred<void>();
  const restoreClipboard = installClipboard(() => clipboardWrite.promise);
  const harness = await mountPage(async (url) => {
    if (url.endsWith("/campaigns/campaign-1")) return json(detail("campaign-1", runA));
    if (url.includes("/runs/run-a/candidates")) return json({ items: [candidateA], next_cursor: null });
    if (url.includes("/runs/run-b/candidates")) return json({ items: [candidateB], next_cursor: null });
    if (url.includes("/runs/run-a/events") || url.includes("/runs/run-b/events")) return json({ items: [], next_sequence: 0, has_more: false });
    if (url.includes("/runs/run-a")) return json({ ...runA, shortlist: [candidateA] });
    if (url.includes("/runs/run-b")) return json({ ...runB, shortlist: [candidateB] });
    return json(emptyResponse(url));
  }, "/discovery/campaign-1/runs/run-a");
  try {
    await waitFor(() => !!harness.findButton("Copy cited shortlist"));
    await harness.click("Copy cited shortlist");
    await harness.navigate("/discovery/campaign-1/runs/run-b");
    clipboardWrite.resolve();
    await act(async () => { await delay(10); });

    assert.equal(harness.document.querySelector('[aria-label="Cited research export"]') === null, true);
    assert.match(harness.document.body.textContent ?? "", /research action was cancelled because the selected run changed/i);
    assert.doesNotMatch(harness.document.body.textContent ?? "", /Cited research export is ready/i);
  } finally {
    await harness.unmount();
    restoreClipboard();
  }
});

test("does not render User A's cited export during a direct switch to User B on the same run", async () => {
  const run = { ...runView("completed"), run_id: "run-a" };
  const candidate = { ...researchCandidate(), candidate_id: "candidate-a", name: "User A private company" };
  const harness = await mountPage(async (url) => {
    if (url.endsWith("/campaigns/campaign-1")) return json(detail("campaign-1", run));
    if (url.includes("/runs/run-a/candidates")) return json({ items: [candidate], next_cursor: null });
    if (url.includes("/runs/run-a/events")) return json({ items: [], next_sequence: 0, has_more: false });
    if (url.includes("/runs/run-a")) return json({ ...run, shortlist: [candidate] });
    return json(emptyResponse(url));
  }, "/discovery/campaign-1/runs/run-a");
  try {
    await waitFor(() => !!harness.findButton("Copy cited shortlist"));
    await harness.click("Copy cited shortlist");
    assert.match(harness.document.querySelector<HTMLTextAreaElement>('[aria-label="Cited research export"]')?.value ?? "", /User A private company/);

    await harness.switchUser("user-2");

    assert.equal(harness.exportVisibleForUser("user-2"), false);
    assert.equal(harness.document.querySelector('[aria-label="Cited research export"]') === null, true);
  } finally {
    await harness.unmount();
  }
});

test('opening investigated research in Analyze keeps its recorded status out of a shortlisted claim', async () => {
  const campaignId = '11111111-1111-4111-8111-111111111111';
  const runId = '22222222-2222-4222-8222-222222222222';
  const currentRun = { ...runView('completed'), campaign_id: campaignId, run_id: runId };
  const investigated = { ...validResearchCandidate(), state: 'eligible_not_shortlisted' as const, rank: null, can_promote: false };
  const harness = await mountPage(async (url) => {
    if (url.endsWith(`/campaigns/${campaignId}`)) return json(detail(campaignId, currentRun));
    if (url.includes(`/runs/${runId}/candidates`)) return json({ items: [investigated], next_cursor: null });
    if (url.includes(`/runs/${runId}/events`)) return json({ items: [], next_sequence: 0, has_more: false });
    if (url.includes(`/runs/${runId}`)) return json({ ...currentRun, shortlist: [investigated] });
    return json(emptyResponse(url));
  }, `/discovery/${campaignId}/runs/${runId}`);
  try {
    await waitFor(() => !!harness.findButton('Investigated (1)'));
    await harness.click('Investigated (1)');
    await harness.click('Open in Analyze');
    await waitFor(() => harness.route() === '/analyze');
    const summary = (harness.locationState() as { researchSummary?: { summary?: string } } | null)?.researchSummary?.summary ?? '';
    assert.match(summary, /was investigated in discovery research/i);
    assert.doesNotMatch(summary, /shortlisted/i);
  } finally {
    await harness.unmount();
  }
});

test('drafting a research thesis uses a fresh authorized listing and navigates with exact discovery provenance', async () => {
  const campaignId = '11111111-1111-4111-8111-111111111111';
  const runId = '22222222-2222-4222-8222-222222222222';
  const currentRun = { ...runView('completed'), campaign_id: campaignId, run_id: runId };
  const visible = validResearchCandidate();
  const methods: string[] = [];
  const harness = await mountPage(async (url, init) => {
    methods.push(init?.method ?? 'GET');
    if (url.includes(`/campaigns/${campaignId}`) && !url.endsWith('/runs')) return json(detail(campaignId, currentRun));
    if (url.includes(`/runs/${runId}/candidates`)) return json({ items: [visible], next_cursor: null });
    if (url.includes(`/runs/${runId}/events`)) return json({ items: [], next_sequence: 0, has_more: false });
    if (url.includes(`/runs/${runId}`)) return json({ ...currentRun, shortlist: [visible] });
    return json(emptyResponse(url));
  }, `/discovery/${campaignId}/runs/${runId}`);
  try {
    await waitFor(() => !!harness.findButton('Draft thesis for Agents'));
    await harness.click('Draft thesis for Agents');
    await waitFor(() => harness.route() === '/agents');
    assert.deepEqual(harness.locationState(), {
      researchHandoff: {
        kind: 'discovery',
        campaignId,
        runId,
        candidateId: visible.candidate_id,
        subjectRef: { kind: 'listing', id: visible.identity!.listing_id },
        name: 'Research candidate research monitor',
        thesis: 'Research candidate was shortlisted in discovery research. Cited sources: Company filing. Valuation context: unknown.',
        conditions: [],
        trimmedConditions: 0,
      },
    });
    assert.equal(methods.some((method) => method !== 'GET'), false);
  } finally {
    await harness.unmount();
  }
});

test('opening discovery research in Analyze uses the fresh canonical listing and bounded summary', async () => {
  const campaignId = '11111111-1111-4111-8111-111111111111';
  const runId = '22222222-2222-4222-8222-222222222222';
  const currentRun = { ...runView('completed'), campaign_id: campaignId, run_id: runId };
  const visible = validResearchCandidate();
  const harness = await mountPage(async (url) => {
    if (url.includes(`/campaigns/${campaignId}`) && !url.endsWith('/runs')) return json(detail(campaignId, currentRun));
    if (url.includes(`/runs/${runId}/candidates`)) return json({ items: [visible], next_cursor: null });
    if (url.includes(`/runs/${runId}/events`)) return json({ items: [], next_sequence: 0, has_more: false });
    if (url.includes(`/runs/${runId}`)) return json({ ...currentRun, shortlist: [visible] });
    return json(emptyResponse(url));
  }, `/discovery/${campaignId}/runs/${runId}`);
  try {
    await waitFor(() => !!harness.findButton('Open in Analyze'));
    await harness.click('Open in Analyze');
    await waitFor(() => harness.route() === '/analyze');
    assert.deepEqual(harness.locationState(), {
      subject: {
        subject_ref: { kind: 'listing', id: visible.identity!.listing_id },
        display_name: 'Research candidate',
        confidence: 1,
        display_labels: { primary: 'Research candidate' },
      },
      researchSummary: {
        campaignId,
        runId,
        candidateId: visible.candidate_id,
        subjectRef: { kind: 'listing', id: visible.identity!.listing_id },
        summary: 'Research candidate was shortlisted in discovery research. Cited sources: Company filing. Valuation context: unknown.',
      },
    });
  } finally {
    await harness.unmount();
  }
});

test('loads another recorded trail page from the returned event cursor', async () => {
  const first = { ...campaignEvent('First recorded event'), sequence: 1 };
  const second = { ...campaignEvent('Second recorded event'), sequence: 2 };
  const requested: string[] = [];
  const harness = await mountPage(async (url) => {
    if (url.includes('/campaigns/campaign-1') && !url.endsWith('/runs')) return json(detail('campaign-1', runRecord('completed')));
    if (url.includes('/runs/run-1/candidates')) return json({ items: [], next_cursor: null });
    if (url.includes('/runs/run-1/events')) {
      requested.push(url);
      return url.endsWith('after=0')
        ? json({ items: [first], next_sequence: 1, has_more: true })
        : json({ items: [second], next_sequence: 2, has_more: false });
    }
    if (url.includes('/runs/run-1')) return json(runView('completed'));
    return json(emptyResponse(url));
  });
  try {
    await waitFor(() => !!harness.findButton('Load more recorded activity'));
    await harness.click('Load more recorded activity');
    await waitFor(() => harness.document.body.textContent?.includes('Second recorded event') ?? false);
    assert.equal(requested.some((url) => url.endsWith('after=1')), true);
  } finally {
    await harness.unmount();
  }
});

async function mountPage(route: (url: string, init?: RequestInit) => Promise<Response>, initialPath = "/discovery/campaign-1") {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
  const restore = installDomGlobals(dom.window as unknown as Window);
  const oldFetch = globalThis.fetch;
  const startBodies: Array<{ brief_version: number; brief_hash: string; request_key: string }> = [];
  (globalThis as { fetch: typeof fetch }).fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/runs") && init?.method === "POST") startBodies.push(JSON.parse(String(init.body)));
    return route(url, init);
  };
  const root = createRoot(dom.window.document.getElementById("root")!);
  let navigate: ((path: string) => void) | null = null;
  let setUserId: ((userId: string) => void) | null = null;
  let lastLocationState: unknown = null;
  const exportVisibilityByUser = new Map<string, boolean>();
  function ExportVisibilityProbe() {
    const session = useContext(AuthContext)?.session ?? null;
    useLayoutEffect(() => {
      if (session) exportVisibilityByUser.set(session.userId, dom.window.document.querySelector('[aria-label="Cited research export"]') !== null);
    }, [session]);
    return null;
  }
  function AuthHarness({ children }: { children: React.ReactNode }) {
    const [userId, updateUserId] = useState("user-1");
    setUserId = updateUserId;
    return <AuthContext.Provider value={{ session: { userId, displayName: "User" }, signIn: () => undefined, signOut: () => undefined }}>{children}</AuthContext.Provider>;
  }
  function RoutedPage() {
    navigate = useNavigate();
    const location = useLocation();
    lastLocationState = location.state;
    return <><p aria-label="Current route">{location.pathname}</p><CampaignPage /><ExportVisibilityProbe /></>;
  }
  function Destination() { const location = useLocation(); lastLocationState = location.state; return <p aria-label="Current route">{location.pathname}</p>; }
  await act(async () => {
    root.render(<AuthHarness><MemoryRouter initialEntries={[initialPath]}><Routes><Route path="/discovery/:campaignId" element={<RoutedPage />} /><Route path="/discovery/:campaignId/runs/:runId" element={<RoutedPage />} /><Route path="/agents" element={<Destination />} /><Route path="/analyze" element={<Destination />} /></Routes></MemoryRouter></AuthHarness>);
  });
  await act(async () => { await delay(10); });
  return {
    document: dom.window.document,
    window: dom.window,
    startBodies,
    findButton(label: string) { return [...dom.window.document.querySelectorAll("button")].find((element) => element.textContent?.trim() === label) ?? null; },
    button(label: string) { const button = this.findButton(label); assert.ok(button, `missing button ${label}`); return button; },
    async click(label: string) { const button = this.button(label); await act(async () => button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))); await act(async () => { await delay(5); }); },
    async navigate(path: string) { assert.ok(navigate, "navigation control is ready"); await act(async () => { navigate!(path); }); await act(async () => { await delay(10); }); },
    async switchUser(userId: string) { assert.ok(setUserId, "auth control is ready"); await act(async () => { setUserId!(userId); }); },
    exportVisibleForUser(userId: string) { return exportVisibilityByUser.get(userId) ?? false; },
    route() { return dom.window.document.querySelector('[aria-label="Current route"]')?.textContent; },
    locationState() { return lastLocationState; },
    async unmount() { await act(async () => root.unmount()); (globalThis as { fetch: typeof fetch }).fetch = oldFetch; restore(); },
  };
}

function saved(): SavedBrief { return { brief_id: "brief-1", campaign_id: "campaign-1", version: 1, hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", approved_at: null, created_at: "2026-09-10T00:00:00.000Z", brief: { schema_version: 1, question: "Which US-listed companies benefit from grid modernization spending?", market: "us_listed", horizon_months: 24, lookback_months: 12, mechanisms: [{ mechanism_id: "m-1", label: "Demand", chain: ["Catalyst", "Demand"] }, { mechanism_id: "m-2", label: "Benefit", chain: ["Demand", "Revenue"] }], criteria: [{ criterion_id: "c-1", importance: "must", statement: "Company has direct theme exposure", falsifier: "No direct exposure evidence" }], seed_queries: ["grid equipment suppliers"], exclusions: [], preferences: [], queries: [{ mechanism_id: "m-1", query: "grid equipment suppliers" }] } }; }
function detail(campaignId = "campaign-1", latestRun: RunRecord | null = null): CampaignDetail { return { campaign: { campaign_id: campaignId, user_id: "user-1", name: `Grid research ${campaignId}`, question: saved().brief.question, current_brief_version: 1, created_at: "2026-09-10T00:00:00.000Z", updated_at: "2026-09-10T00:00:00.000Z", archived_at: null }, brief: { ...saved(), campaign_id: campaignId }, latest_run: latestRun, readiness: { ready: true, missing: [] } }; }
function runRecord(status: RunRecord["status"]): RunRecord { return { run_id: "run-1", campaign_id: "campaign-1", brief_id: "brief-1", user_id: "user-1", status, stage: "queued", policy_version: "v1", request_key: "request-1", model_config: [], limits: { candidates: 100, research: 25, shortlist: 10, attempts: { search: 80, document: 150, identity: 120, financial: 50, model: 64 }, input_chars: 64000, output_tokens: 10000, request_timeout_ms: 30000, run_timeout_ms: 2700000 }, usage: { search: 0, document: 0, identity: 0, financial: 0, model: 0 }, coverage: { searches_planned: 0, searches_completed: 0, hits_truncated: 0, leads_overflow: 0, extraction_batches_skipped: 0, unresolved: 0, discovered: 0, selected: 0, assessed: 0, not_selected: 0, mechanisms: [], gaps: [] }, started_at: null, finished_at: null, cancel_requested_at: null }; }
function emptyResponse(url: string): unknown { if (url.includes("/candidates")) return { items: [], next_cursor: null }; if (url.includes("/events")) return { items: [], next_sequence: 0, has_more: false }; if (url.includes("/runs/")) return runView(); if (url.endsWith("/runs")) return { items: [], next_cursor: null }; return {}; }
function runView(status: RunRecord["status"] = "completed", shortlist: CandidateView[] = []): RunView { return { ...runRecord(status), shortlist, cost: { status: "unavailable" }, worker_waiting: false }; }
function candidate(id: string, name: string, state: CandidateView["state"], assessment: CandidateView["assessment"] = null): CandidateView { return { candidate_id: id, identity: null, name, state, rank: state === "shortlisted" ? 1 : null, snapshot_id: null, evidence_available: true, can_promote: false, assessment, sources: [], origins: ["web"], mechanism_ids: [], reason_codes: [] }; }
function researchCandidate(): CandidateView { const assessed = decision(); return { ...candidate("candidate-1", "Research candidate", "shortlisted", assessed), identity: assessed.identity, can_promote: true, sources: [{ citation: { kind: "claim", id: "claim-1" }, title: "Company filing", url: "https://example.com/filing", published_at: "2026-09-01T00:00:00.000Z", retrieved_at: "2026-09-10T00:00:00.000Z" }] }; }
function validResearchCandidate(): CandidateView { const candidateId = '33333333-3333-4333-8333-333333333333'; const identity = { issuer_id: '44444444-4444-4444-8444-444444444444', listing_id: '55555555-5555-4555-8555-555555555555', legal_name: 'Research candidate', ticker: 'GRID', mic: 'XNAS', currency: 'USD', asset_type: 'common_stock' as const, identity_source_ids: [] }; const assessment = { ...decision(), candidate_id: candidateId, identity }; return { ...researchCandidate(), candidate_id: candidateId, identity, assessment }; }
function decision(): NonNullable<CandidateView["assessment"]> { const identity = { issuer_id: "issuer-1", listing_id: "listing-1", legal_name: "Investigated company", ticker: "GRID", mic: "XNAS", currency: "USD", asset_type: "common_stock" as const, identity_source_ids: [] }; const dimension = { level: "unknown" as const, explanation: "Unknown", citations: [] }; return { candidate_id: "investigated", identity, state: "eligible_not_shortlisted", dimensions: { theme_exposure: dimension, evidence_strength: dimension, business_quality: dimension, valuation_context: dimension }, criteria: [], counterarguments: [], unresolved_questions: [], next_action: "Continue", reason_codes: [] }; }
function campaignEvent(summary: string): CampaignEvent { return { run_id: "run-1", sequence: 1, stage: "research", kind: "criterion_assessed", candidate_id: null, summary, citations: [], created_at: "2026-09-10T00:00:00.000Z" }; }
function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>((next) => { resolve = next; }), resolve }; }
function installClipboard(writeText: (text: string) => Promise<void>): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText } } });
  return () => { if (original) Object.defineProperty(globalThis, 'navigator', original); else delete (globalThis as { navigator?: Navigator }).navigator; };
}
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
async function waitFor(predicate: () => boolean, timeoutMs = 2_500): Promise<void> { const started = Date.now(); while (!predicate()) { if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for page update."); await act(async () => { await delay(25); }); } }
function installDomGlobals(domWindow: Window): () => void { const globals = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean; document?: Document; window?: Window }; const prior = { act: globals.IS_REACT_ACT_ENVIRONMENT, document: globals.document, window: globals.window }; globals.IS_REACT_ACT_ENVIRONMENT = true; globals.document = domWindow.document; globals.window = domWindow; return () => { globals.IS_REACT_ACT_ENVIRONMENT = prior.act; globals.document = prior.document; globals.window = prior.window; }; }
