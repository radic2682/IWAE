import { WarningCircle, X } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { t } from '../i18n'
import { ActionToast } from './ActionToast'
import '../ui/notice-stack.css'

/**
 * 앱의 모든 알림이 모이는 오른쪽 아래 한 줄기. 맨 위가 잠깐 떴다 사라지는 토스트이고,
 * 그 아래에 children(오래 남는 알림: 오류 · AI 위치 · 가져오기 권유 · 업데이트 · AI 알약)이 위에서 아래로 놓인다.
 */
export function NoticeStack({ children }: { readonly children?: ReactNode }) {
  return (
    <div className="notice-stack" role="region" aria-label={t('알림')}>
      <ActionToast />
      {children}
    </div>
  )
}

/** 앱 전체의 오류 알림. 위험색은 이것만 쓴다 */
export function ErrorNotice({ message, onDismiss }: { readonly message: string; readonly onDismiss: () => void }) {
  return (
    <div className="notice-card notice-card-danger" role="alert">
      <div className="notice-mark"><WarningCircle size={16} weight="bold" aria-hidden="true" /></div>
      <div className="notice-copy"><span>{message}</span></div>
      <button type="button" className="notice-close" aria-label={t('알림 닫기')} onClick={onDismiss}><X size={14} aria-hidden="true" /></button>
    </div>
  )
}
