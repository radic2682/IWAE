import { announceAction } from '../actionFeedback'
import { quarantineVaultMetaFile, VaultFileCorruptError, type VaultHandle } from '../../bridge/vault'
import { errorText } from '../../core/errorText'
import { t } from '../../i18n'

/**
 * .iwae 저장 파일을 읽는다. 내용이 깨져 있으면 지우지 않고 `.corrupt-<시각>` 이름으로 따로 옮겨 두고,
 * 한 번 알린 뒤 비어 있는 것으로 시작한다(그러지 않으면 이번 실행에서 만든 것이 하나도 저장되지 않는다).
 * 잠김 같은 읽기 실패는 그대로 던진다.
 */
export async function loadOrQuarantine<T>(
  vault: VaultHandle,
  fileName: string,
  label: string,
  empty: T,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read()
  } catch (cause) {
    if (!(cause instanceof VaultFileCorruptError)) throw cause
    const aside = await quarantineVaultMetaFile(vault, fileName)
    announceAction(t('{label} 파일이 깨져 있어 {aside} 이름으로 따로 보관하고 새로 시작합니다.', { label, aside }))
    return empty
  }
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
