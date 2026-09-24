// A persisted or derived execution fact contradicts another: a binding that
// does not match its hash or plan, a unit closure that differs from its
// declaration, a re-execution that diverges from its checkpoint. The run
// fails as integrity_failure; nothing is overwritten.
export class ExecutionIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionIntegrityError";
  }
}
