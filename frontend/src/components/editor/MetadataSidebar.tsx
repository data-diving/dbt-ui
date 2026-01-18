import { useState, useEffect } from 'react'
import './MetadataSidebar.css'
import { Info } from 'lucide-react'
import { apiUrl, apiFetch } from '../../config/api'

interface MetadataSidebarProps {
  selectedFile: string | null
  projectPath: string | null
  compilationTrigger?: number
}

interface FileMetadata {
  name: string
  type: 'model' | 'seed' | 'macro' | 'source' | 'unknown'
  description?: string
  columns?: Array<{
    name: string
    description?: string
    [key: string]: any
  }>
  [key: string]: any
}

function MetadataSidebar({ selectedFile, projectPath, compilationTrigger }: MetadataSidebarProps) {
  const [metadata, setMetadata] = useState<FileMetadata | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selectedFile || !projectPath) {
      setMetadata(null)
      return
    }

    // Check if selectedFile is a folder (no file extension)
    const isFolder = !selectedFile.includes('.')
    if (isFolder) {
      console.log('[MetadataSidebar] Folder selected, not loading metadata:', selectedFile)
      setMetadata(null)
      setLoading(false)
      return
    }

    let cancelled = false

    const loadData = async () => {
      if (cancelled) return
      await loadMetadata()
    }

    loadData()

    return () => {
      cancelled = true
    }
  }, [selectedFile, projectPath])

  // Re-load metadata when compilation completes
  useEffect(() => {
    if (compilationTrigger && compilationTrigger > 0 && selectedFile) {
      loadMetadata()
    }
  }, [compilationTrigger])

  const loadMetadata = async () => {
    if (!selectedFile || !projectPath) return

    setLoading(true)
    try {
      const response = await apiFetch(apiUrl('/api/get-metadata'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectPath: projectPath,
          filePath: selectedFile,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setMetadata(data)
      } else {
        setMetadata(null)
      }
    } catch (err) {
      console.error('Error loading metadata:', err)
      setMetadata(null)
    } finally {
      setLoading(false)
    }
  }

  const getFileName = (filePath: string | null): string => {
    if (!filePath) return 'Unknown'
    const fileName = filePath.split('/').pop() || ''
    return fileName.replace(/\.(sql|yml|yaml|csv)$/, '')
  }

  const renderMetadataValue = (key: string, value: any): JSX.Element => {
    if (value === null || value === undefined) {
      return <span className="metadata-value-null">null</span>
    }

    if (typeof value === 'boolean') {
      return <span className="metadata-value-boolean">{value.toString()}</span>
    }

    if (typeof value === 'number') {
      return <span className="metadata-value-number">{value}</span>
    }

    if (typeof value === 'string') {
      return <span className="metadata-value-string">{value}</span>
    }

    if (Array.isArray(value)) {
      return (
        <div className="metadata-value-array">
          {value.map((item, index) => (
            <div key={index} className="metadata-array-item">
              {typeof item === 'object' ? JSON.stringify(item, null, 2) : String(item)}
            </div>
          ))}
        </div>
      )
    }

    if (typeof value === 'object') {
      return (
        <div className="metadata-value-object">
          {Object.entries(value).map(([k, v]) => (
            <div key={k} className="metadata-object-entry">
              <span className="metadata-object-key">{k}:</span>{' '}
              {renderMetadataValue(k, v)}
            </div>
          ))}
        </div>
      )
    }

    return <span>{String(value)}</span>
  }

  if (!selectedFile) {
    return (
      <div className="metadata-sidebar">
        <div className="metadata-header">
          <Info size={14} />
          <span className="metadata-title">Properties</span>
        </div>
        <div className="metadata-content">
          <div className="metadata-empty">No file selected</div>
        </div>
      </div>
    )
  }

  return (
    <div className="metadata-sidebar">
      <div className="metadata-header">
        <Info size={14} />
        <span className="metadata-title">Properties</span>
      </div>
      <div className="metadata-content">
        {loading ? (
          <div className="metadata-loading">Loading metadata...</div>
        ) : metadata ? (
          <>
            <div className="metadata-section">
              <div className="metadata-section-title">Name</div>
              <div className="metadata-section-value">{metadata.name || getFileName(selectedFile)}</div>
            </div>

            <div className="metadata-section">
              <div className="metadata-section-title">Type</div>
              <div className="metadata-section-value metadata-type">
                <span className={`type-badge type-${metadata.type}`}>
                  {metadata.type}
                </span>
              </div>
            </div>

            {metadata.description && (
              <div className="metadata-section">
                <div className="metadata-section-title">Description</div>
                <div className="metadata-section-value">
                  {metadata.description}
                </div>
              </div>
            )}

            {metadata.columns && metadata.columns.length > 0 && (
              <div className="metadata-section">
                <div className="metadata-section-title">Columns</div>
                <div className="metadata-columns">
                  {metadata.columns.map((column, index) => (
                    <div key={index} className="metadata-column">
                      <div className="metadata-column-name">{column.name}</div>
                      {column.description && (
                        <div className="metadata-column-description">{column.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {Object.entries(metadata)
              .filter(([key]) => !['name', 'type', 'description', 'columns'].includes(key))
              .map(([key, value]) => (
                <div key={key} className="metadata-section">
                  <div className="metadata-section-title">{key}</div>
                  <div className="metadata-section-value">
                    {renderMetadataValue(key, value)}
                  </div>
                </div>
              ))}
          </>
        ) : (
          <div className="metadata-empty">No metadata available</div>
        )}
      </div>
    </div>
  )
}

export default MetadataSidebar