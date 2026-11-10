import { useState } from 'react'
import { t } from '../i18n'
import { setAppPref, useAppPrefs, type AppFlagPrefs } from './appPrefs'
import { GESTURES } from './useMouseGestures'
import { ShortcutSettings } from './ShortcutSettings'

/** 켜기·끄기 한 줄(번역 캐시와 같은 카드 꼴) */
function PrefToggle({ pref, title, description }: { readonly pref: keyof AppFlagPrefs; readonly title: string; readonly description: string }) {
  const prefs = useAppPrefs()
  return (
    <label className="translation-cache-toggle behavior-toggle">
      <input type="checkbox" checked={prefs[pref]} onChange={(event) => setAppPref(pref, event.currentTarget.checked)} />
      <span>
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
    </label>
  )
}

/** 한 글자 도구 키(글 쓰는 칸 밖에서만). 켜고 끄기만 하고 바꾸지는 못한다 */
const TOOL_KEYS: readonly [string, string][] = [['T', '글 상자'], ['P', '펜'], ['L', '선'], ['A', '화살표'], ['R', '네모'], ['O', '동그라미'], ['E', '지우개'], ['Esc', '도구 끄기']]

/** 설정 「단축키·마우스」 */
export function InputSettings() {
  return (
    <section className="behavior-settings" aria-label={t('단축키·마우스')}>
      <h3 className="behavior-title">{t('단축키')}</h3>
      <ShortcutSettings />
      <h3 className="behavior-title">{t('편집 도구 (한 글자)')}</h3>
      <div className="translation-cache-settings">
        <PrefToggle pref="singleKeyShortcuts" title={t('한 글자 도구 단축키')} description={t('글을 쓰는 칸 밖에서 T·P·L·A·R·O·E 를 누르면 편집 도구를 바로 고릅니다. 끄면 도구줄 단추로만 고릅니다.')} />
      </div>
      <dl className="behavior-gestures">
        {TOOL_KEYS.map(([keys, label]) => (
          <div key={label} className="behavior-key-row"><dt><kbd>{keys}</kbd></dt><dd>{t(label)}</dd></div>
        ))}
      </dl>


      <h3 className="behavior-title">{t('마우스 제스처')}</h3>
      <div className="translation-cache-settings">
        <PrefToggle pref="mouseGestures" title={t('마우스 제스처 사용')} description={t('오른쪽 버튼을 누른 채 그리면 아래 동작을 합니다. 움직이지 않고 떼면 평소 우클릭 메뉴입니다.')} />
      </div>
      <dl className="behavior-gestures">
        {Object.values(GESTURES).map((gesture) => (
          <div key={gesture.label} className="behavior-key-row"><dt><kbd>{gesture.label.split(' ')[0]}</kbd></dt><dd>{t(gesture.label.split(' ').slice(1).join(' '))}</dd></div>
        ))}
      </dl>
    </section>
  )
}

/** 설정 「검색·OCR」 */
export function SearchSettings({ onRebuildIndex }: { readonly onRebuildIndex?: () => Promise<void> }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | { error: string }>('idle')
  return (
    <section className="behavior-settings" aria-label={t('검색·OCR')}>
      <div className="translation-cache-settings behavior-stack">
        <PrefToggle pref="autoIndex" title={t('Vault 를 열 때 모든 PDF 색인')} description={t('열자마자 모든 PDF 의 글자를 읽어 「모든 문서에서 찾기」가 바로 되게 합니다. PDF 가 아주 많으면 끄고, 필요할 때 아래 「색인 다시 만들기」를 누르세요.')} />
        <PrefToggle pref="ocr" title={t('글자 없는 쪽을 OCR 로 읽기')} description={t('스캔한 쪽처럼 글자 층이 없는 쪽을 이 PC 에서 읽습니다(밖으로 보내지 않음). 검색 색인과, 스캔 쪽에서 영역을 잡았을 때의 글자에 쓰입니다.')} />
      </div>
      {onRebuildIndex === undefined ? null : (
        <div className="behavior-rebuild">
          <button
            type="button"
            className="translation-cache-clear"
            disabled={state === 'busy'}
            onClick={() => {
              setState('busy')
              onRebuildIndex().then(() => setState('done'), (cause: unknown) => setState({ error: cause instanceof Error ? cause.message : String(cause) }))
            }}
          >
            {state === 'busy' ? t('다시 만드는 중…') : t('색인 다시 만들기')}
          </button>
          <span className="behavior-rebuild-note">
            {state === 'done' ? t('다시 읽기 시작했습니다. 왼쪽 아래에 진행이 보입니다.') : typeof state === 'object' ? state.error : t('저장해 둔 글자를 지우고 모든 PDF 를 새로 읽습니다.')}
          </span>
        </div>
      )}
    </section>
  )
}
