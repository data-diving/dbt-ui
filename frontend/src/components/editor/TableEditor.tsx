import { useState, useEffect } from 'react'
import DataTable from './DataTable'

interface TableEditorProps {
  content: string
}

function TableEditor({ content }: TableEditorProps) {
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, any>[]>([])

  useEffect(() => {
    parseCSV(content)
  }, [content])

  const parseCSV = (csv: string) => {
    if (!csv.trim()) {
      setColumns([])
      setRows([])
      return
    }

    const lines = csv.split('\n').filter(line => line.trim())
    const parsed = lines.map(line => {
      // Simple CSV parsing - handles basic cases
      const cells: string[] = []
      let currentCell = ''
      let inQuotes = false

      for (let i = 0; i < line.length; i++) {
        const char = line[i]

        if (char === '"') {
          inQuotes = !inQuotes
        } else if (char === ',' && !inQuotes) {
          cells.push(currentCell.trim())
          currentCell = ''
        } else {
          currentCell += char
        }
      }
      cells.push(currentCell.trim())

      return cells
    })

    if (parsed.length === 0) {
      setColumns([])
      setRows([])
      return
    }

    // First row is headers
    const headers = parsed[0]
    setColumns(headers)

    // Convert remaining rows to objects
    const dataRows = parsed.slice(1).map(row => {
      const rowObj: Record<string, any> = {}
      headers.forEach((header, index) => {
        rowObj[header] = row[index] || ''
      })
      return rowObj
    })
    setRows(dataRows)
  }

  return <DataTable columns={columns} rows={rows} />
}

export default TableEditor
