import { useState, useEffect, useRef } from 'react'
// @ts-expect-error - react-split-pane has no type definitions
import { SplitPane, Pane } from 'react-split-pane'
import 'react-split-pane/styles.css'
import './MainLayout.css'
import Sidebar from './Sidebar'
import Editor from '../editor/Editor'
import GraphView from '../editor/GraphView'
import MetadataSidebar from '../editor/MetadataSidebar'
import LogResultModal from './LogResultModal'
import UnsavedChangesModal from './UnsavedChangesModal'
import ConfirmModal from './ConfirmModal'
import { PanelLeftOpen } from 'lucide-react'
import { apiUrl, apiFetch } from '../../config/api'

interface OperationResult {
  success: boolean
  title: string
  message: string
  output: string
}

interface MainLayoutProps {
  projectPath: string
  dbtVersion: string
  onChangeProject: () => void
}

function MainLayout({ projectPath, dbtVersion: initialDbtVersion, onChangeProject }: MainLayoutProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [showMetadata, setShowMetadata] = useState(true)
  const [compilationTrigger, setCompilationTrigger] = useState(0)
  const [refreshTrigger, setRefreshTrigger] = useState(0)  // Triggers sidebar tree refresh
  const [compilingModels, setCompilingModels] = useState<Set<string>>(new Set())
  const [isDbtOperationRunning, setIsDbtOperationRunning] = useState(false)
  const [modifiedFiles, setModifiedFiles] = useState<Set<string>>(new Set())
  const [venvMissing, setVenvMissing] = useState(false)
  const [dbtVersion, setDbtVersion] = useState(initialDbtVersion)
  const [operationResult, setOperationResult] = useState<OperationResult | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showUnsavedChangesModal, setShowUnsavedChangesModal] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ type: string; callback: () => void } | null>(null)
  const [showRecreateVenvModal, setShowRecreateVenvModal] = useState(false)
  const [isRecreatingVenv, setIsRecreatingVenv] = useState(false)
  const [dbtModalOpen, setDbtModalOpen] = useState(false)
  const [profileTargets, setProfileTargets] = useState<string[]>([])
  const [selectedTarget, setSelectedTarget] = useState<string>('')
  const [hasMetaDVPackage, setHasMetaDVPackage] = useState(false)
  const [metaDVEnabled, setMetaDVEnabled] = useState(true)
  const saveRef = useRef<(() => Promise<void>) | null>(null)

  // Get list of models affected by a selector using dbt ls
  const getAffectedModels = async (selector: string): Promise<string[]> => {
    try {
      const response = await apiFetch(apiUrl('/api/dbt-ls'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ path: projectPath, selector }),
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success && data.models) {
          console.log('[MainLayout] dbt ls returned models:', data.models)
          return data.models
        }
      }
    } catch (err) {
      console.error('[MainLayout] Error running dbt ls:', err)
    }
    // Fallback: if selector is provided and looks like a model name, use it
    if (selector && !selector.includes(':') && !selector.includes('+') && !selector.includes('@')) {
      return [selector]
    }
    return []
  }

  // Check if venv exists on load and get dbt version
  const checkVenvStatus = async () => {
    try {
      const response = await apiFetch(apiUrl('/api/check-venv'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath }),
      })

      if (response.ok) {
        const data = await response.json()
        setVenvMissing(!data.venv_exists || !data.dbt_installed)
        if (data.dbt_version) {
          setDbtVersion(data.dbt_version)
        }
      }
    } catch (err) {
      console.error('[MainLayout] Error checking venv status:', err)
    }
  }

  // Check if MetaDV package is installed and feature is enabled
  const checkMetaDVPackage = async () => {
    try {
      const response = await apiFetch(apiUrl('/api/check-metadv-package'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath }),
      })

      if (response.ok) {
        const data = await response.json()
        setHasMetaDVPackage(data.has_metadv_package || false)
        setMetaDVEnabled(data.metadv_enabled !== false)
        console.log('[MainLayout] MetaDV check:', { package: data.has_metadv_package, enabled: data.metadv_enabled })
      }
    } catch (err) {
      console.error('[MainLayout] Error checking MetaDV package:', err)
      setHasMetaDVPackage(false)
    }
  }

  // Load profile targets from profiles.yml
  const loadProfileTargets = async () => {
    try {
      const response = await apiFetch(apiUrl('/api/get-profile-targets'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath }),
      })

      if (response.ok) {
        const data = await response.json()
        if (data.targets && data.targets.length > 0) {
          setProfileTargets(data.targets)
          // Set default target
          if (data.default_target && data.targets.includes(data.default_target)) {
            setSelectedTarget(data.default_target)
          } else {
            setSelectedTarget(data.targets[0])
          }
          console.log('[MainLayout] Loaded profile targets:', data.targets, 'default:', data.default_target)
        } else {
          console.log('[MainLayout] No profile targets found:', data.error || 'unknown error')
          setProfileTargets([])
          setSelectedTarget('')
        }
      }
    } catch (err) {
      console.error('[MainLayout] Error loading profile targets:', err)
      setProfileTargets([])
      setSelectedTarget('')
    }
  }

  useEffect(() => {
    if (projectPath) {
      checkVenvStatus()
      loadProfileTargets()
      checkMetaDVPackage()
    }
  }, [projectPath])

  // Handler for when a file is saved - refresh dependent data
  const handleFileSaved = (filePath: string) => {
    // Refresh profile targets when profiles.yml is saved
    if (filePath.endsWith('profiles.yml')) {
      console.log('[MainLayout] profiles.yml saved, refreshing targets')
      loadProfileTargets()
    }
    // Refresh MetaDV package check when packages.yml or dependencies.yml is saved
    if (filePath.endsWith('packages.yml') || filePath.endsWith('dependencies.yml')) {
      console.log('[MainLayout] packages file saved, checking MetaDV package')
      checkMetaDVPackage()
    }
  }

  const handleFileModified = (filePath: string, isModified: boolean) => {
    setModifiedFiles((prev: Set<string>) => {
      const newSet = new Set(prev)
      if (isModified) {
        newSet.add(filePath)
      } else {
        newSet.delete(filePath)
      }
      return newSet
    })
    // Refresh git modified files to get the actual git status
    loadGitModifiedFiles()
  }

  const handleRecreateVenvClick = () => {
    setShowRecreateVenvModal(true)
  }

  const handleRecreateVenvConfirm = async () => {
    setShowRecreateVenvModal(false)
    setIsRecreatingVenv(true)

    try {
      const response = await apiFetch(apiUrl('/api/recreate-venv'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: projectPath }),
      })

      if (response.ok) {
        const result = await response.json()
        console.log('[MainLayout] Virtual environment created:', result)
        setVenvMissing(false)
        if (result.dbt_version) {
          setDbtVersion(result.dbt_version)
        }
        // Refresh sidebar tree to show any new files (e.g., .dbt-ui-venv folder)
        setRefreshTrigger((prev: number) => prev + 1)
        // Refresh MetaDV package check (package may now be available after dbt deps)
        checkMetaDVPackage()
        setOperationResult({
          success: true,
          title: 'Virtual environment created',
          message: 'The virtual environment was created successfully.',
          output: result.output || ''
        })
      } else {
        const error = await response.json()
        console.error('[MainLayout] Failed to create venv:', error)
        // Handle both string detail and object detail (with message and output)
        const detail = error.detail
        const errorMessage = typeof detail === 'object' ? detail.message : (detail || 'An error occurred')
        const errorOutput = typeof detail === 'object' ? detail.output : (error.output || '')
        setVenvMissing(true)
        setOperationResult({
          success: false,
          title: 'Failed to create virtual environment',
          message: errorMessage,
          output: errorOutput
        })
      }
    } catch (err) {
      console.error('[MainLayout] Error creating venv:', err)
      setVenvMissing(true)
      setOperationResult({
        success: false,
        title: 'Error creating virtual environment',
        message: 'An unexpected error occurred',
        output: String(err)
      })
    } finally {
      setIsRecreatingVenv(false)
      loadProfileTargets()
    }
  }

  // Unified dbt command handler - all commands run in background
  const handleDbtCommand = async (command: string, selector: string, fullRefresh?: boolean): Promise<void> => {
    setIsDbtOperationRunning(true)

    // Get affected models and show spinners (except for seed which doesn't have model spinners)
    if (command !== 'seed') {
      const models = await getAffectedModels(selector)
      if (models.length > 0) {
        setCompilingModels(new Set(models))
      }
    }

    try {
      const response = await apiFetch(apiUrl('/api/dbt-command'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          path: projectPath,
          command: command,
          selector: selector,
          target: selectedTarget,
          full_refresh: fullRefresh || false,
        }),
      })

      if (!response.ok) {
        const result = await response.json()
        console.error(`[MainLayout] dbt ${command} failed to start:`, result)
        setCompilingModels(new Set())
        setDbtModalOpen(false)
        setIsDbtOperationRunning(false)
        setOperationResult({
          success: false,
          title: `dbt ${command} failed`,
          message: result.detail || `${command} failed to start`,
          output: ''
        })
        return
      }

      // Start polling for command status
      pollForCommandStatus(command)
    } catch (err) {
      console.error(`[MainLayout] Error running dbt ${command}:`, err)
      setCompilingModels(new Set())
      setDbtModalOpen(false)
      setIsDbtOperationRunning(false)
      setOperationResult({
        success: false,
        title: `dbt ${command} error`,
        message: 'Error connecting to backend',
        output: String(err)
      })
    }
  }

  const handleDbtRun = async (selector: string, fullRefresh?: boolean): Promise<void> => {
    await handleDbtCommand('run', selector, fullRefresh)
  }

  const handleDbtSeed = async (selector: string, fullRefresh?: boolean): Promise<void> => {
    await handleDbtCommand('seed', selector, fullRefresh)
  }

  const handleDbtTest = async (selector: string): Promise<void> => {
    await handleDbtCommand('test', selector)
  }

  const handleDbtCompileModel = async (selector: string): Promise<void> => {
    await handleDbtCommand('compile', selector)
  }

  // Handler to check for unsaved changes before performing an action
  const checkUnsavedChangesAndProceed = (actionType: string, callback: () => void) => {
    if (hasUnsavedChanges) {
      setPendingAction({ type: actionType, callback })
      setShowUnsavedChangesModal(true)
    } else {
      callback()
    }
  }

  const handleUnsavedChangesClose = () => {
    setShowUnsavedChangesModal(false)
    setPendingAction(null)
  }

  const handleUnsavedChangesSave = async () => {
    if (saveRef.current) {
      await saveRef.current()
    }
    setShowUnsavedChangesModal(false)
    if (pendingAction) {
      pendingAction.callback()
      setPendingAction(null)
    }
  }

  const handleUnsavedChangesDiscard = () => {
    setShowUnsavedChangesModal(false)
    if (pendingAction) {
      pendingAction.callback()
      setPendingAction(null)
    }
  }

  const pollForCommandStatus = (command: string) => {
    let attempts = 0
    const maxAttempts = 120 // Poll for up to 2 minutes
    const pollInterval = 1000 // Check every 1 second

    const checkStatus = () => {
      attempts++

      // Check dbt command status
      apiFetch(apiUrl('/api/dbt-command-status'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath }),
      })
        .then(response => response.json())
        .then(statusData => {
          console.log(`[MainLayout] dbt ${command} status:`, statusData)

          if (statusData.status === 'success') {
            // Command succeeded!
            console.log(`[MainLayout] dbt ${command} successful`)
            setCompilingModels(new Set())
            setDbtModalOpen(false)
            // Trigger compilation refresh for compile/seed commands
            if (command === 'compile' || command === 'seed') {
              setCompilationTrigger((prev: number) => prev + 1)
            }
            // Refresh sidebar tree for all commands (files may have changed in target/)
            setRefreshTrigger((prev: number) => prev + 1)
            setIsDbtOperationRunning(false)
            // Show success modal with output
            setOperationResult({
              success: true,
              title: `dbt ${command} completed`,
              message: `${command} completed successfully`,
              output: statusData.output || ''
            })
          } else if (statusData.status === 'failed') {
            // Command failed
            console.error(`[MainLayout] dbt ${command} failed:`, statusData.error)
            setCompilingModels(new Set())
            setDbtModalOpen(false)
            setIsDbtOperationRunning(false)
            // Show failure modal with error
            setOperationResult({
              success: false,
              title: `dbt ${command} failed`,
              message: `${command} failed`,
              output: statusData.error || ''
            })
          } else if (statusData.status === 'running') {
            // Still running, keep polling
            if (attempts < maxAttempts) {
              setTimeout(checkStatus, pollInterval)
            } else {
              // Timeout
              console.error(`[MainLayout] dbt ${command} timed out`)
              setCompilingModels(new Set())
              setDbtModalOpen(false)
              setIsDbtOperationRunning(false)
              setOperationResult({
                success: false,
                title: `dbt ${command} timeout`,
                message: `${command} timed out after 2 minutes`,
                output: ''
              })
            }
          } else {
            // not_started or unknown status, keep polling
            if (attempts < maxAttempts) {
              setTimeout(checkStatus, pollInterval)
            } else {
              setCompilingModels(new Set())
              setDbtModalOpen(false)
              setIsDbtOperationRunning(false)
            }
          }
        })
        .catch(err => {
          console.error(`[MainLayout] Error checking dbt ${command} status:`, err)
          if (attempts < maxAttempts) {
            setTimeout(checkStatus, pollInterval)
          } else {
            setCompilingModels(new Set())
            setDbtModalOpen(false)
            setIsDbtOperationRunning(false)
          }
        })
    }

    checkStatus()
  }

  // Function to load git-modified files
  const loadGitModifiedFiles = async () => {
    try {
      const response = await apiFetch(apiUrl('/api/git-modified-files'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: projectPath }),
      })

      if (response.ok) {
        const data = await response.json()
        const modifiedSet = new Set<string>(data.modified_files)
        setModifiedFiles(modifiedSet)
        console.log('[MainLayout] Loaded git modified files:', data.modified_files)
      }
    } catch (err) {
      console.error('[MainLayout] Error loading git modified files:', err)
    }
  }

  // Load git-modified files when project loads
  useEffect(() => {
    if (projectPath) {
      loadGitModifiedFiles()
    }
  }, [projectPath])

  // Track last seen completion ID to detect when operations finish
  const lastSeenCompletionIdRef = useRef<string | null>(null)

  // Poll dbt operation status every 2 seconds to detect operations started by other users
  // This enables multi-user conflict prevention - when another user starts an operation,
  // this user's UI will be updated to show the operation is running
  useEffect(() => {
    if (!projectPath) return

    const pollOperationStatus = async () => {
      try {
        const response = await apiFetch(apiUrl('/api/dbt-operation-status'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: projectPath }),
        })
        if (response.ok) {
          const data = await response.json()
          setIsDbtOperationRunning(data.is_running)

          // Check if a new operation completed (detected by new completion ID)
          // This allows other users to refresh their state when an operation finishes
          if (data.last_completion_id && data.last_completion_id !== lastSeenCompletionIdRef.current) {
            const previousId = lastSeenCompletionIdRef.current
            lastSeenCompletionIdRef.current = data.last_completion_id

            // Only refresh if we had a previous ID (not on initial load)
            if (previousId !== null && data.last_completed_operation) {
              // Refresh venv status and profile targets for any operation
              checkVenvStatus()
              loadProfileTargets()
              // Trigger lineage graph refresh to update compile button glow status
              setCompilationTrigger((prev: number) => prev + 1)
              // Trigger sidebar tree refresh for all expanded folders
              setRefreshTrigger((prev: number) => prev + 1)
            }
          }
        }
      } catch (err) {
        console.error('[MainLayout] Error polling operation status:', err)
      }
    }

    // Check immediately on mount
    pollOperationStatus()

    // Poll continuously every 2 seconds to detect operations from other users
    const intervalId = setInterval(pollOperationStatus, 2000)
    return () => clearInterval(intervalId)
  }, [projectPath])

  // Removed auto-compile - user can manually trigger with the compile button
  // This prevents compilation from blocking file loading and other operations

  // Combine dbt operation running state with venv recreation state
  const isOperationRunning = isDbtOperationRunning || isRecreatingVenv

  return (
    <div className="main-layout">
      {!showSidebar && (
        <button
          className="sidebar-toggle-btn"
          onClick={() => setShowSidebar(true)}
          title="Show sidebar"
        >
          <PanelLeftOpen size={16} />
        </button>
      )}
      {showSidebar ? (
        <SplitPane direction="horizontal">
          <Pane minSize="200px" maxSize="600px" defaultSize="300px">
            <Sidebar
              projectPath={projectPath}
              onFileSelect={setSelectedFile}
              selectedFile={selectedFile}
              onToggle={() => setShowSidebar(false)}
              onChangeProject={onChangeProject}
              onCompile={handleDbtCompileModel}
              compilationTrigger={compilationTrigger}
              refreshTrigger={refreshTrigger}
              isDbtOperationRunning={isOperationRunning}
              compilingModels={compilingModels}
              modifiedFiles={modifiedFiles}
              onRefreshModifiedFiles={loadGitModifiedFiles}
              onRecreateVenv={handleRecreateVenvClick}
              onDbtRun={handleDbtRun}
              venvMissing={venvMissing}
              hasUnsavedChanges={hasUnsavedChanges}
              onCheckUnsavedChanges={checkUnsavedChangesAndProceed}
              dbtModalOpen={dbtModalOpen}
              onDbtModalOpenChange={setDbtModalOpen}
              selectedTarget={selectedTarget}
              onPackagesFileChanged={checkMetaDVPackage}
            />
          </Pane>
          <Pane>
            <SplitPane direction="vertical">
              <Pane defaultSize="60%" minSize="200px">
                {showMetadata ? (
                  <SplitPane direction="horizontal" primary="second">
                    <Pane>
                      <Editor
                        selectedFile={selectedFile}
                        projectPath={projectPath}
                        onToggleMetadata={() => setShowMetadata(!showMetadata)}
                        showMetadata={showMetadata}
                        onToggleSidebar={() => setShowSidebar(!showSidebar)}
                        showSidebar={showSidebar}
                        compilationTrigger={compilationTrigger}
                        onFileModified={handleFileModified}
                        onFileSaved={handleFileSaved}
                        dbtVersion={dbtVersion}
                        onUnsavedChangesStateChange={setHasUnsavedChanges}
                        saveRef={saveRef}
                      />
                    </Pane>
                    <Pane minSize="150px" maxSize="400px" defaultSize="270px">
                      <MetadataSidebar
                        selectedFile={selectedFile}
                        projectPath={projectPath}
                        compilationTrigger={compilationTrigger}
                      />
                    </Pane>
                  </SplitPane>
                ) : (
                  <Editor
                    selectedFile={selectedFile}
                    projectPath={projectPath}
                    onToggleMetadata={() => setShowMetadata(!showMetadata)}
                    showMetadata={showMetadata}
                    onToggleSidebar={() => setShowSidebar(!showSidebar)}
                    showSidebar={showSidebar}
                    compilationTrigger={compilationTrigger}
                    onFileModified={handleFileModified}
                    onFileSaved={handleFileSaved}
                    onUnsavedChangesStateChange={setHasUnsavedChanges}
                    saveRef={saveRef}
                  />
                )}
              </Pane>
              <Pane minSize="200px">
                <GraphView
                  projectPath={projectPath}
                  selectedFile={selectedFile}
                  onNodeClick={setSelectedFile}
                  compilationTrigger={compilationTrigger}
                  isDbtOperationRunning={isOperationRunning}
                  onDbtRun={handleDbtRun}
                  onDbtSeed={handleDbtSeed}
                  onDbtTest={handleDbtTest}
                  onDbtCompile={handleDbtCompileModel}
                  hasUnsavedChanges={hasUnsavedChanges}
                  onCheckUnsavedChanges={checkUnsavedChangesAndProceed}
                  dbtModalOpen={dbtModalOpen}
                  onDbtModalOpenChange={setDbtModalOpen}
                  profileTargets={profileTargets}
                  selectedTarget={selectedTarget}
                  onTargetChange={setSelectedTarget}
                  venvMissing={venvMissing}
                  hasMetaDVPackage={hasMetaDVPackage}
                  metaDVEnabled={metaDVEnabled}
                  onRefreshTree={() => setRefreshTrigger((prev: number) => prev + 1)}
                />
              </Pane>
            </SplitPane>
          </Pane>
        </SplitPane>
      ) : (
        <SplitPane direction="vertical">
          <Pane defaultSize="60%" minSize="200px">
            {showMetadata ? (
              <SplitPane direction="horizontal" primary="second">
                <Pane>
                  <Editor
                    selectedFile={selectedFile}
                    projectPath={projectPath}
                    onToggleMetadata={() => setShowMetadata(!showMetadata)}
                    showMetadata={showMetadata}
                    onToggleSidebar={() => setShowSidebar(!showSidebar)}
                    showSidebar={showSidebar}
                    compilationTrigger={compilationTrigger}
                    onFileModified={handleFileModified}
                    onFileSaved={handleFileSaved}
                    onUnsavedChangesStateChange={setHasUnsavedChanges}
                    saveRef={saveRef}
                  />
                </Pane>
                <Pane minSize="150px" maxSize="400px" defaultSize="270px">
                  <MetadataSidebar
                    selectedFile={selectedFile}
                    projectPath={projectPath}
                    compilationTrigger={compilationTrigger}
                  />
                </Pane>
              </SplitPane>
            ) : (
              <Editor
                selectedFile={selectedFile}
                projectPath={projectPath}
                onToggleMetadata={() => setShowMetadata(!showMetadata)}
                showMetadata={showMetadata}
                onToggleSidebar={() => setShowSidebar(!showSidebar)}
                showSidebar={showSidebar}
                compilationTrigger={compilationTrigger}
                onFileModified={handleFileModified}
                onFileSaved={handleFileSaved}
                onUnsavedChangesStateChange={setHasUnsavedChanges}
                saveRef={saveRef}
              />
            )}
          </Pane>
          <Pane minSize="200px">
            <GraphView
              projectPath={projectPath}
              selectedFile={selectedFile}
              onNodeClick={setSelectedFile}
              compilationTrigger={compilationTrigger}
              isDbtOperationRunning={isOperationRunning}
              onDbtRun={handleDbtRun}
              onDbtSeed={handleDbtSeed}
              onDbtTest={handleDbtTest}
              onDbtCompile={handleDbtCompileModel}
              hasUnsavedChanges={hasUnsavedChanges}
              onCheckUnsavedChanges={checkUnsavedChangesAndProceed}
              dbtModalOpen={dbtModalOpen}
              onDbtModalOpenChange={setDbtModalOpen}
              profileTargets={profileTargets}
              selectedTarget={selectedTarget}
              onTargetChange={setSelectedTarget}
              venvMissing={venvMissing}
              hasMetaDVPackage={hasMetaDVPackage}
              metaDVEnabled={metaDVEnabled}
              onRefreshTree={() => setRefreshTrigger((prev: number) => prev + 1)}
            />
          </Pane>
        </SplitPane>
      )}
      {showUnsavedChangesModal && pendingAction && (
        <UnsavedChangesModal
          onClose={handleUnsavedChangesClose}
          onSave={handleUnsavedChangesSave}
          onDiscard={handleUnsavedChangesDiscard}
          action={pendingAction.type}
        />
      )}
      {operationResult && (
        <LogResultModal
          onClose={() => setOperationResult(null)}
          success={operationResult.success}
          title={operationResult.title}
          message={operationResult.message}
          output={operationResult.output}
        />
      )}
      {showRecreateVenvModal && (
        <ConfirmModal
          onClose={() => setShowRecreateVenvModal(false)}
          onConfirm={handleRecreateVenvConfirm}
          title="Create virtual environment"
          message="This will create a new virtual environment with dbt installed. This may take a few minutes."
          confirmLabel="Create"
          cancelLabel="Cancel"
          variant="warning"
        />
      )}
    </div>
  )
}

export default MainLayout
