/// <reference types="vite/client" />
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import logo from '../../public/iwae-logo.png'
import { t, type Lang } from './copy'
import { stepProgress } from './ease'
import { screenFor, type Action, type Phase, type SetupState } from './screen'
import { startStarfield } from './starfield'

interface Context {
  mode: SetupState['mode']
  lang: Lang
  version: string
  existing: SetupState['existing']
  installDir: string
  defaultDir: string
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

const closeBtn = el('button', 'x', app)
closeBtn.type = 'button'
closeBtn.textContent = '✕'

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
const primaryBtn = el('button', 'btn', stack)
const secondaryBtn = el('button', 'btn ghost', stack)
const linkBtn = el('button', 'link', stack)
for (const b of [primaryBtn, secondaryBtn, linkBtn]) b.type = 'button'

const langBtn = el('button', 'lang', app)
langBtn.type = 'button'

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

function homePhase(): Phase {
  return state.mode === 'uninstall' ? 'uninstallStart' : 'start'
}

function render(): void {
  const m = screenFor(state)
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
  // While close_app runs the primary can't be pressed twice; cancel stays available.
  primaryBtn.disabled = waiting

  closeBtn.disabled = !m.closable
  closeBtn.setAttribute('aria-label', t(state.lang, 'close'))
  show(langBtn, m.showLang)
  setText(langBtn, `${t(state.lang, state.lang === 'ko' ? 'langKo' : 'langEn')} ▾`)
}

function setState(patch: Partial<SetupState>): void {
  state = { ...state, ...patch }
  render()
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
      await invoke('start_uninstall')
    } else {
      target = 0
      shown = 0
      setState({ phase: 'installing', percent: 0 })
      startEasing()
      await invoke('start_install', { dir: state.customDir })
    }
  } catch {
    // Rust refused to start (for example already busy); show the failure screen.
    setState({ phase: 'failed' })
  }
}

async function afterAppCheck(): Promise<void> {
  const running = await invoke<boolean>('app_running')
  if (running) setState({ phase: 'appRunning' })
  else await startWork()
}

async function closeApp(force: boolean): Promise<void> {
  if (waiting) return
  const seq = ++closeSeq
  waiting = true
  render()
  // If the user closes IWAE themselves the screen moves on without waiting for close_app.
  const poll = window.setInterval(async () => {
    if (seq !== closeSeq) return
    try {
      if (!(await invoke<boolean>('app_running')) && seq === closeSeq) await finish('closed')
    } catch {
      /* keep polling */
    }
  }, 500)
  const finish = async (result: string) => {
    if (seq !== closeSeq) return
    closeSeq++ // later results for this attempt are ignored
    window.clearInterval(poll)
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
  closeSeq++
  waiting = false
  setState({ phase: homePhase() })
}

async function quitWindow(): Promise<void> {
  if (state.mode === 'update' && state.phase === 'failed') await invoke('quit_relaunch_previous')
  else await invoke('quit')
}

async function run(action: Action): Promise<void> {
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
langBtn.addEventListener('click', () => {
  const lang: Lang = state.lang === 'ko' ? 'en' : 'ko'
  setState({ lang })
  void invoke('set_lang', { lang }).catch(() => {})
})

window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.isComposing) return
  const onButton = e.target instanceof HTMLButtonElement
  if (e.key === 'Enter' && !onButton) {
    const m = screenFor(state)
    if (m.primary && !primaryBtn.disabled) {
      e.preventDefault()
      void run(m.primary.action)
    }
  } else if (e.key === 'Escape') {
    if (screenFor(state).closable) {
      e.preventDefault()
      void quitWindow().catch(() => {})
    }
  }
})

async function boot(): Promise<void> {
  startStarfield(canvas)

  await listen<{ percent: number }>('setup://progress', (e) => {
    target = Math.max(target, e.payload.percent)
  })
  await listen('setup://uninstall-progress', () => setState({ phase: 'uninstalling' }))
  await listen('setup://done', () => setState({ phase: state.mode === 'uninstall' ? 'uninstalled' : 'done' }))
  await listen<{ reason: string }>('setup://failed', () => setState({ phase: 'failed' }))

  const ctx = await invoke<Context>('get_context')
  const phase: Phase = ctx.mode === 'uninstall' ? 'uninstallStart' : ctx.mode === 'update' ? 'installing' : 'start'
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

  // Show the window only after the first frame so it never opens blank.
  requestAnimationFrame(() => {
    void invoke('ready').then(() => {
      // Update mode starts by itself; Rust waits for the old app to exit first.
      if (ctx.mode === 'update') void invoke('start_install', { dir: null }).catch(() => setState({ phase: 'failed' }))
    })
  })
}

void boot()
