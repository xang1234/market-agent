// In-memory page state that survives route changes (the page unmounts on
// navigation; module state does not). Deliberately not sessionStorage: a
// reload starting fresh is fine, losing your grid by clicking Home is not.
//
// Keyed by user id so signing out and back in as a different account never
// restores the previous user's grid/run/builder (cross-account bleed).

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

function emptyMemory(): GridsPageMemory {
  return {
    runId: null,
    activeColumnKeys: [],
    builder: { source: "manual", manual: "", refId: "", question: "" },
  };
}

const memoryByUser = new Map<string, GridsPageMemory>();

// The mutable memory record for a user, created on first access. Callers
// mutate the returned object in place (runId/activeColumnKeys/builder).
export function gridsPageMemoryFor(userId: string): GridsPageMemory {
  let memory = memoryByUser.get(userId);
  if (memory === undefined) {
    memory = emptyMemory();
    memoryByUser.set(userId, memory);
  }
  return memory;
}
