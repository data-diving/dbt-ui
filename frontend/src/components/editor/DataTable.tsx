import './DataTable.css'

interface DataTableProps {
  columns: string[]
  rows: Record<string, any>[]
  showRowNumbers?: boolean
}

function DataTable({ columns, rows, showRowNumbers = true }: DataTableProps) {
  if (columns.length === 0 || rows.length === 0) {
    return <div className="data-table-empty">No data to display</div>
  }

  return (
    <div className="data-table">
      <div className="data-table-wrapper">
        <table className="data-table-content">
          <thead>
            <tr>
              {showRowNumbers && <th className="row-number-header">#</th>}
              {columns.map((col, index) => (
                <th key={index}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {showRowNumbers && <td className="row-number">{rowIndex + 1}</td>}
                {columns.map((col, colIndex) => (
                  <td key={colIndex}>
                    {row[col] !== null && row[col] !== undefined ? String(row[col]) : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default DataTable
