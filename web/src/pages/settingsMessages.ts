export type TestChannelResponse =
  | { ok: true; reply: string; deployment?: unknown }
  | { ok: false; error_code: string; message: string; attempts?: unknown[] }

export function testMessage(body: TestChannelResponse): string {
  return body.ok ? `Test passed: ${body.reply}` : diagnosticMessage(body)
}

export function diagnosticMessage(body: { error_code?: string; message?: string }): string {
  if (body.error_code && body.message) return `${body.error_code}: ${body.message}`
  return body.message ?? body.error_code ?? 'request failed'
}
