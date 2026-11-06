import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { X } from '@phosphor-icons/react'
import '../ui/settings-clean.css'
import { t } from '../i18n'

export interface SettingsSection {
  readonly id: string
  readonly label: string
  readonly icon?: ReactNode
  readonly content: ReactNode
}

interface SettingsModalProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly children?: ReactNode
  readonly sections?: readonly SettingsSection[]
  /** 열 때 먼저 보일 항목(예: 복구할 것이 있어 저절로 열 때 '데이터 및 복구') */
  readonly initialSectionId?: string
}

export function SettingsModal({ open, onClose, children, sections, initialSectionId }: SettingsModalProps) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const [activeSectionId, setActiveSectionId] = useState(sections?.[0]?.id ?? '')

  useEffect(() => {
    if (open && initialSectionId !== undefined) setActiveSectionId(initialSectionId)
  }, [initialSectionId, open])

  useEffect(() => {
    if (open && sections !== undefined && !sections.some((section) => section.id === activeSectionId)) {
      setActiveSectionId(sections[0]?.id ?? '')
    }
  }, [activeSectionId, open, sections])

  useLayoutEffect(() => {
    if (!open) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButton.current?.focus()
    return () => {
      previousFocus.current?.focus()
      previousFocus.current = null
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  if (!open) return null

  return (
    <div
      className="settings-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        <header className="settings-modal-header">
          <h1 id="settings-modal-title">{t('설정')}</h1>
          <button
            ref={closeButton}
            type="button"
            className="settings-modal-close"
            aria-label={t('설정 닫기')}
            onClick={onClose}
          >
            <X size={18} weight="bold" aria-hidden="true" />
          </button>
        </header>
        {sections === undefined ? (
          <div className="settings-modal-body">{children}</div>
        ) : (
          <div className="settings-modal-workspace">
            <nav className="settings-modal-nav" aria-label={t('설정 항목')}>
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  aria-current={activeSectionId === section.id ? 'page' : undefined}
                  onClick={() => setActiveSectionId(section.id)}
                >
                  {section.icon}
                  <span>{section.label}</span>
                </button>
              ))}
            </nav>
            <div className="settings-modal-body">
              {sections.find((section) => section.id === activeSectionId)?.content ?? null}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
