import { readLocalePreference, resolveLocale, setLocale, type Locale } from './index'

/**
 * 첫 화면을 그리기 전에 언어를 정한다. 설정에서 고른 값이 없으면 설치기에서 고른 언어(데스크톱 설치판),
 * 그것도 없으면 운영체제 언어를 따른다.
 */
export async function initLocale(): Promise<Locale> {
  const preference = readLocalePreference()
  let installer: Locale | null = null
  if (preference === null) {
    try {
      const { isTauri, invoke } = await import('@tauri-apps/api/core')
      if (isTauri()) {
        const value = await invoke<string | null>('installer_language')
        installer = value === 'ko' || value === 'en' ? value : null
      }
    } catch {
      installer = null
    }
  }
  const locale = resolveLocale(preference, installer)
  setLocale(locale)
  if (typeof document !== 'undefined') document.documentElement.lang = locale
  // Rust 쪽 메시지(오류·대화상자)도 같은 언어로
  try {
    const { isTauri, invoke } = await import('@tauri-apps/api/core')
    if (isTauri()) await invoke('set_locale', { locale })
  } catch {
    // 예전 백엔드: 메시지는 한국어로 남는다
  }
  return locale
}
