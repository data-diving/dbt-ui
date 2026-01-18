import { useEffect, useState, useMemo, useCallback, memo } from 'react'
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  useReactFlow,
  ReactFlowProvider,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from 'dagre'
import { PackageOpen } from 'lucide-react'
import './LineageGraph.css'
import { apiUrl, apiFetch } from '../../config/api'

// Maximum nodes to render to prevent browser crashes
// Can be configured via VITE_DBT_UI__FRONTEND_LINEAGE_MAX_NODES environment variable
const MAX_NODES = parseInt(import.meta.env.VITE_DBT_UI__FRONTEND_LINEAGE_MAX_NODES ?? '200', 10)

interface LineageGraphProps {
  projectPath: string | null
  selectedFile: string | null
  onNodeClick: (filePath: string, nodeType?: string) => void
  compilationTrigger?: number
  venvMissing?: boolean
  enabled?: boolean
  upstreamDepth?: number
  downstreamDepth?: number
}

interface DbtNode {
  name: string
  type: string
  dependencies: string[]
  filePath?: string
}

// Memoized inner component for ReactFlow
const LineageGraphInner = memo(function LineageGraphInner({
  projectPath,
  selectedFile,
  onNodeClick,
  compilationTrigger,
  allDbtNodes,
  error,
  setError,
  setAllDbtNodes,
  upstreamDepth,
  downstreamDepth
}: {
  projectPath: string | null
  selectedFile: string | null
  onNodeClick: (filePath: string, nodeType?: string) => void
  compilationTrigger?: number
  allDbtNodes: DbtNode[]
  error: string | null
  setError: (error: string | null) => void
  setAllDbtNodes: (nodes: DbtNode[]) => void
  upstreamDepth: number
  downstreamDepth: number
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const { fitView } = useReactFlow()

  // Load lineage when project path changes
  useEffect(() => {
    if (!projectPath) return

    let cancelled = false

    const loadLineage = async () => {
      if (cancelled) return

      setError(null)
      try {
        const response = await apiFetch(apiUrl('/api/get-lineage'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ path: projectPath }),
        })

        if (cancelled) return

        if (response.ok) {
          const data = await response.json()
          setAllDbtNodes(data.nodes)
        } else if (response.status === 404) {
          const data = await response.json()
          setError(data.detail || 'manifest.json not found')
          setAllDbtNodes([])
        } else {
          setError('Failed to load lineage data')
          setAllDbtNodes([])
        }
      } catch (err) {
        if (cancelled) return
        console.error('Error loading lineage:', err)
        setError('Failed to connect to backend')
        setAllDbtNodes([])
      }
    }

    loadLineage()

    return () => {
      cancelled = true
    }
  }, [projectPath, setError, setAllDbtNodes])

  // Re-load lineage when compilation completes
  useEffect(() => {
    if (compilationTrigger && compilationTrigger > 0 && projectPath) {
      const loadLineage = async () => {
        try {
          const response = await apiFetch(apiUrl('/api/get-lineage'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: projectPath }),
          })
          if (response.ok) {
            const data = await response.json()
            setAllDbtNodes(data.nodes)
          }
        } catch (err) {
          console.error('Error reloading lineage:', err)
        }
      }
      loadLineage()
    }
  }, [compilationTrigger, projectPath, setAllDbtNodes])

  // Memoize upstream/downstream calculation with depth limits
  const getUpstreamDownstream = useCallback((nodeName: string, allNodes: DbtNode[], maxUpstream: number, maxDownstream: number): Set<string> => {
    const relevantNodes = new Set<string>()
    relevantNodes.add(nodeName)

    const findUpstream = (name: string, depth: number) => {
      if (depth >= maxUpstream) return
      const node = allNodes.find(n => n.name === name)
      if (node) {
        node.dependencies.forEach(dep => {
          if (!relevantNodes.has(dep)) {
            relevantNodes.add(dep)
            findUpstream(dep, depth + 1)
          }
        })
      }
    }

    const findDownstream = (name: string, depth: number) => {
      if (depth >= maxDownstream) return
      allNodes.forEach(node => {
        if (node.dependencies.includes(name) && !relevantNodes.has(node.name)) {
          relevantNodes.add(node.name)
          findDownstream(node.name, depth + 1)
        }
      })
    }

    findUpstream(nodeName, 0)
    findDownstream(nodeName, 0)

    return relevantNodes
  }, [])

  // Memoize layout calculation
  const getLayoutedElements = useCallback((flowNodes: Node[], flowEdges: Edge[]) => {
    if (flowNodes.length === 0) return { nodes: [], edges: [] }

    const dagreGraph = new dagre.graphlib.Graph()
    dagreGraph.setDefaultEdgeLabel(() => ({}))
    dagreGraph.setGraph({ rankdir: 'LR', ranksep: 150, nodesep: 80 })

    flowNodes.forEach((node) => {
      dagreGraph.setNode(node.id, { width: 200, height: 60 })
    })

    flowEdges.forEach((edge) => {
      dagreGraph.setEdge(edge.source, edge.target)
    })

    dagre.layout(dagreGraph)

    const layoutedNodes = flowNodes.map((node) => {
      const nodeWithPosition = dagreGraph.node(node.id)
      return {
        ...node,
        position: {
          x: nodeWithPosition.x - 100,
          y: nodeWithPosition.y - 30,
        },
      }
    })

    return { nodes: layoutedNodes, edges: flowEdges }
  }, [])

  // Check if we should show the graph
  const selectedNodeName = selectedFile?.split('/').pop()?.replace(/\.(sql|yml|yaml|csv)$/, '')
  const isFolder = selectedFile ? !selectedFile.includes('.') : false
  // Only consider it a valid selection if the node actually exists in the lineage graph
  const nodeExistsInLineage = selectedNodeName ? allDbtNodes.some(n => n.name === selectedNodeName) : false
  const hasValidSelection = selectedFile && selectedNodeName && !isFolder && nodeExistsInLineage

  // Memoize graph building - this is the expensive operation
  const { graphNodes, graphEdges, isTruncated, nodeCountBeforeTruncation } = useMemo(() => {
    // Don't build graph if no nodes at all
    if (allDbtNodes.length === 0) {
      return { graphNodes: [], graphEdges: [], isTruncated: false, nodeCountBeforeTruncation: 0 }
    }

    // Only include models, seeds, and sources (exclude tests and macros)
    const allowedTypes = ['model', 'seed', 'source']
    let filteredNodes: DbtNode[]
    let originalCount: number

    if (hasValidSelection) {
      // Filter to relevant nodes for the selected file with depth limits
      const relevantNodeNames = getUpstreamDownstream(selectedNodeName!, allDbtNodes, upstreamDepth, downstreamDepth)
      filteredNodes = allDbtNodes.filter(node =>
        relevantNodeNames.has(node.name) && allowedTypes.includes(node.type)
      )
      originalCount = filteredNodes.length
    } else {
      // No file selected - show first MAX_NODES models to give an overview
      filteredNodes = allDbtNodes.filter(node => allowedTypes.includes(node.type))
      originalCount = filteredNodes.length
    }

    // Check if we need to truncate
    let truncated = false
    if (filteredNodes.length > MAX_NODES) {
      truncated = true
      if (hasValidSelection) {
        // Keep only the closest nodes - prioritize direct dependencies
        const selectedNode = allDbtNodes.find(n => n.name === selectedNodeName)
        if (selectedNode) {
          // Get direct dependencies (1 level up and down)
          const directNodes = new Set<string>([selectedNodeName!])
          // Add direct upstream
          selectedNode.dependencies.forEach(dep => directNodes.add(dep))
          // Add direct downstream
          allDbtNodes.forEach(node => {
            if (node.dependencies.includes(selectedNodeName!)) {
              directNodes.add(node.name)
            }
          })
          filteredNodes = allDbtNodes.filter(node => directNodes.has(node.name) && allowedTypes.includes(node.type))
        } else {
          filteredNodes = filteredNodes.slice(0, MAX_NODES)
        }
      } else {
        // No selection - just take first MAX_NODES
        filteredNodes = filteredNodes.slice(0, MAX_NODES)
      }
    }

    const flowNodes: Node[] = []
    const flowEdges: Edge[] = []
    const filteredNodeNames = new Set(filteredNodes.map(n => n.name))

    // Create nodes with simplified styles for better performance
    filteredNodes.forEach((dbtNode) => {
      const nodeType = dbtNode.type
      const isSelected = dbtNode.name === selectedNodeName
      const hasFile = !!dbtNode.filePath

      let bgColor = '#0e639c'
      let label = dbtNode.name

      if (nodeType === 'source') {
        bgColor = '#4d7c0f'
        label = `source: ${dbtNode.name}`
      } else if (nodeType === 'seed') {
        bgColor = '#c2410c'
        label = `seed: ${dbtNode.name}`
      }

      flowNodes.push({
        id: dbtNode.name,
        type: 'default',
        data: { label, filePath: dbtNode.filePath },
        position: { x: 0, y: 0 },
        style: {
          background: bgColor,
          color: '#ffffff',
          border: isSelected ? '3px solid #fbbf24' : 'none',
          borderRadius: '8px',
          padding: '12px',
          fontSize: '12px',
          fontWeight: isSelected ? 600 : 500,
          width: 180,
          cursor: hasFile ? 'pointer' : 'default',
        },
      })

      // Create edges - only for dependencies that exist in filtered nodes
      dbtNode.dependencies.forEach((dep) => {
        if (filteredNodeNames.has(dep)) {
          flowEdges.push({
            id: `${dep}-${dbtNode.name}`,
            source: dep,
            target: dbtNode.name,
            type: 'default',
            style: { stroke: '#6d6d6d', strokeWidth: 1.5 },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: '#6d6d6d',
              width: 15,
              height: 15,
            },
          })
        }
      })
    })

    const layouted = getLayoutedElements(flowNodes, flowEdges)
    return { graphNodes: layouted.nodes, graphEdges: layouted.edges, isTruncated: truncated, nodeCountBeforeTruncation: originalCount }
  }, [allDbtNodes, selectedNodeName, hasValidSelection, getUpstreamDownstream, getLayoutedElements, upstreamDepth, downstreamDepth])

  // Update nodes/edges when graph changes
  useEffect(() => {
    setNodes(graphNodes)
    setEdges(graphEdges)
  }, [graphNodes, graphEdges, setNodes, setEdges])

  // Center on selected node, or fit entire graph if no selection
  useEffect(() => {
    if (nodes.length === 0) return

    setTimeout(() => {
      if (hasValidSelection) {
        const selectedNode = nodes.find(node => node.id === selectedNodeName)
        if (selectedNode) {
          fitView({
            nodes: [selectedNode],
            padding: 0.3,
            duration: 200,
            maxZoom: 1.2,
          })
        }
      } else {
        // No selection - fit entire graph
        fitView({
          padding: 0.1,
          duration: 200,
          maxZoom: 1.0,
        })
      }
    }, 50)
  }, [nodes, selectedNodeName, hasValidSelection, fitView])

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    const dbtNode = allDbtNodes.find((n: DbtNode) => n.name === node.id)
    if (dbtNode && dbtNode.filePath) {
      onNodeClick(dbtNode.filePath, dbtNode.type)
    }
  }, [allDbtNodes, onNodeClick])

  if (error) {
    return (
      <div className="lineage-error">
        <div className="error-content">
          <p className="error-hint">
            Compile dbt models to generate lineage data.
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      {isTruncated && (
        <div className="lineage-truncated-warning">
          Graph has {nodeCountBeforeTruncation} nodes (limit: {MAX_NODES}). Reduce upstream/downstream depth values.
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        fitView
        attributionPosition="bottom-left"
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={true}
        panOnScroll={false}
      >
        <Background color="#3c3c3c" gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </>
  )
})

// Main component - only mounts ReactFlow when enabled
function LineageGraph({ projectPath, selectedFile, onNodeClick, compilationTrigger, venvMissing = false, enabled = false, upstreamDepth = 2, downstreamDepth = 2 }: LineageGraphProps) {
  const [allDbtNodes, setAllDbtNodes] = useState<DbtNode[]>([])
  const [error, setError] = useState<string | null>(null)

  // Show venv missing message first
  if (venvMissing) {
    return (
      <div className="lineage-graph">
        <div className="lineage-error">
          <div className="error-content">
            <p className="error-hint venv-missing-hint">
              Virtual environment not found. Click <PackageOpen size={14} className="inline-icon" /> "Create virtual environment" in the sidebar to set up dbt.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Show disabled message when lineage is off - DON'T mount ReactFlow at all
  if (!enabled) {
    return (
      <div className="lineage-graph">
        <div className="lineage-disabled">
          <div className="disabled-content">
            <p className="disabled-hint">Enable the lineage toggle to view model dependencies.</p>
          </div>
        </div>
      </div>
    )
  }

  // Only mount ReactFlowProvider when enabled
  return (
    <div className="lineage-graph">
      <ReactFlowProvider>
        <LineageGraphInner
          projectPath={projectPath}
          selectedFile={selectedFile}
          onNodeClick={onNodeClick}
          compilationTrigger={compilationTrigger}
          allDbtNodes={allDbtNodes}
          error={error}
          setError={setError}
          setAllDbtNodes={setAllDbtNodes}
          upstreamDepth={upstreamDepth}
          downstreamDepth={downstreamDepth}
        />
      </ReactFlowProvider>
    </div>
  )
}

export default LineageGraph
