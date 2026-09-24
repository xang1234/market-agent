export function attemptSignal(parent: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)]);
}

export function storedError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message.slice(0, 2_000) };
  }
  return { name: "Error", message: String(error).slice(0, 2_000) };
}

export function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Discovery operation aborted", "AbortError");
}
