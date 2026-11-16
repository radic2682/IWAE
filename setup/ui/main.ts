/// <reference types="vite/client" />
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import logo from '../../public/iwae-logo.png'
import { t, type Lang } from './copy'
import { stepProgress } from './ease'
import {
  applyBootPhase,
  buttonRow,
  canStart,
  LANG_OPTIONS,
  menuStep,
  screenFor,
  watchesApp,
  type Action,
  type Phase,
  type ScreenModel,
  type SetupState,
} from './screen'
import { startStarfield } from './starfield'

interface Context {
  mode: SetupState['mode']
  lang: Lang
  version: string
  existing: SetupState['existing']
  installDir: string
  defaultDir: string
  /** Update mode starts before the listeners exist; a run that already failed is reported here. */
  failed: boolean
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  e.className = cls
  parent?.append(e)
  return e
}

// ---------- DOM (built once, only updated afterwards so focus and hover survive) ----------

const app = document.getElementById('app')!
app.classList.add('sky')

const bg = el('div', 'bg', app)
bg.setAttribute('data-tauri-drag-region', '')
const canvas = el('canvas', 'stars', app)

const stack = el('div', 'stack', app)
const logoImg = el('img', 'logo', stack)
logoImg.src = logo
logoImg.alt = ''
logoImg.draggable = false
el('div', 'name', stack).textContent = 'IWAE'
const verEl = el('div', 'ver', stack)
const titleEl = el('div', 'title', stack)
titleEl.setAttribute('role', 'status')
const subEl = el('div', 'sub', stack)
const bar = el('div', 'bar', stack)
const fill = el('i', '', bar)
// Primary and secondary share one row so a two-button screen stays as short as the others.
const btnRow = el('div', 'btns', stack)
const primaryBtn = el('button', 'btn', btnRow)
const secondaryBtn = el('button', 'btn ghost', btnRow)
const linkBtn = el('button', 'link', stack)
for (const b of [primaryBtn, secondaryBtn, linkBtn]) b.type = 'button'

const langWrap = el('div', 'langwrap', app)
const langBtn = el('button', 'lang', langWrap)
langBtn.type = 'button'
langBtn.setAttribute('aria-haspopup', 'menu')
langBtn.setAttribute('aria-expanded', 'false')
// After the button in DOM; items use tabindex -1 so Tab order stays primary, link/secondary, language, close.
const langMenu = el('div', 'langmenu', langWrap)
langMenu.setAttribute('role', 'menu')
langMenu.hidden = true
const langItems = LANG_OPTIONS.map((lang) => {
  const item = el('button', 'langitem', langMenu)
  item.type = 'button'
  item.tabIndex = -1
  item.setAttribute('role', 'menuitemradio')
  item.lang = lang
  item.textContent = t(lang, lang === 'ko' ? 'langKo' : 'langEn')
  return item
})

// Last in DOM so Tab goes primary, link/secondary, language, then close.
const closeBtn = el('button', 'x', app)
closeBtn.type = 'button'
closeBtn.textContent = '✕'

// ---------- state ----------

let state: SetupState = {
  mode: 'install',
  phase: 'start',
  lang: 'ko',
  version: '',
  existing: null,
  installDir: '',
  customDir: null,
  percent: 0,
}
let target = 0 // real percent from Rust
let shown = 0 // eased percent on screen
let waiting = false // close_app in flight
let closeSeq = 0
let pollId = 0
let starting = false // an install/uninstall start is in flight
let bootFailed = false

function clearPoll(): void {
  if (pollId) window.clearInterval(pollId)
  pollId = 0
}

function currentModel(): ScreenModel {
  const m = screenFor(state)
  if (!bootFailed) return m
  return { ...m, primary: { label: t(state.lang, 'close'), action: 'close' }, secondary: null, link: null }
}

function homePhase(): Phase {
  return state.mode === 'uninstall' ? 'uninstallStart' : 'start'
}

function render(): void {
  const m = currentModel()
  document.documentElement.lang = state.lang

  const show = (e: HTMLElement, on: boolean) => {
    e.hidden = !on
  }
  const setText = (e: HTMLElement, v: string) => {
    if (e.textContent !== v) e.textContent = v
  }

  show(verEl, m.showVersion)
  setText(verEl, t(state.lang, 'version', { v: state.version }))
  show(titleEl, m.title !== null)
  setText(titleEl, m.title ?? '')
  show(subEl, m.sub !== null)
  setText(subEl, m.sub ?? '')

  show(bar, m.progress !== null)
  bar.classList.toggle('indeterminate', m.progress === 'indeterminate')
  fill.style.width = typeof m.progress === 'number' ? `${m.progress}%` : ''

  for (const [btn, item] of [
    [primaryBtn, m.primary],
    [secondaryBtn, m.secondary],
    [linkBtn, m.link],
  ] as const) {
    show(btn, item !== null)
    if (item) {
      setText(btn, item.label)
      btn.dataset.action = item.action
    }
  }
  show(btnRow, buttonRow(m).length > 0)
  btnRow.classList.toggle('two', buttonRow(m).length > 1)
  // While close_app runs the primary can't be pressed twice; cancel stays available.
  primaryBtn.disabled = waiting

  closeBtn.disabled = !m.closable
  closeBtn.setAttribute('aria-label', t(state.lang, 'close'))
  show(langWrap, m.showLang)
  if (!m.showLang) closeLangMenu(false)
  langItems.forEach((item, i) => item.setAttribute('aria-checked', String(LANG_OPTIONS[i] === state.lang)))
  setText(langBtn, `${t(state.lang, state.lang === 'ko' ? 'langKo' : 'langEn')} ▾`)
}

function setState(patch: Partial<SetupState>): void {
  state = { ...state, ...patch }
  render()
  syncAppWatch()
}

// ---------- auto-advance while IWAE is open ----------

// On the "IWAE is open" screens the user may close IWAE by hand; once it is gone the work starts
// by itself. Runs only while one of those screens shows.
let watchId = 0
let watchInFlight = false

function syncAppWatch(): void {
  if (watchesApp(state.phase)) {
    if (!watchId) watchId = window.setInterval(() => void watchTick(), 500)
  } else if (watchId) {
    window.clearInterval(watchId)
    watchId = 0
  }
}

async function watchTick(): Promise<void> {
  // close_app has its own poll while it runs; a start already in flight wins too.
  if (watchInFlight || waiting || starting || !watchesApp(state.phase)) return
  watchInFlight = true
  try {
    const running = await invoke<boolean>('app_running')
    if (!running && !waiting && !starting && watchesApp(state.phase)) {
      starting = true
      await startWork()
    }
  } catch {
    /* keep watching */
  } finally {
    watchInFlight = false
  }
}

// ---------- progress easing (only while installing) ----------

let rafId = 0
let lastTick = 0
function tick(ms: number): void {
  rafId = 0
  if (state.phase !== 'installing') return
  const dt = lastTick ? Math.min(0.25, (ms - lastTick) / 1000) : 0
  lastTick = ms
  const next = stepProgress(shown, target, dt)
  if (next !== shown) {
    shown = next
    const rounded = Math.round(shown)
    if (rounded !== state.percent) setState({ percent: rounded })
  }
  rafId = requestAnimationFrame(tick)
}
function startEasing(): void {
  lastTick = 0
  if (!rafId) rafId = requestAnimationFrame(tick)
}

// ---------- actions ----------

async function startWork(): Promise<void> {
  try {
    if (state.mode === 'uninstall') {
      setState({ phase: 'uninstalling' })
      starting = false
      await invoke('start_uninstall')
    } else {
      target = 0
      shown = 0
      setState({ phase: 'installing', percent: 0 })
      startEasing()
      starting = false
      await invoke('start_install', { dir: state.customDir })
    }
  } catch (e) {
    starting = false
    // Busy means a run is already going (double activation); stay on the progress screen.
    if (String(e).includes('busy')) return
    setState({ phase: 'failed' })
  }
}

async function afterAppCheck(): Promise<void> {
  const running = await invoke<boolean>('app_running')
  if (running) {
    starting = false
    setState({ phase: 'appRunning' })
  } else await startWork()
}

async function closeApp(force: boolean): Promise<void> {
  if (waiting) return
  const seq = ++closeSeq
  waiting = true
  render()
  // If the user closes IWAE themselves the screen moves on without waiting for close_app.
  clearPoll()
  pollId = window.setInterval(async () => {
    if (seq !== closeSeq) return
    try {
      if (!(await invoke<boolean>('app_running')) && seq === closeSeq) await finish('closed')
    } catch {
      /* keep polling */
    }
  }, 500)
  const finish = async (result: string) => {
    if (seq !== closeSeq) {
      clearPoll()
      return
    }
    closeSeq++ // later results for this attempt are ignored
    clearPoll()
    waiting = false
    if (result === 'closed') await startWork()
    else {
      setState({ phase: 'appStuck' })
    }
  }
  try {
    await finish(await invoke<string>('close_app', { force }))
  } catch {
    await finish('stillRunning')
  }
}

function cancelClose(): void {
  clearPoll()
  closeSeq++
  waiting = false
  setState({ phase: homePhase() })
}

async function quitWindow(): Promise<void> {
  if (!bootFailed && state.mode === 'update' && state.phase === 'failed') await invoke('quit_relaunch_previous')
  else await invoke('quit')
}

async function run(action: Action): Promise<void> {
  if (action === 'install' || action === 'uninstall' || action === 'retry') {
    if (starting || !canStart(state.phase)) return
    starting = true
  }
  try {
    switch (action) {
      case 'install':
      case 'uninstall':
        return await afterAppCheck()
      case 'closeAndInstall':
      case 'closeAndUninstall':
        return await closeApp(false)
      case 'forceClose':
        return await closeApp(true)
      case 'pickDir': {
        const dir = await invoke<string | null>('pick_dir')
        if (dir) setState({ customDir: dir })
        return
      }
      case 'cancel':
        return cancelClose()
      case 'retry':
        return await startWork()
      case 'openApp':
        return await invoke('open_app')
      case 'showLog':
        return await invoke('show_log')
      case 'close':
        return await quitWindow()
    }
  } catch {
    starting = false
    /* a failed helper command leaves the screen as it is */
  }
}

// ---------- wiring ----------

for (const b of [primaryBtn, secondaryBtn, linkBtn]) {
  b.addEventListener('click', () => {
    if (b.dataset.action) void run(b.dataset.action as Action)
  })
}
closeBtn.addEventListener('click', () => {
  if (!closeBtn.disabled) void quitWindow().catch(() => {})
})
// ---------- language menu ----------

function langMenuOpen(): boolean {
  return !langMenu.hidden
}

function openLangMenu(focusIndex?: number): void {
  langMenu.hidden = false
  langBtn.setAttribute('aria-expanded', 'true')
  const i = focusIndex ?? Math.max(0, LANG_OPTIONS.indexOf(state.lang))
  langItems[i]!.focus()
}

function closeLangMenu(refocus: boolean): void {
  if (!langMenuOpen()) return
  langMenu.hidden = true
  langBtn.setAttribute('aria-expanded', 'false')
  if (refocus) langBtn.focus()
}

function chooseLang(lang: Lang): void {
  closeLangMenu(true)
  if (lang === state.lang) return
  setState({ lang })
  void invoke('set_lang', { lang }).catch(() => {})
}

langBtn.addEventListener('click', () => (langMenuOpen() ? closeLangMenu(true) : openLangMenu()))
langBtn.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault()
    if (!langMenuOpen()) openLangMenu()
  }
})
langItems.forEach((item, i) => {
  item.addEventListener('click', () => chooseLang(LANG_OPTIONS[i]!))
  item.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      langItems[menuStep(i, e.key, langItems.length)]!.focus()
    } else if (e.key === 'Tab') closeLangMenu(false)
  })
})
// Capture phase and first in line, so Esc closes only the menu and never quits the window.
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape' && langMenuOpen()) {
      e.preventDefault()
      e.stopImmediatePropagation()
      closeLangMenu(true)
    }
  },
  true,
)
window.addEventListener('pointerdown', (e) => {
  if (langMenuOpen() && !(e.target instanceof Node && langWrap.contains(e.target))) closeLangMenu(true)
})
window.addEventListener('blur', () => closeLangMenu(false))

window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.isComposing || e.repeat) return
  const onButton = e.target instanceof HTMLButtonElement
  if (e.key === 'Enter' && !onButton) {
    const m = currentModel()
    if (m.primary && !primaryBtn.disabled) {
      e.preventDefault()
      void run(m.primary.action)
    }
  } else if (e.key === 'Escape') {
    if (currentModel().closable) {
      e.preventDefault()
      void quitWindow().catch(() => {})
    }
  }
})

async function bootInner(): Promise<void> {
  startStarfield(canvas)

  await listen<{ percent: number }>('setup://progress', (e) => {
    target = Math.max(target, e.payload.percent)
  })
  await listen('setup://uninstall-progress', () => setState({ phase: 'uninstalling' }))
  await listen('setup://done', () => setState({ phase: state.mode === 'uninstall' ? 'uninstalled' : 'done' }))
  await listen<{ reason: string }>('setup://failed', () => setState({ phase: 'failed' }))

  const ctx = await invoke<Context>('get_context')
  const phase: Phase = applyBootPhase(state.phase, ctx.mode, ctx.failed)
  state = {
    mode: ctx.mode,
    phase,
    lang: ctx.lang,
    version: ctx.version,
    existing: ctx.existing,
    installDir: ctx.installDir,
    customDir: null,
    percent: 0,
  }
  render()
  if (phase === 'installing') startEasing()

  // Show the window only after the first frame so it never opens blank. Update mode needs no
  // start call: Rust starts it when the window is built. A late `start_install` here could only
  // get "busy", or start an unasked second run after a quick failure, so none is sent.
  requestAnimationFrame(() => {
    void invoke('ready').catch(() => {})
  })
}

async function boot(): Promise<void> {
  try {
    await bootInner()
  } catch {
    // Never leave a hidden window: show a failure screen that can only close.
    bootFailed = true
    state = { ...state, phase: 'failed' }
    render()
    void invoke('ready').catch(() => {})
  }
}

void boot()
