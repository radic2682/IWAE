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
      if (event.key !== 'Escape') return
      setOpenId(null)
      // 연 단추로 초점을 돌려준다(팝오버가 사라지며 초점이 body 로 떨어지지 않게)
      const trigger = document.querySelector<HTMLElement>(`button[data-exclusive-popover="${openId}"]`)
      if (trigger !== null && (document.activeElement === null || document.activeElement === document.body || document.activeElement.closest('.note-options-popover') !== null || trigger.contains(document.activeElement))) trigger.focus({ preventScroll: true })
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
