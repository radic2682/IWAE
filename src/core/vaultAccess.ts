import { errorText } from './errorText'
import { t } from '../i18n'

/**
 * 앱이 그 폴더를 열 허락이 없어서 실패했는가. 설치한 앱은 폴더 선택 창에서 고른 폴더만 열 수 있어서,
 * 새로 설치했거나 허락 기록이 지워지면 최근 Vault 도 "forbidden path" 로 막힌다.
 */
export function isFolderAccessDenied(err: unknown): boolean {
  return /forbidden path|not allowed on the configured scope|not allowed by the scope/iu.test(errorText(err))
}

/** 허락이 없어 못 연 Vault 를 사람이 알아들을 말로 */
export function folderAccessText(root: string): string {
  return t('{root} 폴더를 한 번 더 골라 주세요. 「Vault 폴더 선택」이나 아래 최근 Vault 를 누르면 그 폴더가 잡힌 선택 창이 열립니다. 거기서 「폴더 선택」만 누르면 됩니다.', { root })
}
