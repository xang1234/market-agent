import { useEffect, useRef, useState } from "react";

import type { Brief, Criterion, Mechanism, SavedBrief } from "../../../services/discovery/src/types.ts";
import { HttpJsonError } from "../http/authFetch.ts";

export type BriefSave = { expectedVersion: number; brief: Brief };
export type BriefDraft = { expectedVersion: number };
export type BriefProposal = { brief: Brief; base_version: number };

export function BriefEditor({
  campaignId,
  savedBrief,
  fallbackQuestion,
  onSave,
  onDraft,
  draftDisabledReason,
  onApprove,
}: {
  campaignId: string;
  savedBrief: SavedBrief | null;
  fallbackQuestion?: string;
  onSave(body: BriefSave): Promise<SavedBrief>;
  onDraft?(body: BriefDraft): Promise<BriefProposal>;
  draftDisabledReason?: string;
  onApprove?(saved: SavedBrief): Promise<void>;
}) {
  const initial = savedBrief ?? { brief: defaultBrief(fallbackQuestion ?? "Which US-listed companies could benefit from this theme?"), version: 0, hash: "" };
  const [draft, setDraft] = useState<Brief>(initial.brief);
  const [base, setBase] = useState<SavedBrief | null>(savedBrief);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [approving, setApproving] = useState(false);
  const initialLoadDone = useRef(savedBrief !== null);
  const changedBeforeLoad = useRef(false);
  const draftingRef = useRef(false);
  const draftRevision = useRef(0);

  // A first fetched saved brief may initialize an untouched editor. Every
  // later server refresh deliberately leaves the local draft and base alone.
  useEffect(() => {
    if (!initialLoadDone.current && savedBrief !== null && !changedBeforeLoad.current) {
      initialLoadDone.current = true;
      setDraft(savedBrief.brief);
      setBase(savedBrief);
    }
  }, [savedBrief]);

  const isDirty = base === null || JSON.stringify(draft) !== JSON.stringify(base.brief);
  const update = (next: Brief) => { changedBeforeLoad.current = true; draftRevision.current += 1; setDraft(next); };

  async function generate(): Promise<void> {
    if (!onDraft || draftingRef.current) return;
    const expectedVersion = base?.version ?? 0;
    const revision = draftRevision.current;
    draftingRef.current = true;
    setDrafting(true);
    setError(null);
    try {
      const proposal = await onDraft({ expectedVersion });
      if (proposal.base_version !== expectedVersion) {
        setError("A newer saved brief is available. Your edits are still here; load it only when you are ready.");
      } else if (draftRevision.current === revision) {
        changedBeforeLoad.current = true;
        setDraft(proposal.brief);
      }
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) setError(messageForDraft(caught));
    } finally {
      draftingRef.current = false;
      setDrafting(false);
    }
  }

  async function save(): Promise<SavedBrief | null> {
    if (saving) return null;
    setSaving(true);
    setError(null);
    try {
      const next = await onSave({ expectedVersion: base?.version ?? 0, brief: draft });
      setBase(next);
      setDraft(next.brief);
      return next;
    } catch (caught) {
      setError(messageForSave(caught));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function approve() {
    if (!onApprove || approving) return;
    setApproving(true);
    setError(null);
    try {
      const approved = isDirty ? await save() : base;
      if (approved) await onApprove(approved);
    } catch {
      setError("Research could not start. Your brief is still available to retry.");
    } finally {
      setApproving(false);
    }
  }

  function loadSaved() {
    if (savedBrief === null) return;
    draftRevision.current += 1;
    setDraft(savedBrief.brief);
    setBase(savedBrief);
    setError(null);
    initialLoadDone.current = true;
  }

  return (
    <section aria-labelledby="research-brief-heading" className="space-y-4 rounded-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="research-brief-heading" className="text-base font-semibold text-fg">Research brief</h2>
          <p className="text-sm text-muted">Shape what the research should look for before it begins.</p>
        </div>
        {savedBrief && (base?.version !== savedBrief.version || isDirty) ? <button type="button" onClick={loadSaved} className="rounded-md border border-line px-3 py-1.5 text-sm text-fg hover:bg-surface-2">Load saved brief</button> : null}
      </div>
      <label className="grid gap-1 text-sm text-fg">
        Question
        <textarea aria-label="Question" value={draft.question} onInput={(event) => update({ ...draft, question: event.currentTarget.value })} rows={3} className="rounded-md border border-line bg-surface-2 px-3 py-2" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField label="Horizon (months)" value={draft.horizon_months} onChange={(value) => update({ ...draft, horizon_months: value })} />
        <NumberField label="Lookback (months)" value={draft.lookback_months} onChange={(value) => update({ ...draft, lookback_months: value })} />
      </div>
      <Mechanisms value={draft.mechanisms} onChange={(mechanisms) => update({ ...draft, mechanisms, queries: queriesFor(mechanisms, draft.seed_queries) })} />
      <Criteria value={draft.criteria} onChange={(criteria) => update({ ...draft, criteria })} />
      <label className="grid gap-1 text-sm text-fg">
        Seed queries
        <textarea aria-label="Seed queries" value={draft.seed_queries.join("\n")} onInput={(event) => { const seedQueries = lines(event.currentTarget.value); update({ ...draft, seed_queries: seedQueries, queries: queriesFor(draft.mechanisms, seedQueries) }); }} rows={3} className="rounded-md border border-line bg-surface-2 px-3 py-2" />
        <span className="text-xs text-muted">One useful starting query per line.</span>
      </label>
      <TextLines label="Exclusions" value={draft.exclusions} onChange={(exclusions) => update({ ...draft, exclusions })} />
      <TextLines label="Preferences" value={draft.preferences} onChange={(preferences) => update({ ...draft, preferences })} />
      {draftDisabledReason ? <p className="text-sm text-muted">{draftDisabledReason}</p> : null}
      {error ? <p role="alert" className="text-sm text-negative">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {onDraft ? <button type="button" onClick={() => { void generate(); }} disabled={drafting} className="rounded-md border border-line-strong px-3 py-2 text-sm font-medium text-fg disabled:opacity-60">{drafting ? "Generating research brief…" : "Generate research brief"}</button> : null}
        <button type="button" onClick={() => { void save(); }} disabled={saving || drafting} className="rounded-md border border-line-strong px-3 py-2 text-sm font-medium text-fg disabled:opacity-60">{saving ? "Saving brief…" : "Save research brief"}</button>
        {onApprove ? <button type="button" onClick={() => { void approve(); }} disabled={saving || drafting || approving} className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{approving ? "Starting research…" : "Approve brief and start"}</button> : null}
      </div>
      <input type="hidden" value={campaignId} aria-label="Campaign" readOnly />
    </section>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange(value: number): void }) {
  return <label className="grid gap-1 text-sm text-fg">{label}<input aria-label={label} type="number" min={1} value={value} onInput={(event) => onChange(Number(event.currentTarget.value))} className="rounded-md border border-line bg-surface-2 px-3 py-2" /></label>;
}

function Mechanisms({ value, onChange }: { value: Mechanism[]; onChange(value: Mechanism[]): void }) {
  return <fieldset className="space-y-2"><legend className="text-sm font-medium text-fg">Why this theme could matter</legend>{value.map((mechanism, index) => <div key={mechanism.mechanism_id} className="grid gap-2 rounded-md border border-line p-3"><label className="grid gap-1 text-sm">Mechanism {index + 1} label<input aria-label={`Mechanism ${index + 1} label`} value={mechanism.label} onInput={(event) => onChange(replace(value, index, { ...mechanism, label: event.currentTarget.value }))} className="rounded-md border border-line bg-surface-2 px-3 py-2" /></label><label className="grid gap-1 text-sm">Mechanism {index + 1} chain<textarea aria-label={`Mechanism ${index + 1} chain`} value={mechanism.chain.join("\n")} onInput={(event) => onChange(replace(value, index, { ...mechanism, chain: lines(event.currentTarget.value) }))} rows={2} className="rounded-md border border-line bg-surface-2 px-3 py-2" /></label>{value.length > 2 ? <button type="button" aria-label={`Remove mechanism ${index + 1}`} onClick={() => onChange(value.filter((_, item) => item !== index))} className="w-fit text-sm text-muted underline">Remove</button> : null}</div>)}{value.length < 4 ? <button type="button" onClick={() => onChange([...value, { mechanism_id: newId(), label: "New mechanism", chain: ["Catalyst", "Company demand"] }])} className="text-sm text-accent underline">Add mechanism</button> : null}</fieldset>;
}

function Criteria({ value, onChange }: { value: Criterion[]; onChange(value: Criterion[]): void }) {
  return <fieldset className="space-y-2"><legend className="text-sm font-medium text-fg">What a company must show</legend>{value.map((criterion, index) => <div key={criterion.criterion_id} className="grid gap-2 rounded-md border border-line p-3"><label className="grid gap-1 text-sm">Priority<select aria-label={`Criterion ${index + 1} priority`} value={criterion.importance} onChange={(event) => onChange(replace(value, index, { ...criterion, importance: event.target.value as Criterion["importance"] }))} className="rounded-md border border-line bg-surface-2 px-3 py-2"><option value="must">Must have</option><option value="prefer">Preferred</option></select></label><label className="grid gap-1 text-sm">Criterion {index + 1}<textarea aria-label={`Criterion ${index + 1}`} value={criterion.statement} onInput={(event) => onChange(replace(value, index, { ...criterion, statement: event.currentTarget.value }))} rows={2} className="rounded-md border border-line bg-surface-2 px-3 py-2" /></label><label className="grid gap-1 text-sm">What would disprove it<textarea aria-label={`Criterion ${index + 1} falsifier`} value={criterion.falsifier} onInput={(event) => onChange(replace(value, index, { ...criterion, falsifier: event.currentTarget.value }))} rows={2} className="rounded-md border border-line bg-surface-2 px-3 py-2" /></label>{value.length > 1 ? <button type="button" aria-label={`Remove criterion ${index + 1}`} onClick={() => onChange(value.filter((_, item) => item !== index))} className="w-fit text-sm text-muted underline">Remove</button> : null}</div>)}{value.length < 8 ? <button type="button" onClick={() => onChange([...value, { criterion_id: newId(), importance: "prefer", statement: "The company has a clear link to the theme", falsifier: "The link is not supported by evidence" }])} className="text-sm text-accent underline">Add criterion</button> : null}</fieldset>;
}

function TextLines({ label, value, onChange }: { label: string; value: string[]; onChange(value: string[]): void }) { return <label className="grid gap-1 text-sm text-fg">{label}<textarea aria-label={label} value={value.join("\n")} onInput={(event) => onChange(lines(event.currentTarget.value))} rows={2} className="rounded-md border border-line bg-surface-2 px-3 py-2" /></label>; }
function lines(value: string): string[] { return value.split("\n").map((item) => item.trim()).filter(Boolean); }
function replace<T>(items: T[], index: number, value: T): T[] { return items.map((item, itemIndex) => itemIndex === index ? value : item); }
function queriesFor(mechanisms: Mechanism[], seeds: string[]): Brief["queries"] { const values = seeds.length > 0 ? seeds : ["US-listed companies exposed to the theme"]; return values.map((query, index) => ({ mechanism_id: mechanisms[index % mechanisms.length]?.mechanism_id ?? "", query })); }
function newId(): string { return globalThis.crypto?.randomUUID?.() ?? `00000000-0000-4000-8000-${Math.random().toString(16).slice(2).padEnd(12, "0").slice(0, 12)}`; }
function defaultBrief(question: string): Brief { const mechanisms: Mechanism[] = [{ mechanism_id: newId(), label: "Demand driver", chain: ["Catalyst", "Demand growth"] }, { mechanism_id: newId(), label: "Company benefit", chain: ["Demand growth", "Revenue opportunity"] }]; return { schema_version: 1, question, market: "us_listed", horizon_months: 24, lookback_months: 12, mechanisms, criteria: [{ criterion_id: newId(), importance: "must", statement: "The company has a direct and durable connection to the theme", falsifier: "The company lacks a supported connection to the theme" }], seed_queries: ["US-listed companies exposed to the theme"], exclusions: [], preferences: [], queries: queriesFor(mechanisms, ["US-listed companies exposed to the theme"]) }; }
function messageForSave(error: unknown): string { const message = error instanceof Error ? error.message : ""; return message.includes("newer") || message.includes("stale") ? "A newer saved brief is available. Your edits are still here; load it only when you are ready." : "The brief could not be saved. Your edits are still here."; }
function messageForDraft(error: unknown): string {
  const code = error instanceof HttpJsonError && error.body !== null && typeof error.body === "object" && typeof (error.body as { code?: unknown }).code === "string"
    ? (error.body as { code: string }).code
    : "";
  if (code === "stale_brief") return "A newer saved brief is available. Your edits are still here; load it only when you are ready.";
  if (code === "draft_rate_limit") return "You have reached the research-brief generation limit. Wait a little, then try again.";
  if (code === "unavailable") return "Research-brief generation is unavailable right now. Keep editing or try again later.";
  return "The research brief could not be generated. Your edits are still here; try again.";
}
