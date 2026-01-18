// Editor content rendering component

import MonacoEditor from '@monaco-editor/react'
import { FileText } from 'lucide-react'
import { ViewMode, ModelPreviewData } from './types'
import TableEditor from '../TableEditor'
import DataTable from '../DataTable'

interface EditorContentProps {
  loading: boolean
  isBinaryFile: boolean
  loadingCompiled: boolean
  isSqlModel: boolean
  isCsvFile: boolean
  isJsonFile: boolean
  viewMode: ViewMode
  isDbtShowSupported: boolean
  dbtVersion: string
  showPreviewConfirm: boolean
  loadingPreview: boolean
  modelPreview: ModelPreviewData | null
  content: string
  compiledSql: string
  formattedJson: string
  selectedFile: string | null
  onContentChange: (value: string | undefined) => void
  onPreviewConfirm: () => void
  onPreviewCancel: () => void
  onShowPreviewDialog: () => void
}

const getLanguage = (filePath: string | null): string => {
  if (!filePath) return 'plaintext'
  if (filePath.endsWith('.sql')) return 'sql'
  if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) return 'yaml'
  if (filePath.endsWith('.py')) return 'python'
  if (filePath.endsWith('.md')) return 'markdown'
  if (filePath.endsWith('.json')) return 'json'
  if (filePath.endsWith('.csv')) return 'plaintext'
  if (filePath.endsWith('.log')) return 'shell'
  return 'plaintext'
}

function EditorContent({
  loading,
  isBinaryFile,
  loadingCompiled,
  isSqlModel,
  isCsvFile,
  isJsonFile,
  viewMode,
  isDbtShowSupported,
  dbtVersion,
  showPreviewConfirm,
  loadingPreview,
  modelPreview,
  content,
  compiledSql,
  formattedJson,
  selectedFile,
  onContentChange,
  onPreviewConfirm,
  onPreviewCancel,
  onShowPreviewDialog
}: EditorContentProps) {
  if (loading) {
    return <div className="editor-loading">Loading...</div>
  }

  if (isBinaryFile) {
    return (
      <div className="editor-binary-file">
        <FileText size={48} strokeWidth={1} />
        <p>Cannot display binary file</p>
      </div>
    )
  }

  if (loadingCompiled) {
    return <div className="editor-loading">Loading compiled SQL...</div>
  }

  if (isSqlModel && viewMode === 'table' && !isDbtShowSupported) {
    return (
      <div className="editor-error">
        <div className="error-message">
          <p>dbt show is not supported for dbt-core &lt; 1.5</p>
          <pre>Current version: {dbtVersion || 'unknown'}{'\n'}dbt show requires dbt-core 1.5 or later.</pre>
        </div>
      </div>
    )
  }

  if (isSqlModel && viewMode === 'table' && showPreviewConfirm) {
    return (
      <div className="preview-confirm-dialog">
        <div className="preview-confirm-content">
          <p>{modelPreview ? 'Refresh data from database?' : 'Load data from database?'}</p>
          <p className="preview-confirm-hint">This will run <code>dbt show</code> to fetch sample data from the database.</p>
          <div className="preview-confirm-buttons">
            <button className="preview-confirm-btn cancel" onClick={onPreviewCancel}>
              {modelPreview ? 'Use Cached' : 'Cancel'}
            </button>
            <button className="preview-confirm-btn confirm" onClick={onPreviewConfirm}>
              {modelPreview ? 'Refresh' : 'Load Data'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (isSqlModel && viewMode === 'table' && loadingPreview) {
    return (
      <div className="editor-loading-progress">
        <div className="editor-progress-bar">
          <div className="editor-progress-fill" />
        </div>
      </div>
    )
  }

  if (isSqlModel && viewMode === 'table' && modelPreview?.error) {
    return (
      <div className="editor-error">
        <div className="error-message">
          <p>Failed to load preview:</p>
          <pre>{modelPreview.error}</pre>
        </div>
      </div>
    )
  }

  if (isSqlModel && viewMode === 'table' && modelPreview) {
    return (
      <div className="preview-container">
        <DataTable columns={modelPreview.columns} rows={modelPreview.rows} />
        {modelPreview.hasMore && (
          <div className="preview-has-more">
            Showing first 10 rows. The table contains more records.
          </div>
        )}
      </div>
    )
  }

  if (isSqlModel && viewMode === 'table' && !modelPreview) {
    return (
      <div className="preview-not-loaded">
        <p>Data hasn't been loaded from database.</p>
        <button className="load-preview-btn" onClick={onShowPreviewDialog}>
          Load Preview Data
        </button>
      </div>
    )
  }

  if (isCsvFile && viewMode === 'table') {
    return <TableEditor content={content} />
  }

  if (isSqlModel && viewMode === 'rendered') {
    return (
      <MonacoEditor
        key="sql-rendered"
        height="100%"
        language="sql"
        theme="vs-dark"
        value={compiledSql}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: 'on',
          readOnly: true,
        }}
      />
    )
  }

  if (isJsonFile && viewMode === 'rendered') {
    return (
      <MonacoEditor
        key="json-rendered"
        height="100%"
        language="json"
        theme="vs-dark"
        value={formattedJson}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: 'on',
          readOnly: true,
        }}
      />
    )
  }

  return (
    <MonacoEditor
      key="text-editable"
      height="100%"
      language={getLanguage(selectedFile)}
      theme="vs-dark"
      value={content}
      onChange={onContentChange}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: 'on',
        readOnly: false,
      }}
    />
  )
}

export default EditorContent
