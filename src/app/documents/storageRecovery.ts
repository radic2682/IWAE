import { announceAction } from '../actionFeedback'
import { quarantineVaultMetaFile, VaultFileCorruptError, type VaultFileNotice, type VaultHandle } from '../../bridge/vault'
import { errorText } from '../../core/errorText'
import { t } from '../../i18n'

/**
 * .iwae 저장 파일을 읽는다. 내용이 깨져 있으면 지우지 않고 `.corrupt-<시각>` 이름으로 따로 옮겨 두고,
 * 한 번 알린 뒤 비어 있는 것으로 시작한다(그러지 않으면 이번 실행에서 만든 것이 하나도 저장되지 않는다).
 * 잠김 같은 읽기 실패는 잠깐 뒤 다시 읽어 보고(모두 3번, 약 2초), 끝까지 안 되면 그대로 던진다.
 */
export const LOAD_RETRY_DELAYS_MS: readonly number[] = [700, 1300]

export async function loadOrQuarantine<T>(
  vault: VaultHandle,
  fileName: string,
  label: string,
  empty: T,
  read: () => Promise<T>,
  retryDelaysMs: readonly number[] = LOAD_RETRY_DELAYS_MS,
): Promise<T> {
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await read()
      } catch (cause) {
        const delay = retryDelaysMs[attempt]
        if (cause instanceof VaultFileCorruptError || delay === undefined) throw cause
        await new Promise<void>((resolve) => { setTimeout(resolve, delay) })
      }
    }
  } catch (cause) {
    if (!(cause instanceof VaultFileCorruptError)) throw cause
    const aside = await quarantineVaultMetaFile(vault, fileName)
    announceAction(t('{label} 파일이 깨져 있어 {aside} 이름으로 따로 보관하고 새로 시작합니다.', { label, aside }))
    return empty
  }
}

/** 저장 파일을 읽다 생긴 일(더 새 버전이 쓴 파일·깨진 색인)을 한 번 알린다 */
export function announceVaultFileNotice(notice: VaultFileNotice): void {
  announceAction(notice.kind === 'newer'
    ? t('{name} 파일은 더 새로운 버전의 IWAE가 만든 것이라, 이번에는 읽기만 하고 저장하지 않습니다.', { name: notice.name })
    : t('{name} 파일이 깨져 있어 .iwae/conflicts/diagnostics 폴더에 복사해 두고 다시 만듭니다.', { name: notice.name }))
}

/** 저장 결과를 알린다. 연달아 실패해도 한 번만 알리고, 성공하면 다시 알릴 수 있게 한다 */
export function createSaveNotifier(message: (error: string) => string): (save: Promise<void>) => void {
  let failing = false
  return (save) => {
    void save.then(() => { failing = false }, (cause: unknown) => {
      if (failing) return
      failing = true
      announceAction(message(errorText(cause)))
    })
  }
}

/** 읽기 실패를 알린다 */
export function reportLoadFailure(cause: unknown): void {
  announceAction(errorText(cause))
}
