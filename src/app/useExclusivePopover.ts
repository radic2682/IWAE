import { useCallback, useEffect, useState } from 'react'

export interface ExclusivePopoverController {
  readonly openId: string | null
  readonly open: (id: string) => void
  readonly close: () => void
  readonly toggle: (id: string) => void
}

export function useExclusivePopover(): ExclusivePopoverController {
  const [openId, setOpenId] = useState<string | null>(null)
  const open = useCallback((id: string) => setOpenId(id), [])
  const close = useCallback(() => setOpenId(null), [])
  const toggle = useCallback((id: string) => {
    setOpenId((current) => current === id ? null : id)
  }, [])

  useEffect(() => {
    if (openId === null) return
    const closeOutside = (event: MouseEvent) => {
      const target = event.target
      if (target instanceof Element
        && target.closest('[data-exclusive-popover]')?.getAttribute('data-exclusive-popover') === openId) return
      setOpenId(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenId(null)
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openId])

  return { openId, open, close, toggle }
}
