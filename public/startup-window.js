// 저장된 앱 테마를 React 가 뜨기 전에 :root 에 단다 — 다크로 골라 둔 사람에게 첫 화면이
// 밝게 번쩍이지 않게. 값의 뜻은 src/core/theme.ts 와 같다.
;(() => {
  try {
    const root = document.documentElement
    const preference = localStorage.getItem('iwae.theme.preference')
    const dark = preference === 'dark' || (preference !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    root.dataset.theme = dark ? 'dark' : 'light'
    root.style.colorScheme = root.dataset.theme
    const palette = localStorage.getItem('iwae.theme.palette')
    if (palette === 'paper' || palette === 'navy') root.dataset.palette = palette
    const accent = localStorage.getItem('iwae.theme.accent')
    if (accent !== null && /^(blue|teal|green|violet|rose|amber)$/.test(accent)) root.dataset.accent = accent
  } catch {
    // 저장소를 못 읽으면 React 가 뜬 뒤 정한다
  }
})()

const startupWindowCommands = {
  minimize: 'plugin:window|minimize',
  maximize: 'plugin:window|toggle_maximize',
  close: 'plugin:window|close',
}

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element
    ? event.target.closest('[data-window-action]')
    : null
  const action = target?.getAttribute('data-window-action')
  const command = action === null ? undefined : startupWindowCommands[action]
  const invoke = window.__TAURI_INTERNALS__?.invoke
  if (command !== undefined && typeof invoke === 'function') {
    void invoke(command, { label: 'main' })
  }
})
