import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { GlobalTooltip } from './app/GlobalTooltip'
import { LaunchSplashHost } from './app/LaunchSplashHost'
import { initLocale } from './i18n/bootstrap'
import { setSessionWriter } from './bridge/vault'
import { currentWindowMode, ownsSession } from './core/windowMode'
import { installHighlightColorStyle } from './app/highlightColorStyle'
import { installNativeContextMenuSuppressor } from './core/suppressNativeContextMenu'
import './ui/theme.css'
import './ui/focus-ring.css'
import { installTreeKeyboard } from './ui/treeKeyboard'
import { installNativeKeyGuard } from './core/nativeKeyGuard'
import { installErrorBuffer } from './core/errorBuffer'

// 탭·패널 배치(session.json)는 메인 창만 저장한다. 떼어 낸 창·새 창은 자기 배치를 메모리에만 둔다
setSessionWriter(ownsSession(currentWindowMode()))
// 우클릭 메뉴가 없는 곳에서는 웹뷰 기본 메뉴가 뜨지 않게 한다(글 입력 자리만 예외)
installNativeContextMenuSuppressor()
// 왼쪽 바 트리의 방향키 이동·roving tabindex
installTreeKeyboard()
// 웹뷰 기본 단축키(인쇄·새로고침·찾기 창 …)가 새지 않게
installNativeKeyGuard()
// 화면 오류를 기록해 둔다(문제 보고에서 사용자가 미리 보고 낼 때만 쓴다)
installErrorBuffer()
// 형광펜 색 변수(<style id="iwae-highlight-colors">)를 첫 그림 전에 만든다
installHighlightColorStyle()

const root = document.getElementById('root')
if (!root) throw new Error('#root 가 없다 — index.html 이 바뀌었는지 확인할 것')
// 여는 장면은 언어를 기다리지 않고 바로 띄운다(글이 없다). 앱(과 Vault 열기)이 뒤에서 준비되는 동안 덮고 있다가 사라진다
const splashRoot = document.createElement('div')
document.body.appendChild(splashRoot)
createRoot(splashRoot).render(<LaunchSplashHost />)

// 언어를 먼저 정하고 그린다(설정 → 설치기에서 고른 언어 → 운영체제 언어)
void initLocale().finally(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
      <GlobalTooltip />
    </StrictMode>,
  )
})
