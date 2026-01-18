// MetaDV utility functions

import { SourceColumn } from './types'

export const getColumnKey = (col: SourceColumn): string => {
  return `${col.source}.${col.column}`
}

export const getSourceFromColumnKey = (colKey: string): string => {
  const parts = colKey.split('.')
  if (parts.length >= 1) {
    return parts[0]
  }
  return colKey
}

export const getColumnNameFromColumnKey = (colKey: string): string => {
  const parts = colKey.split('.')
  if (parts.length >= 2) {
    return parts.slice(1).join('.')  // Handle column names that might contain dots
  }
  return colKey
}
