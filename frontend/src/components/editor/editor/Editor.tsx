// Main Editor component - orchestrates sub-components and hooks

import { useState, useEffect } from 'react'
import '../Editor.css'

import { EditorProps, ViewMode } from './types'
import { useFileContent } from './hooks/useFileContent'
import { useFileSave } from './hooks/useFileSave'
import { useModelPreview } from './hooks/useModelPreview'
import { useCompiledSql } from './hooks/useCompiledSql'
import EditorHeader from './EditorHeader'
import EditorContent from './EditorContent'
import ConflictModal from '../ConflictModal'

function Editor({
  selectedFile,
  projectPath,
  onToggleMetadata,
  showMetadata,
  onToggleSidebar,
  showSidebar,
  compilationTrigger = 0,
  onFileModified,
  onFileSaved,
  dbtVersion = '',
  onUnsavedChangesStateChange,
  saveRef
}: EditorProps) {
  const [formattedJson, setFormattedJson] = useState('')

  // File content hook
  const {
    content,
    setContent,
    originalContent,
    setOriginalContent,
    loading,
    isBinaryFile,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    viewMode,
    setViewMode
  } = useFileContent(selectedFile, projectPath)

  // File save hook
  const {
    saving,
    conflictData,
    handleSave,
    handleConflictCancel,
    handleAcceptIncoming,
    handleAcceptMyChanges,
    handleSaveWithConflicts
  } = useFileSave({
    selectedFile,
    projectPath,
    content,
    originalContent,
    setContent,
    setOriginalContent,
    setHasUnsavedChanges,
    onFileModified,
    onFileSaved
  })

  // Model preview hook
  const {
    modelPreview,
    setModelPreview,
    loadingPreview,
    showPreviewConfirm,
    setShowPreviewConfirm,
    previewCache,
    loadModelPreview
  } = useModelPreview()

  // Compiled SQL hook
  const {
    compiledSql,
    setCompiledSql,
    loadingCompiled,
    loadCompiledSql
  } = useCompiledSql()

  // File type checks
  const isCsvFile = selectedFile?.endsWith('.csv') || false
  const isJsonFile = selectedFile?.endsWith('.json') || false
  const isSqlModel = (selectedFile?.endsWith('.sql') &&
                     (selectedFile?.includes('/models/') || selectedFile?.startsWith('models/'))) || false

  // Check if dbt show is supported (requires dbt-core >= 1.5)
  const isDbtShowSupported = (() => {
    if (!dbtVersion) return false
    const match = dbtVersion.match(/(\d+)\.(\d+)/)
    if (!match) return false
    const major = parseInt(match[1], 10)
    const minor = parseInt(match[2], 10)
    return major > 1 || (major === 1 && minor >= 5)
  })()

  // Notify parent when unsaved changes state changes
  useEffect(() => {
    if (onUnsavedChangesStateChange) {
      onUnsavedChangesStateChange(hasUnsavedChanges)
    }
  }, [hasUnsavedChanges, onUnsavedChangesStateChange])

  // Expose save function to parent via ref
  useEffect(() => {
    if (saveRef) {
      saveRef.current = handleSave
    }
    return () => {
      if (saveRef) {
        saveRef.current = null
      }
    }
  }, [saveRef, selectedFile, projectPath, content, saving])

  // Reset compiled SQL, formatted JSON when file changes; restore preview from cache
  useEffect(() => {
    setCompiledSql('')
    setFormattedJson('')
    setShowPreviewConfirm(false)

    if (selectedFile && previewCache.current.has(selectedFile)) {
      setModelPreview(previewCache.current.get(selectedFile) || null)
    } else {
      setModelPreview(null)
    }

    if (viewMode === 'rendered' && isSqlModel && selectedFile && !loading) {
      loadCompiledSql(selectedFile, projectPath || '')
    }
  }, [selectedFile, loading, isDbtShowSupported])

  // Reload compiled SQL when compilation completes
  useEffect(() => {
    if (compilationTrigger > 0 && viewMode === 'rendered' && isSqlModel && selectedFile && projectPath) {
      loadCompiledSql(selectedFile, projectPath)
    }
  }, [compilationTrigger])

  const handleContentChange = (value: string | undefined) => {
    if (viewMode !== 'text') return
    const newContent = value || ''
    setContent(newContent)
    const isModified = newContent !== originalContent
    setHasUnsavedChanges(isModified)
  }

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode)
    if (mode === 'rendered' && isSqlModel && !compiledSql && selectedFile && projectPath) {
      loadCompiledSql(selectedFile, projectPath)
    }
    if (mode === 'table' && isSqlModel && isDbtShowSupported) {
      setShowPreviewConfirm(true)
    }
    if (mode === 'rendered' && isJsonFile && !formattedJson) {
      try {
        const parsed = JSON.parse(content)
        setFormattedJson(JSON.stringify(parsed, null, 2))
      } catch (e) {
        setFormattedJson(content)
      }
    }
  }

  const handlePreviewConfirm = () => {
    setShowPreviewConfirm(false)
    if (selectedFile && projectPath) {
      loadModelPreview(selectedFile, projectPath)
    }
  }

  const handlePreviewCancel = () => {
    setShowPreviewConfirm(false)
  }

  return (
    <>
      <div className="editor">
        <EditorHeader
          selectedFile={selectedFile}
          viewMode={viewMode}
          isCsvFile={isCsvFile}
          isSqlModel={isSqlModel}
          isJsonFile={isJsonFile}
          isBinaryFile={isBinaryFile}
          hasUnsavedChanges={hasUnsavedChanges}
          saving={saving}
          showMetadata={showMetadata}
          showSidebar={showSidebar}
          onViewModeChange={handleViewModeChange}
          onSave={handleSave}
          onToggleMetadata={onToggleMetadata}
          onToggleSidebar={onToggleSidebar}
        />
        <div className="editor-content">
          <EditorContent
            loading={loading}
            isBinaryFile={isBinaryFile}
            loadingCompiled={loadingCompiled}
            isSqlModel={isSqlModel}
            isCsvFile={isCsvFile}
            isJsonFile={isJsonFile}
            viewMode={viewMode}
            isDbtShowSupported={isDbtShowSupported}
            dbtVersion={dbtVersion}
            showPreviewConfirm={showPreviewConfirm}
            loadingPreview={loadingPreview}
            modelPreview={modelPreview}
            content={content}
            compiledSql={compiledSql}
            formattedJson={formattedJson}
            selectedFile={selectedFile}
            onContentChange={handleContentChange}
            onPreviewConfirm={handlePreviewConfirm}
            onPreviewCancel={handlePreviewCancel}
            onShowPreviewDialog={() => setShowPreviewConfirm(true)}
          />
        </div>
      </div>
      {conflictData && (
        <ConflictModal
          diskContent={conflictData.diskContent}
          myContent={conflictData.myContent}
          fileName={selectedFile || undefined}
          onCancel={handleConflictCancel}
          onAcceptIncoming={handleAcceptIncoming}
          onAcceptMyChanges={handleAcceptMyChanges}
          onSaveWithConflicts={handleSaveWithConflicts}
        />
      )}
    </>
  )
}

export default Editor
