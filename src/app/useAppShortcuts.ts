import { useEffect, useRef } from 'react'
import { resolveAppShortcut, type AppShortcut } from '../core/keyboardShortcuts'

export type AppShortcutActions = Partial<Record<AppShortcut, () => void>>

export function useAppShortcuts(actions: AppShortcutActions): void {
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcut = resolveAppShortcut(event)
      if (shortcut === null) return
      const action = actionsRef.current[shortcut]
      if (action === undefined) return
      event.preventDefault()
      action()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])
}
