import { useState, type ReactElement, type FormEvent } from "react";
import type { GridColumn, ColumnSpecInput } from "./gridsTypes.ts";
import type { UniverseOptions } from "./universeOptions.ts";

export type GridBuilderSubmit = { universe_spec: unknown; column_specs: ColumnSpecInput[] };

const ID_SOURCES = ["screen", "watchlist", "portfolio", "peers"] as const;
type IdSource = (typeof ID_SOURCES)[number];

function manualSpec(raw: string) {
  const ids = raw.split(/[,\n]/).map((s) => s.trim()).filter((s) => s.length > 0);
  return { source: "manual" as const, subject_refs: ids.map((id) => ({ kind: "issuer" as const, id })) };
}

function idSpec(source: IdSource, id: string): unknown {
  switch (source) {
    case "screen": return { source, screen_id: id };
    case "watchlist": return { source, watchlist_id: id };
    case "portfolio": return { source, portfolio_id: id };
    case "peers": return { source, issuer_id: id };
  }
}

type GridBuilderProps = {
  columns: ReadonlyArray<GridColumn>;
  universeOptions: UniverseOptions;
  onSubmit: (spec: GridBuilderSubmit) => void;
  // Initial field values + capture hook so the page can restore the form
  // after navigating away (the form itself stays uncontrolled).
  defaults?: { source: string; manual: string; refId: string; question: string };
  onFieldsCapture?: (fields: { source: string; manual: string; refId: string; question: string }) => void;
};

// A pure, uncontrolled form: data fields are read via FormData at submit, so the
// only React state is `source` (it toggles which universe input renders, and the
// uncontrolled input remounts — naturally clearing stale ids on source switch).
export function GridBuilder({ columns, universeOptions, onSubmit, defaults, onFieldsCapture }: GridBuilderProps): ReactElement {
  const initialSource =
    defaults && ["manual", ...ID_SOURCES].includes(defaults.source) ? (defaults.source as "manual" | IdSource) : "manual";
  const [source, setSource] = useState<"manual" | IdSource>(initialSource);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Use the form's own window.FormData so JSDOM tests work (Node's native FormData
    // doesn't accept an HTMLFormElement from a different realm).
    const FormDataCtor = (e.currentTarget.ownerDocument.defaultView as Window & { FormData: typeof FormData }).FormData;
    const fd = new FormDataCtor(e.currentTarget);
    const selectedKeys = new Set(fd.getAll("column").map(String));
    const column_specs: ColumnSpecInput[] = columns.filter((c) => selectedKeys.has(c.column_key)).map((c) => ({ column_key: c.column_key }));
    const question = String(fd.get("question") ?? "").trim();
    onFieldsCapture?.({
      source,
      manual: String(fd.get("manual") ?? ""),
      refId: String(fd.get("refId") ?? ""),
      question: String(fd.get("question") ?? ""),
    });
    if (question.length > 0) {
      column_specs.push({ column_key: "reader_question", params: { prompt: question } });
    }
    if (column_specs.length === 0) return; // a grid needs at least one column
    if (source !== "manual") {
      const refId = String(fd.get("refId") ?? "").trim();
      if (refId.length === 0) return; // an id-source universe needs its id
      onSubmit({ universe_spec: idSpec(source, refId), column_specs });
      return;
    }
    const manual = manualSpec(String(fd.get("manual") ?? ""));
    if (manual.subject_refs.length === 0) return; // a manual universe needs at least one ticker/issuer id
    onSubmit({ universe_spec: manual, column_specs });
  }

  return (
    <form data-testid="grid-builder" onSubmit={handleSubmit} className="space-y-3">
      <label className="block text-sm">
        Universe source
        <select
          className="ml-2 rounded border border-line bg-surface-2 px-2 py-1"
          value={source}
          onChange={(e) => setSource(e.target.value as "manual" | IdSource)}
          data-testid="grid-builder-source"
        >
          <option value="manual">Manual tickers</option>
          {ID_SOURCES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>

      {source === "manual" ? (
        <textarea
          name="manual"
          defaultValue={defaults?.manual}
          data-testid="grid-builder-manual-input"
          className="w-full rounded border border-line bg-surface-2 px-2 py-1"
          placeholder="comma- or newline-separated tickers (e.g. AAPL, MSFT) or issuer ids"
        />
      ) : source === "peers" ? (
        <input
          name="refId"
          required
          defaultValue={defaults?.refId}
          data-testid="grid-builder-ref-input"
          className="w-full rounded border border-line bg-surface-2 px-2 py-1"
          placeholder="ticker or issuer id"
        />
      ) : (
        <>
          <select
            name="refId"
            required
            defaultValue={defaults?.refId ?? ""}
            data-testid="grid-builder-ref-select"
            className="w-full rounded border border-line bg-surface-2 px-2 py-1"
          >
            <option value="" disabled>
              Select a {source}…
            </option>
            {universeOptions[source].map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
          {universeOptions[source].length === 0 ? (
            <p className="text-xs text-muted">You have no {source}s yet.</p>
          ) : null}
        </>
      )}

      <fieldset className="space-y-1">
        <legend className="text-xs uppercase tracking-wide text-muted">Columns</legend>
        {columns.filter((c) => c.kind !== "reader").map((col) => (
          <label key={col.column_key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="column" value={col.column_key} data-testid={`grid-builder-col-${col.column_key}`} />
            {col.label}
          </label>
        ))}
      </fieldset>

      <label className="block text-sm">
        Question column <span className="text-muted">(optional — asked per company, answered from documents)</span>
        <textarea
          name="question"
          defaultValue={defaults?.question}
          data-testid="grid-builder-question-input"
          className="w-full rounded border border-line bg-surface-2 px-2 py-1"
          placeholder='e.g. "Any China exposure flagged in risk factors?"'
          maxLength={300}
        />
      </label>

      <button type="submit" data-testid="grid-builder-submit" className="rounded bg-accent px-3 py-1 text-sm text-bg">
        Create &amp; Run
      </button>
    </form>
  );
}
