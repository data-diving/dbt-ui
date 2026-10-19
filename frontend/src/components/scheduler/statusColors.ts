// Status colors shared by the scheduler tables and the runs graph

export const STATUS_COLORS: Record<string, string> = {
  success: '#89d185',
  pass: '#89d185',
  warn: '#cca700',
  scheduled: '#b3b3b3',
  running: '#3794ff',
  queued: '#858585',
  failed: '#f48771',
  error: '#f48771',
  fail: '#f48771',
  'runtime error': '#f48771',
  cancelled: '#c586c0',
  interrupted: '#d18616',
  skipped: '#cca700',
}

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? '#858585'
}
