import { t, type Lang } from './copy'

export type Phase =
  | 'start'
  | 'appRunning'
  | 'appStuck'
  | 'installing'
  | 'done'
  | 'failed'
  | 'uninstallStart'
  | 'uninstalling'
  | 'uninstalled'

export interface SetupState {
  mode: 'install' | 'update' | 'uninstall'
  phase: Phase
  lang: Lang
  version: string
  existing: null | { version: string; kind: 'upgrade' | 'same' | 'downgrade' }
  installDir: string
  customDir: string | null
  percent: number
}

export type Action =
  | 'install'
  | 'pickDir'
  | 'closeAndInstall'
  | 'forceClose'
  | 'cancel'
  | 'openApp'
  | 'retry'
  | 'showLog'
  | 'close'
  | 'uninstall'
  | 'closeAndUninstall'

interface Labeled {
  label: string
  action: Action
}

export interface ScreenModel {
  title: string | null
  sub: string | null
  primary: Labeled | null
  secondary: Labeled | null
  link: Labeled | null
  showVersion: boolean
  progress: number | 'indeterminate' | null
  closable: boolean
  showLang: boolean
}

/** Phases from which a start/retry may begin; anything else means work is already under way. */
export function canStart(phase: Phase): boolean {
  return phase === 'start' || phase === 'appRunning' || phase === 'appStuck' || phase === 'failed' || phase === 'uninstallStart'
}

/** Screens that keep checking whether IWAE is still open and move on by themselves once it is not. */
export function watchesApp(phase: Phase): boolean {
  return phase === 'appRunning' || phase === 'appStuck'
}

/** First screen. Update mode is already running in Rust, or has already failed before the page loaded. */
export function bootPhase(mode: SetupState['mode'], failed: boolean): Phase {
  if (mode === 'uninstall') return 'uninstallStart'
  if (mode === 'update') return failed ? 'failed' : 'installing'
  return 'start'
}

const MAX_PATH = 34

/** At most 34 characters; a longer path keeps its end behind a leading ellipsis. */
export function shortPath(p: string): string {
  const chars = Array.from(p)
  if (chars.length <= MAX_PATH) return p
  return '…' + chars.slice(-(MAX_PATH - 1)).join('')
}

const blank: ScreenModel = {
  title: null,
  sub: null,
  primary: null,
  secondary: null,
  link: null,
  showVersion: false,
  progress: null,
  closable: true,
  showLang: false,
}

export function screenFor(s: SetupState): ScreenModel {
  const L = s.lang
  const uninstall = s.mode === 'uninstall'
  const m = (o: Partial<ScreenModel>): ScreenModel => ({ ...blank, ...o })

  switch (s.phase) {
    case 'start': {
      const kind = s.existing?.kind
      const label = kind === 'upgrade' ? t(L, 'update') : kind === 'same' ? t(L, 'reinstall') : t(L, 'install')
      const sub = kind === 'downgrade' ? t(L, 'olderNote', { v: s.existing!.version }) : null
      // An existing install keeps its folder, so the location link only shows on a fresh install.
      const link: Labeled | null = s.existing
        ? null
        : {
            label: s.customDir ? `${shortPath(s.customDir)} ${t(L, 'change')}` : t(L, 'changeLocation'),
            action: 'pickDir',
          }
      return m({ sub, primary: { label, action: 'install' }, link, showVersion: true, showLang: true })
    }
    case 'appRunning':
      return m({
        title: t(L, 'appOpen'),
        sub: t(L, 'appOpenSub'),
        primary: uninstall
          ? { label: t(L, 'closeAndUninstall'), action: 'closeAndUninstall' }
          : { label: t(L, 'closeAndInstall'), action: 'closeAndInstall' },
        link: { label: t(L, 'cancel'), action: 'cancel' },
        showLang: true,
      })
    case 'appStuck':
      return m({
        title: t(L, 'appStuck'),
        primary: { label: t(L, 'forceClose'), action: 'forceClose' },
        secondary: { label: t(L, 'cancel'), action: 'cancel' },
        showLang: true,
      })
    case 'installing': {
      const p = Math.max(0, Math.min(100, Math.round(s.percent)))
      return m({ title: t(L, 'installing', { p }), progress: p, closable: false })
    }
    case 'done':
      return m({ title: t(L, 'installed'), primary: { label: t(L, 'openApp'), action: 'openApp' } })
    case 'failed':
      return m({
        title: uninstall ? t(L, 'uninstallFailed') : t(L, 'failed'),
        sub: t(L, 'failedSub'),
        primary: { label: t(L, 'retry'), action: 'retry' },
        link: { label: t(L, 'showLog'), action: 'showLog' },
        secondary: s.mode === 'install' ? null : { label: t(L, 'close'), action: 'close' },
        showLang: true,
      })
    case 'uninstallStart':
      return m({
        title: t(L, 'uninstallTitle'),
        sub: t(L, 'uninstallSub'),
        primary: { label: t(L, 'uninstall'), action: 'uninstall' },
        showVersion: true,
        showLang: true,
      })
    case 'uninstalling':
      return m({ title: t(L, 'uninstalling'), progress: 'indeterminate', closable: false })
    case 'uninstalled':
      return m({ title: t(L, 'uninstalled'), primary: { label: t(L, 'close'), action: 'close' } })
  }
}
