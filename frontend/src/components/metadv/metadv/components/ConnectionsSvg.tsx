// Connections SVG component

import React from 'react'
import { HoverHighlight } from '../types'

interface ConnectionLine {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  type: string
  sourceColumn: string
  targetName: string
}

interface ConnectionsSvgProps {
  connectionLines: ConnectionLine[]
  connectionToDelete: string | null
  hoverHighlight: HoverHighlight | null
  onConnectionClick: (id: string) => void
  onConnectionHover: (id: string | null) => void
}

function ConnectionsSvg({
  connectionLines,
  connectionToDelete,
  hoverHighlight,
  onConnectionClick,
  onConnectionHover
}: ConnectionsSvgProps) {
  return (
    <svg className="metadv-connections-svg">
      {connectionLines
        .filter(line => !connectionToDelete || line.id === connectionToDelete)
        .map(line => {
          const isHighlighted = hoverHighlight?.connectedConnectionIds.has(line.id)
          const isDimmed = hoverHighlight && !isHighlighted

          return (
            <g
              key={line.id}
              className={`metadv-connection-group ${connectionToDelete === line.id ? 'selected' : ''} ${isHighlighted ? 'highlighted' : ''} ${isDimmed ? 'dimmed' : ''}`}
              onClick={() => onConnectionClick(connectionToDelete === line.id ? '' : line.id)}
              onMouseEnter={() => onConnectionHover(line.id)}
              onMouseLeave={() => onConnectionHover(null)}
              style={{ cursor: 'pointer' }}
            >
              {/* Invisible wider path for easier clicking */}
              <path
                d={`M ${line.x1} ${line.y1} C ${line.x1 + 50} ${line.y1}, ${line.x2 - 50} ${line.y2}, ${line.x2} ${line.y2}`}
                stroke="transparent"
                strokeWidth="12"
                fill="none"
              />
              <path
                d={`M ${line.x1} ${line.y1} C ${line.x1 + 50} ${line.y1}, ${line.x2 - 50} ${line.y2}, ${line.x2} ${line.y2}`}
                stroke={connectionToDelete === line.id ? '#f48771' : line.color}
                strokeWidth={connectionToDelete === line.id ? 3 : isHighlighted ? 3 : 2}
                fill="none"
                className="metadv-connection-line"
                style={{
                  filter: isHighlighted ? `drop-shadow(0 0 4px ${line.color})` : undefined,
                  opacity: isDimmed ? 0.2 : 1
                }}
              />
            </g>
          )
        })}
    </svg>
  )
}

export default ConnectionsSvg
