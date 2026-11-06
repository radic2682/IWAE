import type { ReactNode } from 'react'
import { WindowControls } from './WindowControls'

interface StartupShellProps {
  children: ReactNode
}

export function StartupShell({ children }: StartupShellProps) {
  return (
    <div className="startup-shell">
      <header className="startup-titlebar" data-tauri-drag-region="deep">
        <span className="startup-titlebar-label">IWAE</span>
        <span className="startup-titlebar-drag" data-tauri-drag-region aria-hidden="true" />
        <WindowControls />
      </header>
      {children}
    </div>
  )
}
