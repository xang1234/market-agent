// When a message was saved: the time alone today, the date too otherwise, and
// the full date and time for its tooltip.
export function messageTime(createdAt: string, now: Date, timeZone?: string): { short: string; full: string } | null {
  const at = new Date(createdAt)
  if (Number.isNaN(at.getTime())) return null
  const day = new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'short' })
  const today = day.format(at) === day.format(now)
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(today ? {} : { month: 'short', day: 'numeric' }),
  }).format(at)
  const full = new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'full', timeStyle: 'short' }).format(at)
  return { short, full }
}
