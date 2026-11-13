import { useState } from 'react'
import { t } from '../i18n'
import { ConfirmDialog } from './ConfirmDialog'
import { setAppPref, useAppPrefs } from './appPrefs'
import { PREFIX_DEFAULT_PRESET, requestShortcutRecording } from './ShortcutSettings'
import { useStartupDialog } from './startupDialogs'
import { PREFIX_KEY_ID, withBinding } from '../core/shortcutRegistry'
import '../ui/prefix-dialog.css'

/** 시작 대화상자 줄에서의 이름과 차례(새 버전 창이 10 으로 먼저) */
export const PREFIX_DIALOG_ID = 'prefix-keys'
export const PREFIX_DIALOG_PRIORITY = 50

const CUSTOM = 'custom'

interface Choice {
  readonly value: string
  readonly key: string
  readonly title?: string
  readonly note?: string
}

const CHOICES: readonly Choice[] = [
  { value: PREFIX_DEFAULT_PRESET, key: 'Ctrl+B', title: '기본 (tmux와 같음)', note: '메모를 쓸 때 Ctrl+B는 굵게입니다. 접두키를 Ctrl+B로 쓰면 편집기 안에서는 Ctrl+B를 두 번 눌러야 굵게가 됩니다.' },
  { value: 'Ctrl+Space', key: 'Ctrl+Space', note: '서식 단축키와 겹치지 않음. 일부 PC 에서는 입력기 전환과 겹칠 수 있음' },
  { value: 'Ctrl+A', key: 'Ctrl+A', note: 'screen 방식. 편집기에서 전체 선택은 Ctrl+A 두 번' },
  { value: CUSTOM, key: '', title: '직접 정하기…' },
]

interface PrefixKeyHostProps {
  /** 메인 창이고 시작이 끝났으며 keys.conf 가 접두키를 정하지 않았다고 알아낸 뒤에만 true */
  readonly enabled: boolean
  /** 「직접 정하기…」 를 확인했다: 설정의 단축키 목록을 열어 접두키 녹음을 시작한다 */
  readonly onChooseCustom: () => void
}

/**
 * 첫 실행의 「접두키 고르기」 창(한 번만). 접두키를 고른 적이 없고(설정에 접두키 값 없음) 아직 묻지 않았을 때 뜬다.
 * 「확인」 은 고른 키를 설정의 단축키 값에 저장하고, 「나중에」(Esc 포함)는 기본 Ctrl+B 를 그대로 둔다. 둘 다 다시 묻지 않는다.
 * 시작 대화상자 줄(startupDialogs)에 서서 「새 버전」 창과 겹쳐 뜨지 않는다.
 */
export function PrefixKeyHost({ enabled, onChooseCustom }: PrefixKeyHostProps) {
  const { shortcuts, prefixKeyAsked } = useAppPrefs()
  const [picked, setPicked] = useState(PREFIX_DEFAULT_PRESET)
  const wanted = enabled && !prefixKeyAsked && shortcuts[PREFIX_KEY_ID] === undefined
  const turn = useStartupDialog(PREFIX_DIALOG_ID, wanted, PREFIX_DIALOG_PRIORITY)
  if (!turn) return null

  const done = () => setAppPref('prefixKeyAsked', true)
  const confirm = () => {
    if (picked === CUSTOM) {
      done()
      onChooseCustom()
      requestShortcutRecording(PREFIX_KEY_ID)
      return
    }
    setAppPref('shortcuts', withBinding(shortcuts, PREFIX_KEY_ID, picked))
    done()
  }
  return (
    <ConfirmDialog title={t('접두키 고르기')} confirmLabel={t('확인')} cancelLabel={t('나중에')} onConfirm={confirm} onCancel={done}>
      <div className="prefix-dialog">
        <p className="prefix-dialog-lead">{t('칸 나누기나 화면 바꾸기 같은 작업 공간 명령은 접두키를 누른 뒤 한 글자로 실행합니다(tmux 방식).')}</p>
        <div className="prefix-dialog-choices" role="radiogroup" aria-label={t('접두키로 쓸 키')}>
          {CHOICES.map((choice) => (
            <label key={choice.value} className="prefix-dialog-choice" data-checked={picked === choice.value ? '' : undefined}>
              <input type="radio" name="prefix-key" value={choice.value} checked={picked === choice.value} onChange={() => setPicked(choice.value)} />
              <span className="prefix-dialog-text">
                <span className="prefix-dialog-name">
                  {choice.key === '' ? null : <kbd className="prefix-dialog-key">{choice.key}</kbd>}
                  {choice.title === undefined ? null : <span className="prefix-dialog-title">{t(choice.title)}</span>}
                </span>
                {choice.note === undefined ? null : <span className="prefix-dialog-note">{t(choice.note)}</span>}
              </span>
            </label>
          ))}
        </div>
        <p className="prefix-dialog-foot">{t('설정 → 단축키에서 언제든 바꿀 수 있습니다')}</p>
      </div>
    </ConfirmDialog>
  )
}
