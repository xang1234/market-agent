import { useState, type ReactElement } from "react";
import type { GridColumn } from "./gridsTypes.ts";

export type GridBuilderSubmit = { universe_spec: unknown; column_specs: Array<{ column_key: string }> };

const ID_SOURCES = ["screen", "watchlist", "portfolio", "peers"] as const;
type IdSource = (typeof ID_SOURCES)[number];

function manualSpec(raw: string): { source: "manual"; subject_refs: Array<{ kind: "issuer"; id: string }> } {
  const ids = raw.split(/[,\n]/).map((s) => s.trim()).filter((s) => s.length > 0);
  return { source: "manual", subject_refs: ids.map((id) => ({ kind: "issuer", id })) };
}

function idSpec(source: IdSource, id: string): unknown {
  switch (source) {
    case "screen": return { source, screen_id: id };
    case "watchlist": return { source, watchlist_id: id };
    case "portfolio": return { source, portfolio_id: id };
    case "peers": return { source, issuer_id: id };
  }
}

type GridBuilderProps = { columns: ReadonlyArray<GridColumn>; onSubmit: (spec: GridBuilderSubmit) => void };

export function GridBuilder({ columns, onSubmit }: GridBuilderProps): ReactElement {
  const [source, setSource] = useState<"manual" | IdSource>("manual");
  const [refId, setRefId] = useState("");
  const [manual, setManual] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function submit() {
    const universe_spec = source === "manual" ? manualSpec(manual) : idSpec(source, refId.trim());
    const column_specs = columns.filter((c) => selected.has(c.column_key)).map((c) => ({ column_key: c.column_key }));
    onSubmit({ universe_spec, column_specs });
  }

  return (
    <div data-testid="grid-builder" className="space-y-3">
      <label className="block text-sm">
        Universe source
        <select className="ml-2 rounded border border-line bg-surface-2 px-2 py-1" value={source} onChange={(e) => { setSource(e.target.value as "manual" | IdSource); setRefId(""); }} data-testid="grid-builder-source">
          <option value="manual">Manual tickers</option>
          {ID_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      {source === "manual" ? (
        <textarea data-testid="grid-builder-manual-input" className="w-full rounded border border-line bg-surface-2 px-2 py-1" placeholder="comma- or newline-separated issuer ids" value={manual} onChange={(e) => setManual(e.target.value)} />
      ) : (
        <input data-testid="grid-builder-ref-input" className="w-full rounded border border-line bg-surface-2 px-2 py-1" placeholder={`${source} id`} value={refId} onChange={(e) => setRefId(e.target.value)} />
      )}

      <fieldset className="space-y-1">
        <legend className="text-xs uppercase tracking-wide text-muted">Columns</legend>
        {columns.map((col) => (
          <label key={col.column_key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" data-testid={`grid-builder-col-${col.column_key}`} checked={selected.has(col.column_key)} onChange={() => toggle(col.column_key)} />
            {col.label}
          </label>
        ))}
      </fieldset>

      <button data-testid="grid-builder-submit" className="rounded bg-accent px-3 py-1 text-sm text-bg" onClick={submit} disabled={selected.size === 0}>Create &amp; Run</button>
    </div>
  );
}
