/**
 * 시스템 브라우저로 주소를 여는 이음매. PDF 링크는 문서를 만든 사람이 마음대로 적을 수
 * 있어서, Rust 쪽 거르기(`sanitize_uri`)와 별개로 여기서도 한 번 더 거른다 — 이 함수를
 * 부르는 길이 PDF 링크 하나뿐이라는 보장이 없다.
 */

import { t } from '../i18n'
import { isDesktop } from './window'

const ALLOWED = /^(https?:\/\/|mailto:)/iu

export function isOpenableUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!ALLOWED.test(trimmed) || /[\u0000-\u001f]/u.test(trimmed)) return false
  try {
    new URL(trimmed)
    return true
  } catch {
    return false
  }
}

/** 확인 창에 보여 줄 대상. 웹 주소는 호스트, 메일은 받는 주소다. */
export function externalLinkHost(url: string): string {
  try {
    const parsed = new URL(url.trim())
    return parsed.protocol === 'mailto:' ? parsed.pathname : parsed.host
  } catch {
    return url
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isOpenableUrl(url)) throw new Error(t('열 수 없는 주소입니다: {url}', { url }))
  if (!isDesktop()) {
    window.open(url.trim(), '_blank', 'noopener,noreferrer')
    return
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(url.trim())
}

/** 앱 어디서든 「외부 링크 열기」 확인 창을 거쳐 열게 한다(App 이 이 이벤트를 받아 확인 창을 띄운다) */
export const EXTERNAL_LINK_REQUEST_EVENT = 'iwae:request-external-link'

export function requestExternalLink(url: string): void {
  window.dispatchEvent(new CustomEvent<string>(EXTERNAL_LINK_REQUEST_EVENT, { detail: url }))
}
