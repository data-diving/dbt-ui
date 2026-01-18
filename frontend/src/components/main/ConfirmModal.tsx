import { useRef, useEffect, useState } from 'react'
import { AlertTriangle, Edit3 } from 'lucide-react'
import './ConfirmModal.css'

interface ConfirmModalProps {
  onClose: () => void
  onConfirm: (value?: string) => void
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'default'
  // For input mode (rename)
  inputMode?: boolean
  inputValue?: string
  inputPlaceholder?: string
}

function ConfirmModal({
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  inputMode = false,
  inputValue = '',
  inputPlaceholder = ''
}: ConfirmModalProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(inputValue)

  useEffect(() => {
    // Focus the input if in input mode, otherwise focus confirm button
    if (inputMode && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    } else if (confirmButtonRef.current) {
      confirmButtonRef.current.focus()
    }
  }, [inputMode])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Enter' && (!inputMode || value.trim())) {
      onConfirm(inputMode ? value : undefined)
    }
  }

  const handleConfirm = () => {
    if (inputMode && !value.trim()) return
    onConfirm(inputMode ? value : undefined)
  }

  const getIcon = () => {
    if (inputMode) {
      return <Edit3 size={20} />
    }
    return <AlertTriangle size={20} />
  }

  return (
    <div className="confirm-modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="confirm-modal" onClick={e => e.stopPropagation()}>
        <div className={`confirm-modal-header ${variant}`}>
          {getIcon()}
          <h3>{title}</h3>
        </div>
        <div className="confirm-modal-content">
          <p className="confirm-modal-message">{message}</p>
          {inputMode && (
            <input
              ref={inputRef}
              type="text"
              className="confirm-modal-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={inputPlaceholder}
            />
          )}
        </div>
        <div className="confirm-modal-actions">
          <button
            className="confirm-modal-cancel"
            onClick={onClose}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmButtonRef}
            className={`confirm-modal-confirm ${variant}`}
            onClick={handleConfirm}
            disabled={inputMode && !value.trim()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmModal
