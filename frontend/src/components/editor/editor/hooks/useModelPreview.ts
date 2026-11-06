// Hook for model preview (dbt show)

import { useState, useRef } from 'react'
import { apiUrl, apiFetch } from '../../../../config/api'
import { ModelPreviewData } from '../types'

interface UseModelPreviewResult {
  modelPreview: ModelPreviewData | null
  setModelPreview: React.Dispatch<React.SetStateAction<ModelPreviewData | null>>
  loadingPreview: boolean
  showPreviewConfirm: boolean
  setShowPreviewConfirm: React.Dispatch<React.SetStateAction<boolean>>
  previewCache: React.MutableRefObject<Map<string, ModelPreviewData>>
  loadModelPreview: (selectedFile: string, projectPath: string, target?: string) => Promise<void>
}

// Previews are cached per target and file: switching the target must not show another target's data
export function previewCacheKey(target: string, selectedFile: string): string {
  return `${target}::${selectedFile}`
}

export function useModelPreview(): UseModelPreviewResult {
  const [modelPreview, setModelPreview] = useState<ModelPreviewData | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [showPreviewConfirm, setShowPreviewConfirm] = useState(false)
  const previewCache = useRef<Map<string, ModelPreviewData>>(new Map())

  const loadModelPreview = async (selectedFile: string, projectPath: string, target = '') => {
    if (!selectedFile || !projectPath) return

    const modelName = selectedFile.split('/').pop()?.replace('.sql', '') || ''
    if (!modelName) return

    setLoadingPreview(true)

    try {
      const displayLimit = 10
      const fetchLimit = displayLimit + 1

      const response = await apiFetch(apiUrl('/api/dbt-show-model'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          path: projectPath,
          model: modelName,
          limit: fetchLimit,
          target
        }),
      })

      let previewData: ModelPreviewData

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          const hasMore = data.rows.length > displayLimit
          const displayRows = hasMore ? data.rows.slice(0, displayLimit) : data.rows
          previewData = {
            columns: data.columns,
            rows: displayRows,
            hasMore
          }
        } else {
          previewData = {
            columns: [],
            rows: [],
            error: data.error || 'Failed to load preview'
          }
        }
      } else {
        const error = await response.json()
        previewData = {
          columns: [],
          rows: [],
          error: error.detail || 'Failed to load preview'
        }
      }

      previewCache.current.set(previewCacheKey(target, selectedFile), previewData)
      setModelPreview(previewData)
    } catch (err) {
      console.error('Error loading model preview:', err)
      const errorData: ModelPreviewData = {
        columns: [],
        rows: [],
        error: 'Error connecting to backend'
      }
      previewCache.current.set(previewCacheKey(target, selectedFile), errorData)
      setModelPreview(errorData)
    } finally {
      setLoadingPreview(false)
    }
  }

  return {
    modelPreview,
    setModelPreview,
    loadingPreview,
    showPreviewConfirm,
    setShowPreviewConfirm,
    previewCache,
    loadModelPreview
  }
}
