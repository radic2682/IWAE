import { isDesktop } from './window'
import { t } from '../i18n'

/** Crossref 에서 DOI 하나의 서지 정보를 받는다. 해석은 `parseCrossrefWork` 가 한다 */
export async function lookupDoi(doi: string): Promise<unknown> {
  if (!isDesktop()) throw new Error(t('Crossref 조회는 데스크톱(Tauri) 안에서만 됩니다.'))
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<unknown>('bib_lookup_doi', { doi })
}
