// Hook for loading and saving MetaDV data

import { useState } from 'react'
import { apiUrl, apiFetch } from '../../../../config/api'
import { MetaDVData, Target, Connection } from '../types'

interface UseMetaDVDataResult {
  data: MetaDVData | null
  setData: React.Dispatch<React.SetStateAction<MetaDVData | null>>
  loading: boolean
  saving: boolean
  generating: boolean
  error: string | null
  setError: React.Dispatch<React.SetStateAction<string | null>>
  successMessage: string | null
  setSuccessMessage: React.Dispatch<React.SetStateAction<string | null>>
  hasUnsavedChanges: boolean
  setHasUnsavedChanges: React.Dispatch<React.SetStateAction<boolean>>
  initializeAndLoad: () => Promise<void>
  handleSave: (connections: Connection[]) => Promise<void>
  handleGenerate: () => Promise<{ success: boolean; generatedFiles: string[] }>
}

export function useMetaDVData(projectPath: string): UseMetaDVDataResult {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [data, setData] = useState<MetaDVData | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  const initializeAndLoad = async (): Promise<void> => {
    setLoading(true)
    setError(null)

    try {
      // First, initialize the metadv folder and yml file
      const initResponse = await apiFetch(apiUrl('/api/metadv-init'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath })
      })

      const initData = await initResponse.json()
      if (!initData.success) {
        setError(initData.error || 'Failed to initialize MetaDV')
        setLoading(false)
        return
      }

      // Then read the full data
      const readResponse = await apiFetch(apiUrl('/api/metadv-read'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath })
      })

      const readData = await readResponse.json()
      if (!readData.success) {
        setError(readData.error || 'Failed to read MetaDV data')
        setLoading(false)
        return
      }

      // Normalize targets to ensure they have type field
      const normalizedData = {
        ...readData.data,
        targets: (readData.data.targets || []).map((t: any) => ({
          name: t.name,
          description: t.description,
          type: t.type || 'entity',
          entities: t.entities
        }))
      }

      setData(normalizedData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (connections: Connection[]) => {
    setSaving(true)
    setError(null)
    setSuccessMessage(null)

    try {
      // Build the updated data structure with target types
      const targetsForSave = (data?.targets || []).map((t: Target) => {
        const targetData: any = { name: t.name }
        if (t.description) targetData.description = t.description
        targetData.type = t.type || 'entity'
        if (t.type === 'relation' && t.entities) {
          targetData.entities = t.entities
        }
        return targetData
      })

      // Group columns by source (model name)
      const sourceMap = new Map<string, any[]>()

      for (const col of data?.source_columns || []) {
        const colKey = `${col.source}.${col.column}`

        // Find connections for this column
        const entityConns = connections.filter(
          c => c.sourceColumn === colKey && c.connectionType === 'entity_name'
        )
        const attrConns = connections.filter(
          c => c.sourceColumn === colKey && c.connectionType === 'attribute_of'
        )

        // Build column data
        const columnData: any = { name: col.column }

        // Build unified target array containing both entity keys and attributes
        const targetArray: any[] = []

        // Add entity/relation key connections
        for (const c of entityConns) {
          const targetEntry: any = {
            target_name: c.targetName
          }
          if (c.linkedEntityName) {
            targetEntry.entity_name = c.linkedEntityName
          }
          if (c.linkedEntityIndex !== undefined) {
            targetEntry.entity_index = c.linkedEntityIndex
          }
          targetArray.push(targetEntry)
        }

        // Add attribute connections
        for (const c of attrConns) {
          const targetEntry: any = {
            attribute_of: c.targetName
          }
          // Find target_attribute and multiactive_key from the existing column data
          const existingAttrConn = col.target?.find(
            (t: any) => t.attribute_of === c.targetName
          )
          if (existingAttrConn?.target_attribute) {
            targetEntry.target_attribute = existingAttrConn.target_attribute
          }
          if (existingAttrConn?.multiactive_key) {
            targetEntry.multiactive_key = true
          }
          targetArray.push(targetEntry)
        }

        if (targetArray.length > 0) {
          columnData.target = targetArray
        }

        // Add to source map
        if (!sourceMap.has(col.source)) {
          sourceMap.set(col.source, [])
        }
        sourceMap.get(col.source)!.push(columnData)
      }

      // Convert map to sources array
      const sourcesForSave: any[] = []
      for (const [sourceName, columns] of sourceMap) {
        sourcesForSave.push({ name: sourceName, columns })
      }

      // All under metadv key
      const updatedData = {
        metadv: {
          targets: targetsForSave,
          sources: sourcesForSave
        }
      }

      console.log('[MetaDV Save] Connections:', connections)
      console.log('[MetaDV Save] Data to save:', JSON.stringify(updatedData, null, 2))

      // Save to backend
      const response = await apiFetch(apiUrl('/api/metadv-save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath, data: updatedData })
      })

      const result = await response.json()

      if (result.success) {
        setSuccessMessage('Saved successfully')
        setHasUnsavedChanges(false)
        setTimeout(() => setSuccessMessage(null), 3000)
      } else {
        setError(result.error || 'Failed to save')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while saving')
    } finally {
      setSaving(false)
    }
  }

  const handleGenerate = async (): Promise<{ success: boolean; generatedFiles: string[] }> => {
    setGenerating(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const response = await apiFetch(apiUrl('/api/metadv-generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath })
      })

      const result = await response.json()

      if (result.success) {
        const fileCount = result.generated_files?.length || 0
        setSuccessMessage(`Generated ${fileCount} SQL model${fileCount !== 1 ? 's' : ''}`)
        setTimeout(() => setSuccessMessage(null), 5000)
        return { success: true, generatedFiles: result.generated_files || [] }
      } else {
        setError(result.error || 'Failed to generate models')
        return { success: false, generatedFiles: [] }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred while generating'
      setError(errorMessage)
      return { success: false, generatedFiles: [] }
    } finally {
      setGenerating(false)
    }
  }

  return {
    data,
    setData,
    loading,
    saving,
    generating,
    error,
    setError,
    successMessage,
    setSuccessMessage,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    initializeAndLoad,
    handleSave,
    handleGenerate
  }
}
