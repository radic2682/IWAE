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
      <h3 className="behavior-title">{t('편집 도구')}</h3>
      <div className="translation-cache-settings">
        <PrefToggle pref="singleKeyShortcuts" title={t('한 글자 도구 단축키')} description={t('글 입력란 밖에서 T, P, L, A, R, O, E를 누르면 편집 도구가 선택됩니다. 끄면 도구 모음의 단추로만 고를 수 있습니다.')} />
      </div>
      <dl className="behavior-gestures">
        {TOOL_KEYS.map(([keys, label]) => (
          <div key={label} className="behavior-key-row"><dt><kbd>{keys}</kbd></dt><dd>{t(label)}</dd></div>
        ))}
      </dl>


      <h3 className="behavior-title">{t('탭 열기')}</h3>
      <div className="translation-cache-settings">
        <PrefToggle pref="previewTabs" title={t('다른 노트·문서를 미리보기 탭으로 열기')} description={t('같은 색 칸에 없는 노트나 문서는 미리보기 탭(기울임꼴)으로 엽니다. 다음 미리보기가 이 탭을 대신하며, 편집하거나 탭을 두 번 누르면 고정됩니다.')} />
      </div>

      <h3 className="behavior-title">{t('마우스 제스처')}</h3>
      <div className="translation-cache-settings">
        <PrefToggle pref="mouseGestures" title={t('마우스 제스처 사용')} description={t('오른쪽 버튼을 누른 채 그리면 아래 동작을 실행합니다. 움직이지 않고 떼면 일반 우클릭 메뉴가 열립니다.')} />
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
        <PrefToggle pref="autoIndex" title={t('Vault를 열 때 모든 PDF 색인')} description={t('Vault를 열 때 모든 PDF의 글자를 읽어 「모든 문서에서 찾기」를 쓸 수 있게 합니다. PDF가 아주 많으면 끄고, 필요할 때 아래 「색인 다시 만들기」를 누르세요.')} />
        <PrefToggle pref="ocr" title={t('글자 없는 쪽을 OCR로 읽기')} description={t('스캔본처럼 글자 층이 없는 쪽을 이 PC에서 읽습니다. 외부로 전송하지 않습니다. 검색 색인과 스캔 쪽의 영역 선택에 쓰입니다.')} />
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
            {state === 'done' ? t('다시 읽기를 시작했습니다. 진행 상황은 왼쪽 아래에 표시됩니다.') : typeof state === 'object' ? state.error : t('저장된 글자를 지우고 모든 PDF를 새로 읽습니다.')}
          </span>
        </div>
      )}
    </section>
  )
}
