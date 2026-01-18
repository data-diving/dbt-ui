// GitModal component types

export const GIT_CONFIG_KEY = 'dbt-ui-git-config'

export interface GitConfig {
  userName: string
  userEmail: string
}

export interface GitModalProps {
  projectPath: string
  onClose: () => void
  onBranchChange?: () => void
  onGitChange?: () => void
  onTreeRefresh?: () => void
}

export interface GitStatus {
  modified: string[]
  deleted: string[]
  untracked: string[]
}

export interface ChangedFile {
  file: string
  type: 'modified' | 'deleted' | 'untracked'
}

export interface BranchState {
  currentBranch: string
  branches: string[]
  defaultBranch: string
  worktreeBranches: string[]
  userDefaultBranch: string
}

export interface RemoteState {
  hasRemote: boolean
  ahead: number
  behind: number
}

// Get git config from localStorage
export const getGitConfig = (): GitConfig | null => {
  try {
    const stored = localStorage.getItem(GIT_CONFIG_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (e) {
    console.error('Failed to parse git config:', e)
  }
  return null
}
