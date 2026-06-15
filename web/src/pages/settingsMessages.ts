export type TestChannelResponse =
  | { ok: true; reply: string; deployment?: unknown }
  | { ok: false; error_code: string; message: string; attempts?: unknown[] }

export function testMessage(body: TestChannelResponse): string {
  if (!body.ok) return diagnosticMessage(body)
  // Success now means the call completed; the reply is informative when present
  // but may be empty (e.g. a reasoning model truncated before emitting text), so
  // avoid rendering a bare "Test passed: " tail.
  return body.reply.trim() ? `Test passed: ${body.reply}` : 'Test passed'
}

export function diagnosticMessage(body: { error_code?: string; message?: string }): string {
  if (body.error_code && body.message) return `${body.error_code}: ${body.message}`
  return body.message ?? body.error_code ?? 'request failed'
}
