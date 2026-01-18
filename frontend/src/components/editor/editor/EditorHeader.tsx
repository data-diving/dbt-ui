// Editor header component

import { FileText, Table, Code, PanelRightOpen, PanelRightClose, PanelLeftOpen, PanelLeftClose, Save, FileCode2, Database } from 'lucide-react'
import { ViewMode } from './types'

interface EditorHeaderProps {
  selectedFile: string | null
  viewMode: ViewMode
  isCsvFile: boolean
  isSqlModel: boolean
  isJsonFile: boolean
  isBinaryFile: boolean
  hasUnsavedChanges: boolean
  saving: boolean
  showMetadata: boolean
  showSidebar?: boolean
  onViewModeChange: (mode: ViewMode) => void
  onSave: () => void
  onToggleMetadata: () => void
  onToggleSidebar?: () => void
}

function EditorHeader({
  selectedFile,
  viewMode,
  isCsvFile,
  isSqlModel,
  isJsonFile,
  isBinaryFile,
  hasUnsavedChanges,
  saving,
  showMetadata,
  showSidebar,
  onViewModeChange,
  onSave,
  onToggleMetadata,
  onToggleSidebar
}: EditorHeaderProps) {
  return (
    <div className="editor-header">
      {selectedFile ? (
        <>
          <FileText size={14} />
          <span className="editor-filename">{selectedFile}</span>
        </>
      ) : (
        <span className="editor-filename">No file selected</span>
      )}

      {isCsvFile && (
        <div className="editor-view-toggle">
          <button
            className={`view-toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
            onClick={() => onViewModeChange('table')}
            title="Table view"
          >
            <Table size={16} />
          </button>
          <button
            className={`view-toggle-btn ${viewMode === 'text' ? 'active' : ''}`}
            onClick={() => onViewModeChange('text')}
            title="Text view"
          >
            <Code size={16} />
          </button>
        </div>
      )}

      {isSqlModel && (
        <div className="editor-view-toggle">
          <button
            className={`view-toggle-btn ${viewMode === 'text' ? 'active' : ''}`}
            onClick={() => onViewModeChange('text')}
            title="Source view"
          >
            <Code size={16} />
          </button>
          <button
            className={`view-toggle-btn ${viewMode === 'rendered' ? 'active' : ''}`}
            onClick={() => onViewModeChange('rendered')}
            title="Compiled SQL"
          >
            <FileCode2 size={16} />
          </button>
          <button
            className={`view-toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
            onClick={() => onViewModeChange('table')}
            title="Preview data (dbt show)"
          >
            <Database size={16} />
          </button>
        </div>
      )}

      {isJsonFile && (
        <div className="editor-view-toggle">
          <button
            className={`view-toggle-btn ${viewMode === 'text' ? 'active' : ''}`}
            onClick={() => onViewModeChange('text')}
            title="Text view (editable)"
          >
            <Code size={16} />
          </button>
          <button
            className={`view-toggle-btn ${viewMode === 'rendered' ? 'active' : ''}`}
            onClick={() => onViewModeChange('rendered')}
            title="Formatted view (read-only)"
          >
            <FileCode2 size={16} />
          </button>
        </div>
      )}

      <button
        className={`save-btn ${hasUnsavedChanges ? 'has-changes' : ''}`}
        onClick={onSave}
        disabled={viewMode !== 'text' || !hasUnsavedChanges || saving || !selectedFile || isBinaryFile}
        title={isBinaryFile ? 'Cannot edit binary file' : viewMode !== 'text' ? 'Save not available in this view' : saving ? 'Saving...' : hasUnsavedChanges ? 'Save file' : 'No changes to save'}
      >
        <Save size={16} />
      </button>

      {onToggleSidebar && (
        <button
          className="sidebar-toggle-btn-header"
          onClick={onToggleSidebar}
          title={showSidebar ? "Hide sidebar" : "Show sidebar"}
        >
          {showSidebar ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
      )}

      <button
        className="metadata-toggle-btn"
        onClick={onToggleMetadata}
        title={showMetadata ? "Hide properties" : "Show properties"}
      >
        {showMetadata ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
      </button>
    </div>
  )
}

export default EditorHeader
