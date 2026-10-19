// Per-browser UI state restored after a page reload (open view, git dialog, scheduler tab and range)

const PREFIX = 'dbt-ui-ui-state:'

export function loadUiState<T>(key: string, fallback: T, isValid: (value: unknown) => boolean = () => true): T {
  try {
    const stored = localStorage.getItem(PREFIX + key)
    if (stored === null) return fallback
    const value = JSON.parse(stored)
    return isValid(value) ? value : fallback
  } catch {
    return fallback
  }
}

export function saveUiState(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the UI works without it
  }
}
