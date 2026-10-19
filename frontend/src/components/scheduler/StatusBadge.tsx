// Colored status pill used in the scheduler tables

import { statusColor } from './statusColors'

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="status-badge" style={{ color: statusColor(status), borderColor: statusColor(status) }}>
      {status}
    </span>
  )
}

export default StatusBadge
