// Hook for loading compiled SQL

import { useState } from 'react'
import { apiUrl, apiFetch } from '../../../../config/api'

interface UseCompiledSqlResult {
  compiledSql: string
  setCompiledSql: React.Dispatch<React.SetStateAction<string>>
  loadingCompiled: boolean
  loadCompiledSql: (selectedFile: string, projectPath: string) => Promise<void>
}

export function useCompiledSql(): UseCompiledSqlResult {
  const [compiledSql, setCompiledSql] = useState('')
  const [loadingCompiled, setLoadingCompiled] = useState(false)

  const loadCompiledSql = async (selectedFile: string, projectPath: string) => {
    if (!selectedFile || !projectPath) return

    setLoadingCompiled(true)
    try {
      const response = await apiFetch(apiUrl('/api/get-compiled-sql'), {
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
        setCompiledSql(data.compiled_sql)
      } else {
        const error = await response.json()
        setCompiledSql(`-- ${error.detail || 'Failed to load compiled SQL'}`)
      }
    } catch (err) {
      console.error('Error loading compiled SQL:', err)
      setCompiledSql('-- Error connecting to backend')
    } finally {
      setLoadingCompiled(false)
    }
  }

  return {
    compiledSql,
    setCompiledSql,
    loadingCompiled,
    loadCompiledSql
  }
}
