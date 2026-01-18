import { useState, useEffect } from 'react'
import './GraphView.css'
import { Network, Play, TestTube, Hammer, Variable, ToggleLeft, ToggleRight, ChevronUp, ChevronDown, Minus, Plus, Database } from 'lucide-react'
import LineageGraph from './LineageGraph'
import DbtRunModal from '../dbt/DbtRunModal'
import EnvVarsModal from '../dbt/EnvVarsModal'
import MetaDVModal from '../metadv/MetaDVModal'

interface GraphViewProps {
  projectPath: string | null
  selectedFile: string | null
  onNodeClick: (filePath: string) => void
  compilationTrigger?: number
  isDbtOperationRunning?: boolean
  onDbtRun?: (selector: string, fullRefresh?: boolean) => Promise<void>
  onDbtSeed?: (selector: string, fullRefresh?: boolean) => Promise<void>
  onDbtTest?: (selector: string) => Promise<void>
  onDbtCompile?: (selector: string) => Promise<void>
  hasUnsavedChanges?: boolean
  onCheckUnsavedChanges?: (actionType: string, callback: () => void) => void
  dbtModalOpen?: boolean
  onDbtModalOpenChange?: (open: boolean) => void
  profileTargets?: string[]
  selectedTarget?: string
  onTargetChange?: (target: string) => void
  venvMissing?: boolean
  hasMetaDVPackage?: boolean
  metaDVEnabled?: boolean
  onRefreshTree?: () => void
}

function GraphView({ projectPath, selectedFile, onNodeClick, compilationTrigger, isDbtOperationRunning, onDbtRun, onDbtSeed, onDbtTest, onDbtCompile, hasUnsavedChanges = false, onCheckUnsavedChanges, dbtModalOpen = false, onDbtModalOpenChange, profileTargets = [], selectedTarget = '', onTargetChange, venvMissing = false, hasMetaDVPackage = false, metaDVEnabled = true, onRefreshTree }: GraphViewProps) {
  const [selectedNodeType, setSelectedNodeType] = useState<string | null>(null)
  const [showRunModal, setShowRunModal] = useState(false)
  const [showTestModal, setShowTestModal] = useState(false)
  const [showCompileModal, setShowCompileModal] = useState(false)
  const [showEnvVarsModal, setShowEnvVarsModal] = useState(false)
  const [showMetaDVModal, setShowMetaDVModal] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [isCompileRunning, setIsCompileRunning] = useState(false)
  const [lineageEnabled, setLineageEnabled] = useState(false)
  const [upstreamDepth, setUpstreamDepth] = useState(2)
  const [downstreamDepth, setDownstreamDepth] = useState(2)

  // Reset selectedNodeType when file changes (to clear state from previous lineage clicks)
  useEffect(() => {
    setSelectedNodeType(null)
  }, [selectedFile])

  const isModel = (): boolean => {
    if (!selectedFile) return false
    const isFolder = !selectedFile.includes('.')
    if (isFolder) return false
    return selectedFile.endsWith('.sql') &&
           (selectedFile.includes('/models/') || selectedFile.startsWith('models/'))
  }

  const isSeed = (): boolean => {
    if (!selectedFile) return false
    const isFolder = !selectedFile.includes('.')
    if (isFolder) return false
    return selectedFile.endsWith('.csv') &&
           (selectedFile.includes('/seeds/') || selectedFile.startsWith('seeds/'))
  }

  const getSeedName = (filePath: string | null): string | null => {
    if (!filePath) return null
    const fileName = filePath.split('/').pop() || ''
    return fileName.replace(/\.csv$/, '')
  }

  // Wrapper for onNodeClick to capture node type
  const handleNodeClickInternal = (filePath: string, nodeType?: string) => {
    setSelectedNodeType(nodeType || null)
    onNodeClick(filePath)
  }

  const getModelName = (filePath: string | null): string | null => {
    if (!filePath) return null
    const fileName = filePath.split('/').pop() || ''
    return fileName.replace(/\.sql$/, '')
  }

  const anyLocalModalOpen = showRunModal || showTestModal || showCompileModal
  const hasTargets = profileTargets.length > 0
  const baseConditions = !isDbtOperationRunning && !anyLocalModalOpen && !dbtModalOpen && hasTargets && !venvMissing
  const modelButtonsEnabled = isModel() && baseConditions
  const seedRunEnabled = isSeed() && baseConditions

  const openRunModal = () => {
    if (onDbtModalOpenChange) onDbtModalOpenChange(true)
    setShowRunModal(true)
  }

  const openTestModal = () => {
    if (onDbtModalOpenChange) onDbtModalOpenChange(true)
    setShowTestModal(true)
  }

  const openCompileModal = () => {
    if (onDbtModalOpenChange) onDbtModalOpenChange(true)
    setShowCompileModal(true)
  }

  const handleRunClick = () => {
    if (hasUnsavedChanges && onCheckUnsavedChanges) {
      onCheckUnsavedChanges('running dbt', openRunModal)
    } else {
      openRunModal()
    }
  }

  const handleTestClick = () => {
    if (hasUnsavedChanges && onCheckUnsavedChanges) {
      onCheckUnsavedChanges('testing', openTestModal)
    } else {
      openTestModal()
    }
  }

  const handleCompileClick = () => {
    if (hasUnsavedChanges && onCheckUnsavedChanges) {
      onCheckUnsavedChanges('compiling', openCompileModal)
    } else {
      openCompileModal()
    }
  }

  const handleDbtRun = async (selector: string, fullRefresh?: boolean) => {
    if (!onDbtRun) return
    setIsRunning(true)
    setShowRunModal(false)
    try {
      await onDbtRun(selector, fullRefresh)
    } finally {
      setIsRunning(false)
    }
  }

  const handleDbtSeed = async (selector: string, fullRefresh?: boolean) => {
    if (!onDbtSeed) return
    setIsRunning(true)
    setShowRunModal(false)
    try {
      await onDbtSeed(selector, fullRefresh)
    } finally {
      setIsRunning(false)
    }
  }

  const handleDbtTest = async (selector: string) => {
    if (!onDbtTest) return
    setIsTesting(true)
    setShowTestModal(false)
    try {
      await onDbtTest(selector)
    } finally {
      setIsTesting(false)
    }
  }

  const handleDbtCompile = async (selector: string) => {
    if (!onDbtCompile) return
    setIsCompileRunning(true)
    setShowCompileModal(false)
    try {
      await onDbtCompile(selector)
    } finally {
      setIsCompileRunning(false)
    }
  }

  return (
    <div className="graph-view">
      <div className="graph-header">
        <div className="graph-header-left">
          <Network size={14} />
          <span className="graph-title">Lineage</span>
          <button
            className="lineage-toggle"
            onClick={() => setLineageEnabled(!lineageEnabled)}
            title={lineageEnabled ? "Disable lineage" : "Enable lineage"}
          >
            {lineageEnabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
          </button>
          {lineageEnabled && (
            <>
              <div className="depth-control" title="Upstream depth">
                <ChevronUp size={12} />
                <button
                  className="depth-btn"
                  onClick={() => setUpstreamDepth(Math.max(1, upstreamDepth - 1))}
                  disabled={upstreamDepth <= 1}
                >
                  <Minus size={10} />
                </button>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={upstreamDepth}
                  onChange={(e) => setUpstreamDepth(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                  className="depth-input"
                />
                <button
                  className="depth-btn"
                  onClick={() => setUpstreamDepth(Math.min(10, upstreamDepth + 1))}
                  disabled={upstreamDepth >= 10}
                >
                  <Plus size={10} />
                </button>
              </div>
              <div className="depth-control" title="Downstream depth">
                <ChevronDown size={12} />
                <button
                  className="depth-btn"
                  onClick={() => setDownstreamDepth(Math.max(1, downstreamDepth - 1))}
                  disabled={downstreamDepth <= 1}
                >
                  <Minus size={10} />
                </button>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={downstreamDepth}
                  onChange={(e) => setDownstreamDepth(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                  className="depth-input"
                />
                <button
                  className="depth-btn"
                  onClick={() => setDownstreamDepth(Math.min(10, downstreamDepth + 1))}
                  disabled={downstreamDepth >= 10}
                >
                  <Plus size={10} />
                </button>
              </div>
            </>
          )}
        </div>
        <div className="graph-header-right">
          {profileTargets.length > 0 && (
            <select
              className="target-dropdown"
              value={selectedTarget}
              onChange={(e) => onTargetChange?.(e.target.value)}
              title="Select dbt target"
            >
              {profileTargets.map((target) => (
                <option key={target} value={target}>
                  {target}
                </option>
              ))}
            </select>
          )}
          {!venvMissing && (
            <button
              className="graph-action-button env-vars-button"
              onClick={() => setShowEnvVarsModal(true)}
              disabled={!projectPath || isDbtOperationRunning || dbtModalOpen}
              title="Manage environment variables"
            >
              <Variable size={14} />
              <span>Env Vars</span>
            </button>
          )}
          <button
            className="graph-action-button"
            onClick={handleCompileClick}
            disabled={!modelButtonsEnabled}
            title="Compile model"
          >
            <Hammer size={14} />
            <span>Compile</span>
          </button>
          <button
            className="graph-action-button"
            onClick={handleRunClick}
            disabled={!modelButtonsEnabled && !seedRunEnabled}
            title={isSeed() ? "Run seed" : "Run model"}
          >
            <Play size={14} />
            <span>Run</span>
          </button>
          <button
            className="graph-action-button"
            onClick={handleTestClick}
            disabled={!modelButtonsEnabled}
            title="Test model"
          >
            <TestTube size={14} />
            <span>Test</span>
          </button>
          {metaDVEnabled && (
            <button
              className={`graph-action-button metadv-button ${hasMetaDVPackage ? '' : 'disabled-hint'}`}
              onClick={() => setShowMetaDVModal(true)}
              disabled={!hasMetaDVPackage || !projectPath}
              title={!hasMetaDVPackage
                ? "MetaDV requires the Datavault-UK/automate_dv package. Add it to packages.yml and run dbt deps."
                : "Open MetaDV - Metadata"}
            >
              <Database size={14} />
              <span>MetaDV</span>
            </button>
          )}
        </div>
      </div>
      <div className="graph-content">
        <LineageGraph
          projectPath={projectPath}
          selectedFile={selectedFile}
          onNodeClick={handleNodeClickInternal}
          compilationTrigger={compilationTrigger}
          venvMissing={venvMissing}
          enabled={lineageEnabled}
          upstreamDepth={upstreamDepth}
          downstreamDepth={downstreamDepth}
        />
      </div>
      {showRunModal && (
        <DbtRunModal
          onClose={() => {
            setShowRunModal(false)
            // User cancelled - re-enable buttons
            if (onDbtModalOpenChange) onDbtModalOpenChange(false)
          }}
          onRun={isSeed() ? handleDbtSeed : handleDbtRun}
          isRunning={isRunning}
          initialSelector={isSeed() ? (getSeedName(selectedFile) || '') : (getModelName(selectedFile) || '')}
          target={selectedTarget}
          mode={isSeed() ? 'seed' : 'run'}
        />
      )}
      {showTestModal && (
        <DbtRunModal
          onClose={() => {
            setShowTestModal(false)
            // User cancelled - re-enable buttons
            if (onDbtModalOpenChange) onDbtModalOpenChange(false)
          }}
          onRun={handleDbtTest}
          isRunning={isTesting}
          initialSelector={getModelName(selectedFile) || ''}
          mode="test"
          target={selectedTarget}
        />
      )}
      {showCompileModal && (
        <DbtRunModal
          onClose={() => {
            setShowCompileModal(false)
            // User cancelled - re-enable buttons
            if (onDbtModalOpenChange) onDbtModalOpenChange(false)
          }}
          onRun={handleDbtCompile}
          target={selectedTarget}
          isRunning={isCompileRunning}
          initialSelector={getModelName(selectedFile) || ''}
          mode="compile"
        />
      )}
      {showEnvVarsModal && projectPath && (
        <EnvVarsModal
          projectPath={projectPath}
          onClose={() => setShowEnvVarsModal(false)}
          onFileClick={(filePath) => {
            setShowEnvVarsModal(false)
            onNodeClick(filePath)
          }}
        />
      )}
      {showMetaDVModal && projectPath && (
        <MetaDVModal
          projectPath={projectPath}
          onClose={() => {
            setShowMetaDVModal(false)
            // Refresh tree in case files were generated
            onRefreshTree?.()
          }}
          selectedDbtTarget={selectedTarget}
          onRefreshTree={onRefreshTree}
        />
      )}
    </div>
  )
}

export default GraphView
