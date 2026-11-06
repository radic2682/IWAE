import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  visibleWorkspaceSources,
  type CanvasSourceReference,
  type VisibleSourceReference,
} from '../core/workspaceSources'

export interface WorkspaceSourceState {
  readonly references: readonly CanvasSourceReference[]
  readonly selectedIds: ReadonlySet<string>
  readonly hoveredId: string | null
}

interface UseWorkspaceSourcesOptions {
  readonly scopeId: string | null
  readonly activeDocId: string | null
  readonly activeMarkdownPath?: string | null
  readonly currentPage: number
}

interface WorkspaceSourcesResult extends WorkspaceSourceState {
  readonly visibleSources: readonly VisibleSourceReference[]
  readonly setSourceState: (state: WorkspaceSourceState) => void
  readonly setReferences: (references: readonly CanvasSourceReference[]) => void
  readonly setSelectedSourceIds: (ids: ReadonlySet<string>) => void
  readonly setHoveredSourceId: (id: string | null) => void
}

export function useWorkspaceSources({
  scopeId,
  activeDocId,
  activeMarkdownPath,
  currentPage,
}: UseWorkspaceSourcesOptions): WorkspaceSourcesResult {
  const [references, setReferences] = useState<readonly CanvasSourceReference[]>([])
  const [selectedIds, setSelectedSourceIds] = useState<ReadonlySet<string>>(() => new Set())
  const [hoveredId, setHoveredSourceId] = useState<string | null>(null)

  useEffect(() => {
    setReferences([])
    setSelectedSourceIds(new Set())
    setHoveredSourceId(null)
  }, [scopeId])

  const setSourceState = useCallback((state: WorkspaceSourceState) => {
    setReferences(state.references)
    setSelectedSourceIds(state.selectedIds)
    setHoveredSourceId(state.hoveredId)
  }, [])

  const visibleSources = useMemo(() => visibleWorkspaceSources({
    references,
    activeDocId: activeDocId ?? '',
    activeMarkdownPath: activeMarkdownPath ?? undefined,
    currentPage,
    selectedIds,
    hoveredId,
  }), [activeDocId, activeMarkdownPath, currentPage, hoveredId, references, selectedIds])

  return {
    references,
    selectedIds,
    hoveredId,
    visibleSources,
    setSourceState,
    setReferences,
    setSelectedSourceIds,
    setHoveredSourceId,
  }
}
