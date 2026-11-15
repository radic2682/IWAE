import { useEffect, useRef } from 'react'
import { resolveAppShortcut, type AppShortcut } from '../core/keyboardShortcuts'

export type AppShortcutActions = Partial<Record<AppShortcut, () => void>>

/** `scope` 가 false 를 돌려주면 이 묶음은 키를 받지 않는다(여러 곳이 같은 문서에 등록할 때 제 칸에서만 먹게 한다) */
export function useAppShortcuts(actions: AppShortcutActions, scope?: () => boolean): void {
  const actionsRef = useRef(actions)
  actionsRef.current = actions
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcut = resolveAppShortcut(event)
      if (shortcut === null) return
      if (scopeRef.current !== undefined && !scopeRef.current()) return
      const action = actionsRef.current[shortcut]
      if (action === undefined) return
      event.preventDefault()
      action()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])
}
