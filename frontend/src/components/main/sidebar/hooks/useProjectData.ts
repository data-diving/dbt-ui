// Hook for loading project data (name, branch, manifest)

import { useState, useEffect } from 'react'
import { apiUrl, apiFetch } from '../../../../config/api'

interface UseProjectDataResult {
  projectName: string
  branchName: string
  manifestMissing: boolean
  loadProjectName: () => Promise<void>
  loadBranchName: () => Promise<void>
  checkManifest: () => Promise<void>
}

export function useProjectData(projectPath: string): UseProjectDataResult {
  const [projectName, setProjectName] = useState<string>('')
  const [branchName, setBranchName] = useState<string>('')
  const [manifestMissing, setManifestMissing] = useState(false)

  const loadProjectName = async () => {
    try {
      const response = await apiFetch(apiUrl('/api/read-file'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: projectPath,
          filePath: 'dbt_project.yml',
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const nameMatch = data.content.match(/^name:\s*['"]?([^'"\n]+)['"]?/m)
        if (nameMatch) {
          setProjectName(nameMatch[1].trim())
        } else {
          setProjectName(projectPath.split('/').pop() || '')
        }
      } else {
        setProjectName(projectPath.split('/').pop() || '')
      }
    } catch (err) {
      console.error('Error loading project name:', err)
      setProjectName(projectPath.split('/').pop() || '')
    }
  }

  const loadBranchName = async () => {
    try {
      const response = await apiFetch(apiUrl('/api/git-branch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath }),
      })

      if (response.ok) {
        const data = await response.json()
        setBranchName(data.branch || '')
      } else {
        setBranchName('')
      }
    } catch (err) {
      console.error('Error loading branch name:', err)
      setBranchName('')
    }
  }

  const checkManifest = async () => {
    try {
      const response = await apiFetch(apiUrl('/api/get-lineage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath }),
      })
      setManifestMissing(response.status === 404)
    } catch (err) {
      console.error('Error checking manifest:', err)
      setManifestMissing(true)
    }
  }

  return {
    projectName,
    branchName,
    manifestMissing,
    loadProjectName,
    loadBranchName,
    checkManifest
  }
}
