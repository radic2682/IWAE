import { useEffect, useState } from 'react'
import '../ui/tooltip.css'

/**
 * 앱 전체 공통 말풍선. 아이콘만 있는 단추에 마우스를 잠깐 올리면 그 기능 이름을 보인다.
 *
 * 단추마다 컴포넌트를 감싸지 않고 문서 전체에서 마우스를 본다 — 단추가 수백 개라 하나씩
 * 고치면 빠지는 곳이 생긴다. 이름은 `title`(있으면) → `aria-label` 순으로 쓰고, 글자가 보이는
 * 단추(탭·메뉴 항목 등)는 이미 무엇인지 보이므로 `title` 이 있을 때만 띄운다.
 * 브라우저 기본 title 말풍선은 늦고 모양이 앱과 달라, 머무는 동안 title 을 잠시 치워 둔다.
 */

const SHOW_DELAY_MS = 450
const TARGET = 'button, [role="button"], a[href], [data-tooltip]'

interface TipState {
  readonly text: string
  readonly shortcut: string | null
  readonly rect: DOMRect
}

function labelOf(element: HTMLElement): string | null {
  const explicit = element.dataset.tooltip
  if (explicit !== undefined) return explicit.trim() || null
  const title = element.dataset.iwaeTitle ?? element.getAttribute('title')
  if (title !== null && title.trim().length > 0) return title.trim()
  const aria = element.getAttribute('aria-label')
  if (aria === null || aria.trim().length === 0) return null
  // 보이는 글자가 이름 노릇을 하는 단추는 건너뛴다. "Aa", "W" 같은 기호 단추는 띄운다.
  const visible = (element.textContent ?? '').trim()
  if (visible.length > 2) return null
  return aria.trim()
}

export function GlobalTooltip() {
  const [tip, setTip] = useState<TipState | null>(null)

  useEffect(() => {
    let timer: number | undefined
    let current: HTMLElement | null = null

    const restoreTitle = (element: HTMLElement | null) => {
      if (element === null) return
      const saved = element.dataset.iwaeTitle
      if (saved !== undefined) {
        if (!element.hasAttribute('title')) element.setAttribute('title', saved)
        delete element.dataset.iwaeTitle
      }
    }

    const hide = () => {
      window.clearTimeout(timer)
      restoreTitle(current)
      current = null
      setTip(null)
    }

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(TARGET) : null
      if (target === current) return
      hide()
      if (target === null || target.closest('[data-no-tooltip]') !== null) return
      const text = labelOf(target)
      if (text === null) return
      current = target
      const title = target.getAttribute('title')
      if (title !== null) {
        target.dataset.iwaeTitle = title
        target.removeAttribute('title')
      }
      timer = window.setTimeout(() => {
        if (current !== target || !target.isConnected) return
        // "이름 (Ctrl+K)" 꼴이면 단축키를 따로 떼어 흐리게 보인다
        const match = /^(.*?)\s*\(([^()]*(?:Ctrl|Alt|Shift|Esc|F\d|Enter|⌘)[^()]*)\)\s*$/.exec(text)
        const shortcut = target.getAttribute('aria-keyshortcuts')
        setTip({
          text: match?.[1] ?? text,
          shortcut: match?.[2] ?? shortcut,
          rect: target.getBoundingClientRect(),
        })
      }, SHOW_DELAY_MS)
    }

    const onOut = (event: PointerEvent) => {
      if (current === null) return
      const next = event.relatedTarget instanceof Node ? event.relatedTarget : null
      if (next !== null && current.contains(next)) return
      hide()
    }

    document.addEventListener('pointerover', onOver, true)
    document.addEventListener('pointerout', onOut, true)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('keydown', hide, true)
    document.addEventListener('wheel', hide, { capture: true, passive: true })
    window.addEventListener('blur', hide)
    return () => {
      hide()
      document.removeEventListener('pointerover', onOver, true)
      document.removeEventListener('pointerout', onOut, true)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('keydown', hide, true)
      document.removeEventListener('wheel', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  if (tip === null) return null
  return <TooltipBubble tip={tip} />
}

function TooltipBubble({ tip }: { readonly tip: TipState }) {
  const [style, setStyle] = useState<{ left: number; top: number; below: boolean } | null>(null)

  const place = (node: HTMLDivElement | null) => {
    if (node === null || style !== null) return
    const width = node.offsetWidth
    const height = node.offsetHeight
    const margin = 6
    const below = tip.rect.bottom + margin + height <= window.innerHeight - 4
    const top = below ? tip.rect.bottom + margin : tip.rect.top - margin - height
    const centered = tip.rect.left + tip.rect.width / 2 - width / 2
    const left = Math.max(6, Math.min(centered, window.innerWidth - width - 6))
    setStyle({ left, top, below })
  }

  return (
    <div
      ref={place}
      className={`iwae-tooltip${style === null ? '' : ' iwae-tooltip-shown'}`}
      role="tooltip"
      style={style === null ? { left: -9999, top: -9999 } : { left: style.left, top: style.top }}
    >
      <span>{tip.text}</span>
      {tip.shortcut === null ? null : <kbd>{tip.shortcut}</kbd>}
    </div>
  )
}
