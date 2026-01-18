// MetaDV dialog components

import React from 'react'
import { X, Plus, Loader, AlertTriangle, Link, Save, FileCode } from 'lucide-react'
import { AddSourceDialogState, AddTargetDialogState, DeleteConfirmDialogState, SelfLinkDialogState, RenameAttributeDialogState } from '../types'

interface SaveBeforeGenerateDialogProps {
  open: boolean
  saving: boolean
  onSaveAndGenerate: () => void
  onGenerateWithoutSaving: () => void
  onCancel: () => void
}

export function SaveBeforeGenerateDialog({
  open,
  saving,
  onSaveAndGenerate,
  onGenerateWithoutSaving,
  onCancel
}: SaveBeforeGenerateDialogProps) {
  if (!open) return null

  return (
    <div className="metadv-add-source-overlay" onClick={onCancel}>
      <div className="metadv-add-source-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="metadv-add-source-header">
          <AlertTriangle size={20} className="metadv-delete-warning-icon" />
          <h3>Unsaved Changes</h3>
          <button
            className="metadv-close-btn"
            onClick={onCancel}
            title="Close"
            disabled={saving}
          >
            <X size={16} />
          </button>
        </div>
        <div className="metadv-add-source-content">
          <p className="metadv-delete-confirm-message">
            You have unsaved changes. Would you like to save before generating models?
          </p>
          <p className="metadv-self-link-description">
            Generating without saving will use the last saved configuration.
          </p>
        </div>
        <div className="metadv-add-source-footer metadv-three-button-footer">
          <button
            className="metadv-btn-secondary"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="metadv-btn-secondary"
            onClick={onGenerateWithoutSaving}
            disabled={saving}
          >
            <FileCode size={14} />
            Generate Without Saving
          </button>
          <button
            className="metadv-btn-primary"
            onClick={onSaveAndGenerate}
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader size={14} className="metadv-spinner" />
                Saving...
              </>
            ) : (
              <>
                <Save size={14} />
                Save & Generate
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

interface AddSourceDialogProps {
  dialog: AddSourceDialogState
  setDialog: React.Dispatch<React.SetStateAction<AddSourceDialogState>>
  onClose: () => void
  onAdd: () => void
}

export function AddSourceDialog({
  dialog,
  setDialog,
  onClose,
  onAdd
}: AddSourceDialogProps) {
  if (!dialog.open) return null

  const isEditMode = dialog.editMode

  return (
    <div className="metadv-add-source-overlay" onClick={onClose}>
      <div className="metadv-add-source-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="metadv-add-source-header">
          <h3>{isEditMode ? 'Edit Source' : 'Add Source'}</h3>
          <button
            className="metadv-close-btn"
            onClick={onClose}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="metadv-add-source-content">
          <p className="metadv-add-source-description">
            {isEditMode
              ? 'Update the source name. Note: Changing the name will update all column references.'
              : 'Enter the name of an existing dbt model to fetch its columns.'}
          </p>
          <div className="metadv-add-source-field">
            <label htmlFor="source-name">Model Name *</label>
            <input
              id="source-name"
              type="text"
              placeholder="e.g., raw_customers"
              value={dialog.sourceName}
              onChange={(e) => setDialog((prev: AddSourceDialogState) => ({ ...prev, sourceName: e.target.value, error: null }))}
              disabled={dialog.loading}
              autoFocus
            />
          </div>
          {dialog.error && (
            <div className="metadv-add-source-error">
              {dialog.error}
            </div>
          )}
        </div>
        <div className="metadv-add-source-footer">
          <button
            className="metadv-btn-secondary"
            onClick={onClose}
            disabled={dialog.loading}
          >
            Cancel
          </button>
          <button
            className="metadv-btn-primary"
            onClick={onAdd}
            disabled={dialog.loading || !dialog.sourceName.trim()}
          >
            {dialog.loading ? (
              <>
                <Loader size={14} className="metadv-spinner" />
                {isEditMode ? 'Saving...' : 'Fetching...'}
              </>
            ) : isEditMode ? (
              <>
                <Save size={14} />
                Save Changes
              </>
            ) : (
              <>
                <Plus size={14} />
                Add Source
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

interface AddTargetDialogProps {
  dialog: AddTargetDialogState
  setDialog: React.Dispatch<React.SetStateAction<AddTargetDialogState>>
  onClose: () => void
  onAdd: () => void
}

export function AddTargetDialog({
  dialog,
  setDialog,
  onClose,
  onAdd
}: AddTargetDialogProps) {
  if (!dialog.open) return null

  const isEditMode = dialog.editMode

  return (
    <div className="metadv-add-source-overlay" onClick={onClose}>
      <div className="metadv-add-source-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="metadv-add-source-header">
          <h3>{isEditMode ? 'Edit Target' : 'Add Target'}</h3>
          <button
            className="metadv-close-btn"
            onClick={onClose}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="metadv-add-source-content">
          <p className="metadv-add-source-description">
            {isEditMode
              ? 'Update the target details. Note: Changing the name will update all connection references.'
              : 'Enter a name and optional description for the new target entity.'}
          </p>
          <div className="metadv-add-source-field">
            <label htmlFor="target-name">Target Name</label>
            <input
              id="target-name"
              type="text"
              placeholder="e.g., customer"
              value={dialog.targetName}
              onChange={(e) => setDialog((prev: AddTargetDialogState) => ({ ...prev, targetName: e.target.value, error: null }))}
              autoFocus
            />
          </div>
          <div className="metadv-add-source-field">
            <label htmlFor="target-description">Description (optional)</label>
            <input
              id="target-description"
              type="text"
              placeholder="e.g., Customer entity"
              value={dialog.description}
              onChange={(e) => setDialog((prev: AddTargetDialogState) => ({ ...prev, description: e.target.value }))}
            />
          </div>
          {dialog.error && (
            <div className="metadv-add-source-error">
              {dialog.error}
            </div>
          )}
        </div>
        <div className="metadv-add-source-footer">
          <button
            className="metadv-btn-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="metadv-btn-primary"
            onClick={onAdd}
            disabled={!dialog.targetName.trim()}
          >
            {isEditMode ? (
              <>
                <Save size={14} />
                Save Changes
              </>
            ) : (
              <>
                <Plus size={14} />
                Add Target
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ConnectionTypePopupProps {
  position: { x: number; y: number }
  targetName: string
  linkedEntities?: string[]  // For relation targets, the entities it links
  onSelectEntity: (entityName: string, entityIndex: number) => void
  onSelectAttribute: () => void
  onCancel: () => void
}

export function ConnectionTypePopup({
  position,
  targetName,
  linkedEntities,
  onSelectEntity,
  onSelectAttribute,
  onCancel
}: ConnectionTypePopupProps) {
  // For relation targets, show entity buttons with position index for disambiguation
  // For entity targets, show single entity button with the target name
  const entityOptions = linkedEntities && linkedEntities.length > 0
    ? linkedEntities
    : [targetName]

  // Check if we have duplicate entity names (self-link case)
  const hasDuplicates = linkedEntities && linkedEntities.length !== new Set(linkedEntities).size

  return (
    <div
      className="metadv-connection-popup"
      style={{
        left: position.x,
        top: position.y
      }}
    >
      <div className="metadv-connection-popup-title">Connection Type</div>
      {entityOptions.map((entityName, idx) => (
        <button
          key={`${entityName}-${idx}`}
          className="metadv-connection-type-btn metadv-type-entity"
          onClick={() => onSelectEntity(entityName, idx)}
        >
          {hasDuplicates
            ? `Entity (${entityName} ${idx + 1})`
            : `Entity (${entityName})`
          }
        </button>
      ))}
      <button
        className="metadv-connection-type-btn metadv-type-attribute"
        onClick={onSelectAttribute}
      >
        Attribute Of
      </button>
      <button
        className="metadv-connection-cancel-btn"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  )
}

interface DeleteConnectionBarProps {
  onDelete: () => void
  onCancel: () => void
}

export function DeleteConnectionBar({
  onDelete,
  onCancel
}: DeleteConnectionBarProps) {
  return (
    <div className="metadv-delete-connection-bar">
      <span>Delete this connection?</span>
      <button className="metadv-btn-delete" onClick={onDelete}>
        Delete
      </button>
      <button className="metadv-btn-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

interface DeleteConfirmDialogProps {
  dialog: DeleteConfirmDialogState
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteConfirmDialog({
  dialog,
  onConfirm,
  onCancel
}: DeleteConfirmDialogProps) {
  if (!dialog.open) return null

  return (
    <div className="metadv-add-source-overlay" onClick={onCancel}>
      <div className="metadv-add-source-dialog metadv-delete-confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="metadv-add-source-header metadv-delete-confirm-header">
          <AlertTriangle size={20} className="metadv-delete-warning-icon" />
          <h3>{dialog.title}</h3>
          <button
            className="metadv-close-btn"
            onClick={onCancel}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="metadv-add-source-content">
          <p className="metadv-delete-confirm-message">
            {dialog.message}
          </p>
          {dialog.connectionCount > 0 && (
            <p className="metadv-delete-confirm-warning">
              This will also remove <strong>{dialog.connectionCount}</strong> connection{dialog.connectionCount !== 1 ? 's' : ''}.
            </p>
          )}
        </div>
        <div className="metadv-add-source-footer">
          <button
            className="metadv-btn-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="metadv-btn-danger"
            onClick={onConfirm}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

interface SelfLinkDialogProps {
  dialog: SelfLinkDialogState
  onConfirm: () => void
  onCancel: () => void
}

export function SelfLinkDialog({
  dialog,
  onConfirm,
  onCancel
}: SelfLinkDialogProps) {
  if (!dialog.open) return null

  return (
    <div className="metadv-add-source-overlay" onClick={onCancel}>
      <div className="metadv-add-source-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="metadv-add-source-header">
          <Link size={20} className="metadv-self-link-icon" />
          <h3>Create Self-Referencing Relation</h3>
          <button
            className="metadv-close-btn"
            onClick={onCancel}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="metadv-add-source-content">
          <p className="metadv-delete-confirm-message">
            Do you want to create a self-referencing relation for <strong>{dialog.entityName}</strong>?
          </p>
          <p className="metadv-self-link-description">
            This will create a relation that links the entity to itself, useful for hierarchical or recursive relationships (e.g., employee-manager, parent-child).
          </p>
        </div>
        <div className="metadv-add-source-footer">
          <button
            className="metadv-btn-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="metadv-btn-primary"
            onClick={onConfirm}
          >
            <Link size={14} />
            Create Self-Link
          </button>
        </div>
      </div>
    </div>
  )
}

interface RenameAttributeDialogProps {
  dialog: RenameAttributeDialogState
  setDialog: React.Dispatch<React.SetStateAction<RenameAttributeDialogState>>
  onClose: () => void
  onRename: () => void
}

export function RenameAttributeDialog({
  dialog,
  setDialog,
  onClose,
  onRename
}: RenameAttributeDialogProps) {
  if (!dialog.open) return null

  return (
    <div className="metadv-add-source-overlay" onClick={onClose}>
      <div className="metadv-add-source-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="metadv-add-source-header">
          <h3>Rename Attribute</h3>
          <button
            className="metadv-close-btn"
            onClick={onClose}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="metadv-add-source-content">
          <p className="metadv-add-source-description">
            Rename the attribute. This will update all connected source columns.
          </p>
          <div className="metadv-add-source-field">
            <label htmlFor="attribute-name">Attribute Name</label>
            <input
              id="attribute-name"
              type="text"
              placeholder="e.g., customer"
              value={dialog.newAttributeName}
              onChange={(e) => setDialog((prev: RenameAttributeDialogState) => ({ ...prev, newAttributeName: e.target.value, error: null }))}
              autoFocus
            />
          </div>
          {dialog.error && (
            <div className="metadv-add-source-error">
              {dialog.error}
            </div>
          )}
        </div>
        <div className="metadv-add-source-footer">
          <button
            className="metadv-btn-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="metadv-btn-primary"
            onClick={onRename}
            disabled={!dialog.newAttributeName.trim()}
          >
            <Save size={14} />
            Rename
          </button>
        </div>
      </div>
    </div>
  )
}
