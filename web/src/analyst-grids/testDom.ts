// Installs a JSDOM window's document/window as globals for React act() testing,
// returning a restore fn. Shared across the analyst-grids frontend tests.
export function installDomGlobals(domWindow: Window): () => void {
  const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean; document?: Document; window?: Window };
  const prev = { act: g.IS_REACT_ACT_ENVIRONMENT, doc: g.document, win: g.window };
  g.IS_REACT_ACT_ENVIRONMENT = true;
  g.document = domWindow.document;
  g.window = domWindow;
  return () => {
    g.IS_REACT_ACT_ENVIRONMENT = prev.act;
    g.document = prev.doc;
    g.window = prev.win;
  };
}
