import { resolveAppShortcut } from './keyboardShortcuts'
import { getShortcutDef } from './shortcutRegistry'

/**
 * 웹뷰(WebView2)의 기본 단축키 막이. 사용자가 단축키를 바꾸거나 지워서 앱이 안 받는 키가 되면
 * 그 키가 브라우저 기능(인쇄 창·새로고침·찾기 창·개발자 도구·소스 보기·페이지 저장·새 창·페이지 확대 …)으로 새어
 * 화면이 얼거나 상태를 잃는다. 앱이 처리하는 키(resolveAppShortcut)는 그대로 두고, 나머지 위험한 키만 막는다.
 * 글 쓰는 칸에서 쓰는 편집 키(Ctrl+B/I/U·복사·붙여넣기·되돌리기 …)는 목록에 없으므로 건드리지 않는다.
 */

interface Chord { readonly mod?: boolean; readonly shift?: boolean; readonly alt?: boolean; readonly key: string; /** 글 쓰는 칸 안에서는 기본 동작이 필요한가(막지 않는다) */ readonly keepInEditable?: boolean }

const MOD = true
const BLOCKED: readonly Chord[] = [
  // 인쇄·저장·열기·새 창/탭·기록·내려받기
  { mod: MOD, key: 'p' }, { mod: MOD, shift: true, key: 'p' }, { mod: MOD, key: 's' }, { mod: MOD, key: 'o' },
  { mod: MOD, key: 'n' }, { mod: MOD, shift: true, key: 'n' }, { mod: MOD, key: 't' }, { mod: MOD, shift: true, key: 't' },
  { mod: MOD, key: 'h' }, { mod: MOD, key: 'j' }, { mod: MOD, key: 'd' }, { mod: MOD, key: 'e' }, { mod: MOD, key: 'l' },
  { mod: MOD, key: 'w' }, { mod: MOD, shift: true, key: 'w' }, { mod: MOD, shift: true, key: 'delete' },
  // 새로고침
  { mod: MOD, key: 'r' }, { mod: MOD, shift: true, key: 'r' }, { key: 'f5' }, { mod: MOD, key: 'f5' }, { shift: true, key: 'f5' },
  // 찾기 창
  { mod: MOD, key: 'f' }, { mod: MOD, key: 'g' }, { mod: MOD, shift: true, key: 'g' }, { key: 'f3' }, { shift: true, key: 'f3' },
  // 소스 보기·개발자 도구(개발 빌드에서만 열린다: isDevBuild)
  { mod: MOD, key: 'u' }, { mod: MOD, shift: true, key: 'i' }, { mod: MOD, shift: true, key: 'j' }, { mod: MOD, shift: true, key: 'c' }, { key: 'f12' },
  // 페이지 확대(앱이 처리하지 않을 때)
  { mod: MOD, key: '=' }, { mod: MOD, key: '+' }, { mod: MOD, shift: true, key: '+' }, { mod: MOD, shift: true, key: '=' }, { mod: MOD, key: '-' }, { mod: MOD, key: '_' }, { mod: MOD, key: '0' },
  // 기타: 도움말·메뉴 막대·전체 화면·탭 이동
  { key: 'f1' }, { key: 'f7' }, { key: 'f11' }, { mod: MOD, key: 'tab' }, { mod: MOD, shift: true, key: 'tab' },
  // 기록 앞뒤(글 쓰는 칸에서는 Alt+←/→ 가 커서 이동이므로 둔다)
  { alt: true, key: 'arrowleft', keepInEditable: true }, { alt: true, key: 'arrowright', keepInEditable: true },
]

/** 개발 빌드에서는 F12·Ctrl+Shift+I 를 풀어 둔다 */
function isDevBuild(): boolean {
  try { return Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV) } catch { return false }
}

const DEV_KEYS = new Set(['f12', 'i', 'j', 'c'])

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

/** 이 키 입력이 웹뷰 기본 동작으로 새어 나가면 안 되는 키인가(앱이 받는 키는 false) */
export function isBlockedNativeKey(event: KeyboardEvent, dev = isDevBuild()): boolean {
  if (event.key === undefined || event.key === 'Control' || event.key === 'Shift' || event.key === 'Alt' || event.key === 'Meta') return false
  const mod = Boolean(event.ctrlKey || event.metaKey)
  const key = event.key.toLowerCase()
  const editable = isEditable(event.target)
  const command = resolveAppShortcut(event)
  if (command !== null) {
    // 앱 명령은 앱이 받는다. 편집기 범위 명령(저장·밑줄·복제 …)은 앱 바깥에서는 받는 곳이 없어 웹뷰 기능이 새므로
    // 아래 목록으로 다시 본다. 단 글 쓰는 칸의 Ctrl+U(밑줄)는 편집기의 몫이다
    const def = getShortcutDef(command)
    if (command === 'escape' || def?.scope === 'app') return false
    if (editable && key === 'u') return false
  }
  return BLOCKED.some((chord) => {
    if (Boolean(chord.mod) !== mod || Boolean(chord.alt) !== Boolean(event.altKey)) return false
    if (chord.key !== key) return false
    // 모양이 다른 키(+ 와 =)는 Shift 가 섞여 들어오므로 글자 키가 아닌 것은 Shift 를 따지지 않는다
    if (!/^[a-z]$/u.test(chord.key) && !chord.key.startsWith('f') && !chord.key.startsWith('arrow') && chord.key !== 'delete' && chord.key !== 'tab') {
      // 기호 키: Shift 상관없이 같은 키
    } else if (Boolean(chord.shift) !== Boolean(event.shiftKey)) return false
    if (dev && DEV_KEYS.has(chord.key) && (chord.key === 'f12' || (event.shiftKey && mod))) return false
    if (chord.keepInEditable === true && editable) return false
    return true
  })
}

let installed = false

/** 앱 시작 때 한 번. keydown(캡처) · Ctrl+휠 · 마우스 뒤로/앞으로 단추를 막는다 */
export function installNativeKeyGuard(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('keydown', (event) => {
    if (isBlockedNativeKey(event)) event.preventDefault()
  }, true)
  // Ctrl+휠 페이지 확대: 앱의 칸이 처리하지 않은(막지 않은) 것만 막는다 — 버블 단계에서
  window.addEventListener('wheel', (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.defaultPrevented) event.preventDefault()
  }, { passive: false })
  // 마우스 뒤로(3)·앞으로(4) 단추의 기록 이동
  const blockHistoryButtons = (event: MouseEvent) => {
    if (event.button === 3 || event.button === 4) event.preventDefault()
  }
  window.addEventListener('mouseup', blockHistoryButtons, true)
  window.addEventListener('auxclick', blockHistoryButtons, true)
}
