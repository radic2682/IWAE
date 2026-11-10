import { useState } from 'react'
import { t } from '../i18n'
import { isMacPlatform } from '../core/platform'
import { setAppPref, useAppPrefs, type AppFlagPrefs } from './appPrefs'
import { GESTURES } from './useMouseGestures'

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

const MOD = isMacPlatform() ? '⌘' : 'Ctrl'
/** 단축키 목록(바꿀 수는 없고 보기만) */
const SHORTCUT_GROUPS: readonly { title: string; items: readonly [string, string][] }[] = [
  { title: '일반', items: [
    [`${MOD}+Shift+P`, '명령 팔레트'],
    [`${MOD}+,`, '설정'],
    [`${MOD}+Shift+F`, '모든 문서에서 찾기'],
    [`${MOD}+F`, '이 문서에서 찾기'],
    [`${MOD}+Shift+L`, '라이브러리 펼치기·접기'],
    [`${MOD}+Z`, '되돌리기'],
    [`${MOD}+Shift+Z · ${MOD}+Y`, '다시 하기'],
  ] },
  { title: '탭·문서', items: [
    [`${MOD}+Tab · ${MOD}+Shift+Tab`, '다음 탭 · 이전 탭'],
    [`${MOD}+W`, '탭 닫기'],
    [`${MOD}+G`, '쪽으로 가기'],
    [`${MOD}+P`, '인쇄'],
    ['Alt+← · Alt+→', '뒤로 · 앞으로 (문서 점프)'],
    [`${MOD}+= · ${MOD}+-`, '확대 · 축소'],
  ] },
  { title: '편집 도구 (한 글자)', items: [
    ['T', '글 상자'], ['P', '펜'], ['L', '선'], ['A', '화살표'], ['R', '네모'], ['O', '동그라미'], ['E', '지우개'], ['Esc', '도구 끄기'],
  ] },
]

/** 설정 「단축키·마우스」 */
export function InputSettings() {
  return (
    <section className="behavior-settings" aria-label={t('단축키·마우스')}>
      <h3 className="behavior-title">{t('단축키')}</h3>
      <div className="translation-cache-settings">
        <PrefToggle pref="singleKeyShortcuts" title={t('한 글자 도구 단축키')} description={t('글을 쓰는 칸 밖에서 T·P·L·A·R·O·E 를 누르면 편집 도구를 바로 고릅니다. 끄면 도구줄 단추로만 고릅니다.')} />
      </div>
      <div className="behavior-keys">
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.title} className="behavior-key-group">
            <h4>{t(group.title)}</h4>
            <dl>
              {group.items.map(([keys, label]) => (
                <div key={label} className="behavior-key-row"><dt><kbd>{keys}</kbd></dt><dd>{t(label)}</dd></div>
              ))}
            </dl>
          </div>
        ))}
      </div>

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
