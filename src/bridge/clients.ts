/**
 * 앱 창(client) 사이 알림과 창 조작(Rust windows.rs). `@tauri-apps/api` 는 쓸 때 불러온다(브라우저·테스트에서 화면이 뜨게).
 * 알림의 종류와 뜻은 app/sessionSync.ts 에 있다.
 */
import { isDesktop } from './window'
import { openAppWindow } from './windows'
import { windowQuery } from '../core/windowMode'
import type { ClientTransport } from '../app/sessionSync'

/** Tauri 이벤트로 앱 창끼리 이야기하는 길. 데스크톱이 아니면(브라우저 · 시험) null — 혼자라서 알릴 상대가 없다 */
export function tauriClientTransport(): ClientTransport | null {
  if (!isDesktop()) return null
  return {
    emit: async (event, payload) => {
      const { emit } = await import('@tauri-apps/api/event')
      await emit(event, payload)
    },
    listen: async (event, handler) => {
      const { listen } = await import('@tauri-apps/api/event')
      return listen<unknown>(event, (message) => handler(message.payload))
    },
  }
}

export interface OpenClientArgs {
  readonly session: string
  /** 새 창이 처음 보일 화면 번호(0부터) */
  readonly screen: number | null
  /** 새 창의 이름(B · C …) */
  readonly letter: string
  readonly vaultRoot: string | null
}

/** 세션에 붙는 새 앱 창을 연다. 창을 못 열면(브라우저) null */
export async function openClientWindow(args: OpenClientArgs): Promise<{ readonly label: string } | null> {
  const query = windowQuery({ role: 'extra', docId: null, page: null, vaultRoot: args.vaultRoot, session: args.session, screen: args.screen, client: args.letter })
  const opened = await openAppWindow('extra', query)
  return opened === null ? null : { label: opened.label }
}

/** 이 창을 숨긴다(메인 창을 떼면 숨긴 채 남아 MCP · 백업을 맡는다) */
export async function hideThisWindow(): Promise<void> {
  if (!isDesktop()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('hide_this_window')
}

/** label 의 창을 다시 보인다(앱을 끝내려고 메인 창을 먼저 보일 때) */
export async function showAppWindow(label: string): Promise<void> {
  if (!isDesktop()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('show_app_window', { label })
}
