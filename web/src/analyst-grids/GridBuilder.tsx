import { useState, type ReactElement, type FormEvent } from "react";
import type { GridColumn, ColumnSpecInput } from "./gridsTypes.ts";
import type { UniverseOptions } from "./universeOptions.ts";
import { PRIMARY_BUTTON_CLASS } from "../shell/buttonStyles.ts";
import { FIELD_CLASS, FIELD_LABEL_CLASS, PAGE_PANEL_CLASS, TOGGLE_CHIP_CLASS } from "../ui/pageStyles.ts";

export type GridBuilderSubmit = { universe_spec: unknown; column_specs: ColumnSpecInput[] };

const ID_SOURCES = ["screen", "watchlist", "portfolio", "peers"] as const;
type IdSource = (typeof ID_SOURCES)[number];
const SOURCE_LABELS: Readonly<Record<IdSource, string>> = {
  screen: "Saved screen",
  watchlist: "Watchlist",
  portfolio: "Portfolio",
  peers: "Peers of a company",
};

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
  const pickableColumns = columns.filter((c) => c.kind !== "reader");

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
    <form data-testid="grid-builder" onSubmit={handleSubmit} className={`flex flex-col gap-5 ${PAGE_PANEL_CLASS}`}>
      <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
        <label className={FIELD_LABEL_CLASS}>
          Universe source
          <select
            className={FIELD_CLASS}
            value={source}
            onChange={(e) => setSource(e.target.value as "manual" | IdSource)}
            data-testid="grid-builder-source"
          >
            <option value="manual">Manual tickers</option>
            {ID_SOURCES.map((s) => (
              <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
            ))}
          </select>
        </label>

        {source === "manual" ? (
          <label className={FIELD_LABEL_CLASS}>
            Tickers or issuer ids
            <textarea
              name="manual"
              rows={2}
              defaultValue={defaults?.manual}
              data-testid="grid-builder-manual-input"
              className={FIELD_CLASS}
              placeholder="comma- or newline-separated tickers (e.g. AAPL, MSFT) or issuer ids"
            />
          </label>
        ) : source === "peers" ? (
          <label className={FIELD_LABEL_CLASS}>
            Company
            <input
              name="refId"
              required
              defaultValue={defaults?.refId}
              data-testid="grid-builder-ref-input"
              className={FIELD_CLASS}
              placeholder="ticker or issuer id"
            />
          </label>
        ) : (
          <label className={FIELD_LABEL_CLASS}>
            {SOURCE_LABELS[source]}
            <select
              name="refId"
              required
              defaultValue={defaults?.refId ?? ""}
              data-testid="grid-builder-ref-select"
              className={FIELD_CLASS}
            >
              <option value="" disabled>
                Select a {SOURCE_LABELS[source].toLowerCase()}…
              </option>
              {universeOptions[source].map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            {universeOptions[source].length === 0 ? (
              <span className="text-xs font-normal text-muted">You have no {SOURCE_LABELS[source].toLowerCase()}s yet.</span>
            ) : null}
          </label>
        )}
      </div>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-fg">Columns</legend>
        {pickableColumns.length === 0 ? (
          <p className="text-sm text-muted">No columns are available yet. Ask a question below instead.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {pickableColumns.map((col) => (
              <label key={col.column_key} className={TOGGLE_CHIP_CLASS}>
                <input
                  type="checkbox"
                  name="column"
                  value={col.column_key}
                  className="sr-only"
                  data-testid={`grid-builder-col-${col.column_key}`}
                />
                {col.label}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <label className={FIELD_LABEL_CLASS}>
        <span>
          Question column{" "}
          <span className="font-normal text-muted">(optional — asked per company, answered from documents)</span>
        </span>
        <textarea
          name="question"
          rows={2}
          defaultValue={defaults?.question}
          data-testid="grid-builder-question-input"
          className={FIELD_CLASS}
          placeholder='e.g. "Any China exposure flagged in risk factors?"'
          maxLength={300}
        />
      </label>

      <div className="flex justify-end border-t border-line pt-4">
        <button type="submit" data-testid="grid-builder-submit" className={PRIMARY_BUTTON_CLASS}>
          Create &amp; Run
        </button>
      </div>
    </form>
  );
}
