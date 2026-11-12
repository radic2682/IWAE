import { leaves } from '../../core/layoutTree'
import { activeScreenOf } from '../screens'
import { tabsOf } from '../tabs'
import { channelOf } from '../workspaceChannels'
import type { WorkspaceModel } from '../workspaceCommands'
import { op, type McpAppDeps, type OpContext, type OpDef } from './types'

/** 명령을 실행한 뒤의 화면 · 칸 요약(app_state 보다 짧다) */
export interface McpWorkspaceState {
  readonly active_screen: number
  readonly active_pane: number
  readonly screens: readonly {
    readonly index: number
    readonly name: string
    readonly active: boolean
    /** 크게 보는 칸 번호(없으면 null) */
    readonly zoomed: number | null
    readonly panes: readonly {
      readonly index: number
      readonly id: string
      readonly active: boolean
      readonly channel: string | null
      readonly tabs: readonly string[]
      readonly active_tab: string | null
    }[]
  }[]
}

/** 화면 · 칸을 짧은 요약으로. 칸 번호는 화면 안에서 왼쪽 위부터 0(app_state 와 같다) */
export function summarizeWorkspace(model: WorkspaceModel): McpWorkspaceState {
  const { screens, activeScreen } = model.screens
  const current = activeScreenOf(model.screens)
  return {
    active_screen: Math.max(screens.findIndex((screen) => screen.id === activeScreen), 0),
    active_pane: Math.max(leaves(current.layout).indexOf(model.activePane), 0),
    screens: screens.map((screen, index) => {
      const order = leaves(screen.layout)
      return {
        index,
        name: screen.name,
        active: screen.id === activeScreen,
        zoomed: screen.zoomed === null ? null : Math.max(order.indexOf(screen.zoomed), 0),
        panes: order.map((pane, paneIndex) => {
          const state = tabsOf(screen.panes, pane)
          return {
            index: paneIndex,
            id: pane,
            active: screen.id === activeScreen && pane === model.activePane,
            channel: channelOf(screen.channels, pane),
            tabs: state.tabs.map((tab) => tab.title),
            active_tab: state.tabs.find((tab) => tab.id === state.activeId)?.title ?? null,
          }
        }),
      }
    }),
  }
}

function needApp(ctx: OpContext): McpAppDeps {
  if (ctx.deps.app === undefined) throw new Error('app UI not available (화면을 다룰 수 없습니다).')
  return ctx.deps.app
}

/** 한 번에 받는 명령 줄 길이(글자) */
const MAX_COMMAND_CHARS = 2000

/**
 * workspace_command: 앱의 `:` 명령줄과 같은 실행기로 명령을 돌린다. 명령의 실패(모르는 명령 · 칸이 하나뿐 …)는 오류가 아니라
 * `ok:false` 와 이유로 돌려준다 — AI 가 이유를 읽고 고쳐 다시 보내도록.
 */
const workspaceCommand = async (args: Record<string, unknown>, ctx: OpContext) => {
  const app = needApp(ctx)
  if (typeof args.command !== 'string' || args.command.trim() === '') throw new Error('command(명령 줄)가 필요합니다. 예: "split-window -h ; open 노트 A"')
  if (args.command.length > MAX_COMMAND_CHARS) throw new Error(`command 가 너무 깁니다(최대 ${MAX_COMMAND_CHARS}자).`)
  const result = await app.workspaceCommand(args.command)
  ctx.change.target = args.command.trim().slice(0, 80)
  return { ok: result.ok, message: result.message === '' ? (result.ok ? 'ok' : 'failed') : result.message, state: result.state }
}

export const workspaceCommandOps: Record<string, OpDef> = {
  workspace_command: op('ui', workspaceCommand),
}
