// A time shown relative to now ("5 minutes ago", "in 2 hours"), with the exact UTC time as tooltip

import { formatRelative, formatUtc } from './api'

interface RelativeTimeProps {
  value: string | null | undefined
  // Reference time; the server's clock where available, so a skewed local clock doesn't matter
  nowMs?: number
  className?: string
}

function RelativeTime({ value, nowMs, className }: RelativeTimeProps) {
  if (!value) return <span className="muted">—</span>
  return (
    <span className={className} title={`${formatUtc(value, true)} UTC`}>
      {formatRelative(value, nowMs ?? Date.now())}
    </span>
  )
}

export default RelativeTime
