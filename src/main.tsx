import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { GlobalTooltip } from './app/GlobalTooltip'
import { initLocale } from './i18n/bootstrap'
import './ui/theme.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root 가 없다 — index.html 이 바뀌었는지 확인할 것')
// 언어를 먼저 정하고 그린다(설정 → 설치기에서 고른 언어 → 운영체제 언어)
void initLocale().finally(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
      <GlobalTooltip />
    </StrictMode>,
  )
})
