// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { leaves } from '../../core/layoutTree'
import { addFloat } from '../floatingPanes'
import { blankScreen, type Screen } from '../screens'
import { runCommandLine, type CommandHost, type WorkspaceModel } from '../workspaceCommands'
import { fakeApp, makeEnv } from './testHarness'
import { summarizeWorkspace, type McpWorkspaceState } from './workspaceCommand'

const EMPTY: McpWorkspaceState = { active_screen: 0, active_pane: 0, active_float: null, screens: [] }

describe('MCP workspace_command', () => {
  it('명령을 앱의 실행기로 보내고 {ok, message, state} 를 돌려준다', async () => {
    const workspaceCommand = vi.fn(async () => ({ ok: true, message: '', state: EMPTY }))
    const env = makeEnv({ app: fakeApp({ workspaceCommand }) })
    const result = await env.call('workspace_command', { command: 'split-window -h ; open 노트 A' })
    expect(workspaceCommand).toHaveBeenCalledWith('split-window -h ; open 노트 A', undefined)
    expect(result).toEqual({ ok: true, message: 'ok', state: EMPTY })
  })

  it('client 로 다른 앱 창을 정할 수 있다. 빈 값이나 글이 아니면 거절한다', async () => {
    const workspaceCommand = vi.fn(async () => ({ ok: true, message: '', state: EMPTY }))
    const env = makeEnv({ app: fakeApp({ workspaceCommand }) })
    await env.call('workspace_command', { command: 'next-window', client: ' B ' })
    expect(workspaceCommand).toHaveBeenCalledWith('next-window', 'B')
    await expect(env.call('workspace_command', { command: 'next-window', client: '' })).rejects.toThrow(/client/u)
    await expect(env.call('workspace_command', { command: 'next-window', client: 2 })).rejects.toThrow(/client/u)
  })

  it('없는 앱 창을 정하면 앱이 낸 오류가 그대로 간다', async () => {
    const env = makeEnv({ app: fakeApp({ workspaceCommand: async () => { throw new Error("unknown client 'Z'") } }) })
    await expect(env.call('workspace_command', { command: 'next-window', client: 'Z' })).rejects.toThrow(/unknown client/u)
  })

  it('명령의 실패는 오류가 아니라 ok:false 와 이유로 돌려준다', async () => {
    const env = makeEnv({ app: fakeApp({ workspaceCommand: async () => ({ ok: false, message: '모르는 명령: foo — ? 로 목록', state: EMPTY }) }) })
    expect(await env.call('workspace_command', { command: 'foo' })).toEqual({ ok: false, message: '모르는 명령: foo — ? 로 목록', state: EMPTY })
    const silent = makeEnv({ app: fakeApp({ workspaceCommand: async () => ({ ok: false, message: '', state: EMPTY }) }) })
    expect((await silent.call('workspace_command', { command: 'x' })).message).toBe('failed')
  })

  it('command 가 없거나 비었거나 너무 길면 거절한다', async () => {
    const env = makeEnv({ app: fakeApp() })
    await expect(env.call('workspace_command', {})).rejects.toThrow(/command/u)
    await expect(env.call('workspace_command', { command: '   ' })).rejects.toThrow(/command/u)
    await expect(env.call('workspace_command', { command: 5 })).rejects.toThrow(/command/u)
    await expect(env.call('workspace_command', { command: 'a'.repeat(2001) })).rejects.toThrow(/너무 깁니다/u)
  })

  it('앱 화면을 다룰 수 없으면 알린다', async () => {
    const env = makeEnv()
    await expect(env.call('workspace_command', { command: 'next-window' })).rejects.toThrow(/app UI not available/u)
  })
})

describe('summarizeWorkspace', () => {
  function model(): WorkspaceModel {
    const a = blankScreen('읽기')
    const b = blankScreen('비교')
    return { screens: { screens: [a, b], activeScreen: a.id, lastScreen: null }, activePane: leaves(a.layout)[0]! }
  }

  it('화면 · 칸 번호 · 색 · 탭을 짧게 요약한다', () => {
    const base = model()
    const first = leaves(base.screens.screens[0]!.layout)[0]!
    const withTab: Screen = { ...base.screens.screens[0]!, panes: { [first]: { tabs: [{ id: 'd1', title: '문서', kind: 'pdf' }], activeId: 'd1' } }, channels: { [first]: 'green' } }
    const summary = summarizeWorkspace({ ...base, screens: { ...base.screens, screens: [withTab, base.screens.screens[1]!] } })
    expect(summary.active_screen).toBe(0)
    expect(summary.active_pane).toBe(0)
    expect(summary.screens.map((screen) => [screen.index, screen.name, screen.active, screen.zoomed])).toEqual([[0, '읽기', true, null], [1, '비교', false, null]])
    expect(summary.screens[0]!.panes).toEqual([{ index: 0, id: first, active: true, channel: 'green', tabs: ['문서'], active_tab: '문서' }])
    expect(summary.screens[1]!.panes[0]!.active).toBe(false)
  })

  it('떠 있는 칸을 floats 로 알리고, 떠 있는 칸이 만지는 칸이면 active_float 로 알린다', () => {
    const base = model()
    const added = addFloat(base, { tab: { id: 'n1', title: '노트', kind: 'memoNote' } })
    if ('error' in added) throw new Error(added.error)
    const summary = summarizeWorkspace(added.model)
    expect(summary.active_float).toBe(added.paneId)
    expect(summary.active_pane).toBe(0)
    expect(summary.screens[0]!.panes.every((pane) => !pane.active)).toBe(true)
    expect(summary.screens[0]!.floats).toEqual([{ id: added.paneId, active: true, tabs: ['노트'], active_tab: '노트' }])
    expect(summary.screens[1]!.floats).toEqual([])
    // 칸을 만지면 active_float 는 null, 떠 있는 칸은 active:false
    const touched = summarizeWorkspace({ ...added.model, activePane: leaves(added.model.screens.screens[0]!.layout)[0]! })
    expect(touched.active_float).toBeNull()
    expect(touched.screens[0]!.floats[0]!.active).toBe(false)
  })

  it('실제 명령을 돌린 뒤의 요약에 나눈 칸과 새 화면이 보인다(같은 실행기)', async () => {
    let current = model()
    const host: CommandHost = {
      getModel: () => current,
      setModel: (next) => { current = next },
      blankScreenName: (n) => `화면 ${n}`,
      templates: () => [],
    }
    const result = await runCommandLine('split-window -h ; new-window -n 셋 ; select-window -t 0', host)
    expect(result.ok).toBe(true)
    const summary = summarizeWorkspace(current)
    expect(summary.screens.map((screen) => screen.name)).toEqual(['읽기', '비교', '셋'])
    expect(summary.screens[0]!.panes).toHaveLength(2)
    expect(summary.active_screen).toBe(0)
    expect(summary.active_pane).toBe(0)
    await runCommandLine('resize-pane -Z', host)
    expect(summarizeWorkspace(current).screens[0]!.zoomed).toBe(0)
  })
})
