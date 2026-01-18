import { useRef, useEffect, useState } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { CheckCircle, XCircle, Copy, Check } from 'lucide-react'
import './LogResultModal.css'

interface LogResultModalProps {
  onClose: () => void
  success: boolean
  title: string
  message: string
  output: string
}

// Strip ANSI escape codes from terminal output
/* eslint-disable no-control-regex */
const stripAnsiCodes = (text: string): string => {
  let result = text
    // Remove all CSI sequences (colors, cursor movement, erase, etc.)
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    // Remove OSC sequences (title setting, etc.)
    .replace(/\x1b\][^\x07]*\x07/g, '')
    // Remove any remaining escape sequences
    .replace(/\x1b./g, '')
    // Remove carriage returns
    .replace(/\r/g, '')

  // Fix dbt's line wrapping issue: join lines where model name got split
  // Pattern: line ending with "main." followed by line starting with model name
  result = result.replace(/(\s+sql \w+ model main\.)\n(\w+)/g, '$1$2')

  return result
}
/* eslint-enable no-control-regex */

function LogResultModal({ onClose, success, title, message, output }: LogResultModalProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [copied, setCopied] = useState(false)
  const [editorReady, setEditorReady] = useState(false)

  useEffect(() => {
    // Focus the OK button after editor is ready
    if (editorReady) {
      buttonRef.current?.focus()
    }
  }, [editorReady])

  const handleCopy = async () => {
    const cleanOutput = stripAnsiCodes(output)
    try {
      await navigator.clipboard.writeText(cleanOutput)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy to clipboard:', err)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      onClose()
    }
  }

  // Strip ANSI codes and calculate editor height based on line count (min 100px, max 400px)
  const cleanOutput = stripAnsiCodes(output)
  const lineCount = cleanOutput.split('\n').length
  const editorHeight = Math.min(400, Math.max(100, lineCount * 19))

  return (
    <>
      {/* Hidden editor to preload Monaco - renders off-screen until ready */}
      {!editorReady && (
        <div style={{ position: 'absolute', left: -9999, top: -9999, width: 800 }}>
          <MonacoEditor
            height={editorHeight}
            language="shell"
            value={cleanOutput}
            theme="vs-dark"
            onMount={() => setEditorReady(true)}
            options={{
              readOnly: true,
              minimap: { enabled: false },
            }}
          />
        </div>
      )}
      {/* Show modal only after editor is ready */}
      {editorReady && (
        <div className="log-result-modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
          <div className="log-result-modal" onClick={e => e.stopPropagation()}>
            <div className={`log-result-modal-header ${success ? 'success' : 'error'}`}>
              {success ? <CheckCircle size={20} /> : <XCircle size={20} />}
              <h3>{title}</h3>
            </div>
            <div className="log-result-modal-content">
              <p className="log-result-message">{message}</p>
              <div className="log-result-output">
                <MonacoEditor
                  height={editorHeight}
                  language="shell"
                  value={cleanOutput}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    lineNumbers: 'off',
                    folding: false,
                    wordWrap: 'on',
                    renderLineHighlight: 'none',
                    overviewRulerLanes: 0,
                    hideCursorInOverviewRuler: true,
                    overviewRulerBorder: false,
                    scrollbar: {
                      vertical: 'auto',
                      horizontal: 'hidden',
                      verticalScrollbarSize: 10,
                    },
                    padding: { top: 8, bottom: 8 },
                  }}
                />
              </div>
            </div>
            <div className="log-result-modal-actions">
              <button
                className="log-result-modal-copy"
                onClick={handleCopy}
                title="Copy to clipboard"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                ref={buttonRef}
                className="log-result-modal-ok"
                onClick={onClose}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default LogResultModal
