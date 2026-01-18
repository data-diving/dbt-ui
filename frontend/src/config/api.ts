/**
 * API Configuration
 *
 * The API base URL can be configured via the VITE_API_URL environment variable.
 * If not set, it defaults to 'http://localhost:8000'.
 *
 * Examples:
 * - Development: VITE_API_URL=http://localhost:8000 (default)
 * - Docker/Production with nginx proxy: VITE_API_URL= (empty, uses relative URLs)
 * - Custom backend: VITE_API_URL=https://api.example.com
 *
 * Authentication:
 * - VITE_API_USER and VITE_API_PASSWORD can be set for Basic Auth
 * - If both are set, all API requests will include Authorization header
 */

// Use empty string for relative URLs (when behind a proxy like nginx)
// Defaults to localhost:8000 for local development
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

// Authentication credentials (optional)
const API_USER = import.meta.env.VITE_API_USER ?? ''
const API_PASSWORD = import.meta.env.VITE_API_PASSWORD ?? ''

/**
 * Get authentication headers if credentials are configured
 * @returns Object with Authorization header or empty object
 */
export function getAuthHeaders(): Record<string, string> {
  if (API_USER && API_PASSWORD) {
    const credentials = btoa(`${API_USER}:${API_PASSWORD}`)
    return { Authorization: `Basic ${credentials}` }
  }
  return {}
}

/**
 * Construct a full API URL from an endpoint path
 * @param endpoint - The API endpoint (e.g., '/api/read-file')
 * @returns Full URL with base URL prepended (or relative URL if API_BASE_URL is empty)
 */
export function apiUrl(endpoint: string): string {
  // Ensure endpoint starts with /
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  return `${API_BASE_URL}${normalizedEndpoint}`
}

/**
 * Wrapper around fetch that automatically adds authentication headers
 * @param input - URL or Request object
 * @param init - Optional fetch init options
 * @returns Promise<Response>
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const authHeaders = getAuthHeaders()
  const mergedInit: RequestInit = {
    ...init,
    headers: {
      ...authHeaders,
      ...init?.headers,
    },
  }
  return fetch(input, mergedInit)
}

// Git credential API helpers

export interface GitAuthResult {
  success: boolean
  data?: any
  authRequired?: boolean
  storedUsername?: string
  error?: string
}

/**
 * Clone a git repository with optional credentials
 */
export async function cloneGitRepo(
  gitUrl: string,
  options: {
    username?: string
    password?: string
    saveCredentials?: boolean
    useStored?: boolean
  } = {}
): Promise<GitAuthResult> {
  try {
    const response = await apiFetch(apiUrl('/api/clone-git-repo'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        git_url: gitUrl,
        username: options.username || '',
        password: options.password || '',
        save_credentials: options.saveCredentials ?? true,
        use_stored: options.useStored ?? false,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      const detail = errorData.detail
      if (detail === 'AUTH_REQUIRED' || detail?.code === 'AUTH_REQUIRED') {
        return {
          success: false,
          authRequired: true,
          storedUsername: detail?.stored_username || '',
        }
      }
      return {
        success: false,
        error: typeof detail === 'string' ? detail : detail?.message || 'Failed to clone Git repository',
      }
    }

    const data = await response.json()
    return { success: true, data }
  } catch (err) {
    return { success: false, error: 'Failed to connect to backend server.' }
  }
}

/**
 * Git push with optional credentials
 */
export async function gitPush(
  projectPath: string,
  options: {
    username?: string
    password?: string
    saveCredentials?: boolean
    useStored?: boolean
  } = {}
): Promise<GitAuthResult> {
  try {
    const response = await apiFetch(apiUrl('/api/git-push'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        path: projectPath,
        username: options.username || '',
        password: options.password || '',
        save_credentials: options.saveCredentials ?? true,
        use_stored: options.useStored ?? false,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      const detail = errorData.detail
      if (detail === 'AUTH_REQUIRED' || detail?.code === 'AUTH_REQUIRED') {
        return {
          success: false,
          authRequired: true,
          storedUsername: detail?.stored_username || '',
        }
      }
      return {
        success: false,
        error: typeof detail === 'string' ? detail : detail?.message || 'Failed to push',
      }
    }

    const data = await response.json()
    return { success: true, data }
  } catch (err) {
    return { success: false, error: 'Failed to push' }
  }
}

/**
 * Git pull with optional credentials
 */
export async function gitPull(
  projectPath: string,
  options: {
    username?: string
    password?: string
    saveCredentials?: boolean
    useStored?: boolean
  } = {}
): Promise<GitAuthResult> {
  try {
    const response = await apiFetch(apiUrl('/api/git-pull'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        path: projectPath,
        username: options.username || '',
        password: options.password || '',
        save_credentials: options.saveCredentials ?? true,
        use_stored: options.useStored ?? false,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      const detail = errorData.detail
      if (detail === 'AUTH_REQUIRED' || detail?.code === 'AUTH_REQUIRED') {
        return {
          success: false,
          authRequired: true,
          storedUsername: detail?.stored_username || '',
        }
      }
      return {
        success: false,
        error: typeof detail === 'string' ? detail : detail?.message || 'Failed to pull',
      }
    }

    const data = await response.json()
    return { success: true, data }
  } catch (err) {
    return { success: false, error: 'Failed to pull' }
  }
}
