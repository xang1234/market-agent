// In-memory page state that survives route changes (the page unmounts on
// navigation; module state does not). Deliberately not sessionStorage: a
// reload starting fresh is fine, losing your grid by clicking Home is not.

export type GridBuilderFields = {
  source: string;
  manual: string;
  refId: string;
  question: string;
};

export type GridsPageMemory = {
  runId: string | null;
  activeColumnKeys: string[];
  builder: GridBuilderFields;
};

export const gridsPageMemory: GridsPageMemory = {
  runId: null,
  activeColumnKeys: [],
  builder: { source: "manual", manual: "", refId: "", question: "" },
};
