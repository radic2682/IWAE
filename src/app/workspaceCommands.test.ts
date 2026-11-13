import { beforeEach, describe, expect, it, vi } from 'vitest'
import { leaves, paneNode, type LayoutNode } from '../core/layoutTree'
import { activeScreenOf, blankScreen, type Screen, type ScreensState } from './screens'
import { emptyTabs } from './tabs'
import {
  canonicalCommandName, commandNames, findScreenIndex, neighborPane, nameMatchRank, parseCommandLine, pickByName, resetLayoutCycle, runCommandLine, splitCommandLine,
  type CommandHost, type PaneRect, type WorkspaceModel,
} from './workspaceCommands'

const TEMPLATES = [
  { id: 'read', label: '읽기' },
  { id: 'noteLeft', label: '노트 왼쪽' },
  { id: 'compare', label: '비교' },
  { id: 'blank', label: '빈 화면' },
] as const

function oneScreen(name = '읽기'): WorkspaceModel {
  const screen = blankScreen(name)
  return { screens: { screens: [screen], activeScreen: screen.id, lastScreen: null }, activePane: leaves(screen.layout)[0]! }
}

function harness(model: WorkspaceModel = oneScreen(), extras: Partial<CommandHost> = {}) {
  let current = model
  const host: CommandHost = {
    getModel: () => current,
    setModel: (next) => { current = next },
    blankScreenName: (count) => `화면 ${count}`,
    templates: () => TEMPLATES,
    ...extras,
  }
  return { host, model: () => current, screen: () => activeScreenOf(current.screens), run: (line: string) => runCommandLine(line, host) }
}

/** 한 칸을 나눠 칸이 둘인 화면: [a | b], 만지는 칸은 a */
const split = async (h: ReturnType<typeof harness>, line = 'split-window -h') => { const result = await h.run(line); expect(result.ok, result.message).toBe(true) }

beforeEach(() => resetLayoutCycle())

describe('파서', () => {
  it('줄임말을 정식 이름으로 읽는다', () => {
    const aliases: Record<string, string> = {
      splitw: 'split-window', neww: 'new-window', killp: 'kill-pane', selectl: 'select-layout', selectp: 'select-pane', resizep: 'resize-pane',
      renamew: 'rename-window', selectw: 'select-window', breakp: 'break-pane', swapp: 'swap-pane', joinp: 'join-pane',
      next: 'next-window', prev: 'previous-window', last: 'last-window',
    }
    for (const [alias, name] of Object.entries(aliases)) {
      expect(canonicalCommandName(alias), alias).toBe(name)
      const parsed = parseCommandLine(alias)
      expect(parsed.ok && parsed.commands[0]?.name, alias).toBe(name)
    }
  })

  it('앞의 「:」 는 떼고, `;` 로 여러 명령을 읽는다(따옴표 안의 ; 는 글자)', () => {
    const parsed = parseCommandLine(': split-window -h ; open "노트 A; 1" ; select-pane -L')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.commands.map((command) => command.name)).toEqual(['split-window', 'open', 'select-pane'])
    expect(parsed.commands[1]!.args).toEqual(['노트 A; 1'])
    expect(splitCommandLine('a ; b;c')).toEqual([['a'], ['b'], ['c']])
    expect(splitCommandLine('rename-window a\\;b')).toEqual([['rename-window', 'a;b']])
  })

  it('옵션: 값 없는 옵션 · 값 받는 옵션(-t 3, -t3) · 남는 글자', () => {
    const parsed = parseCommandLine('new-window -n 비교 -t 읽기')
    expect(parsed.ok && parsed.commands[0]?.flags).toEqual({ n: '비교', t: '읽기' })
    const attached = parseCommandLine('select-pane -t2')
    expect(attached.ok && attached.commands[0]?.flags).toEqual({ t: '2' })
    const bool = parseCommandLine('split-window -h')
    expect(bool.ok && bool.commands[0]?.flags).toEqual({ h: true })
    const rest = parseCommandLine('rename-window 두 단어 이름')
    expect(rest.ok && rest.commands[0]?.args).toEqual(['두', '단어', '이름'])
  })

  it('오류: 모르는 명령 · 모르는 옵션 · 값이 없는 -t · 빈 줄 · 닫히지 않은 따옴표', () => {
    expect(parseCommandLine('foo')).toEqual({ ok: false, message: '알 수 없는 명령: foo. ?를 입력하면 목록이 나옵니다' })
    const flag = parseCommandLine('split-window -x')
    expect(flag.ok).toBe(false)
    expect(!flag.ok && flag.message).toContain('-x')
    expect(parseCommandLine('select-window -t').ok).toBe(false)
    expect(parseCommandLine('   ').ok).toBe(false)
    expect(parseCommandLine(':').ok).toBe(false)
    expect(parseCommandLine('open "열린 따옴표').ok).toBe(false)
    // 줄 한가운데의 모르는 명령도 줄 전체를 거부한다(앞 명령을 실행하지 않는다)
    expect(parseCommandLine('split-window -h ; nope').ok).toBe(false)
  })

  it('new-client · detach 는 읽히고(-t 세션, 줄임말 newc) 완성 목록에 나온다. 안쪽 명령은 나오지 않는다', () => {
    const parsed = parseCommandLine('new-client -t 논문 ; detach')
    expect(parsed.ok && parsed.commands.map((command) => [command.name, command.flags.t, command.soon])).toEqual([['new-client', '논문', false], ['detach', undefined, false]])
    expect(canonicalCommandName('newc')).toBe('new-client')
    expect(canonicalCommandName('detach-client')).toBe('detach')
    expect(commandNames()).toContain('detach')
    expect(commandNames()).toContain('new-client')
    expect(commandNames()).not.toContain('command-prompt')
  })
})

describe('이름 찾기', () => {
  it('같음 < 앞부분 < 포함 < 낱말 모두 < 글자 차례', () => {
    expect(nameMatchRank('노트 A', '노트 a')).toBe(0)
    expect(nameMatchRank('노트 A 초안', '노트 a')).toBe(1)
    expect(nameMatchRank('IWAE 노트 A', '노트 a')).toBe(2)
    expect(nameMatchRank('A 의 노트', '노트 a')).toBe(3)
    expect(nameMatchRank('노 트 A', '노트a')).toBe(4)
    expect(nameMatchRank('다른 글', '노트')).toBeNull()
    expect(nameMatchRank('x', '  ')).toBeNull()
  })

  it('가장 잘 맞는 항목, 같으면 짧은 이름', () => {
    const items = [{ label: '노트 A 초안' }, { label: '노트 A' }, { label: '메모' }]
    expect(pickByName(items, '노트 a')?.label).toBe('노트 A')
    expect(pickByName(items, '초안')?.label).toBe('노트 A 초안')
    expect(pickByName(items, '없는 것')).toBeNull()
  })

  it('화면은 번호나 이름으로 찾는다', () => {
    const a = blankScreen('읽기')
    const b = blankScreen('비교')
    const state: ScreensState = { screens: [a, b], activeScreen: a.id, lastScreen: null }
    expect(findScreenIndex(state, '1')).toBe(1)
    expect(findScreenIndex(state, '5')).toBe(-1)
    expect(findScreenIndex(state, '비교')).toBe(1)
    expect(findScreenIndex(state, '읽')).toBe(0)
    expect(findScreenIndex(state, '없음')).toBe(-1)
  })
})

describe('칸 방향 이동(neighborPane)', () => {
  // 위: a | b, 아래: c(전체 폭)
  const rects = new Map<string, PaneRect>([
    ['a', { left: 0, top: 0, right: 50, bottom: 50 }],
    ['b', { left: 50, top: 0, right: 100, bottom: 50 }],
    ['c', { left: 0, top: 50, right: 100, bottom: 100 }],
  ])

  it('방향의 가장 가까운 칸', () => {
    expect(neighborPane(rects, 'a', 'R')).toBe('b')
    expect(neighborPane(rects, 'b', 'L')).toBe('a')
    expect(neighborPane(rects, 'a', 'D')).toBe('c')
    expect(neighborPane(rects, 'c', 'U')).toBe('a')
  })

  it('맞닿은 칸이 여럿이면 겹친 길이가 긴 칸', () => {
    const wide = new Map<string, PaneRect>([
      ['x', { left: 0, top: 0, right: 100, bottom: 100 }],
      ['p', { left: 100, top: 0, right: 200, bottom: 30 }],
      ['q', { left: 100, top: 30, right: 200, bottom: 100 }],
    ])
    expect(neighborPane(wide, 'x', 'R')).toBe('q')
  })

  it('끝에서는 반대편으로 돌아 나가고, 갈 데가 없으면 null', () => {
    expect(neighborPane(rects, 'b', 'R')).toBe('a')
    expect(neighborPane(rects, 'c', 'D')).toBe('a')
    expect(neighborPane(new Map([['solo', { left: 0, top: 0, right: 10, bottom: 10 }]]), 'solo', 'L')).toBeNull()
  })
})

describe('명령 실행: 칸', () => {
  it('split-window -h 는 좌우로, -v(기본)는 위아래로 나누고 새 칸을 만진다', async () => {
    const h = harness()
    const first = h.model().activePane
    await split(h, 'split-window -h')
    const layout = h.screen().layout
    expect(layout.kind).toBe('split')
    expect(layout.kind === 'split' && layout.dir).toBe('h')
    expect(leaves(layout)).toHaveLength(2)
    expect(h.model().activePane).toBe(leaves(layout)[1])
    expect(h.model().activePane).not.toBe(first)
    await split(h, 'splitw')
    expect(leaves(h.screen().layout)).toHaveLength(3)
    const root = h.screen().layout as Extract<LayoutNode, { kind: 'split' }>
    expect(root.b.kind === 'split' && root.b.dir).toBe('v')
  })

  it('새 칸은 비어 있고 지금 칸의 색을 받는다', async () => {
    const h = harness()
    await h.run('set-channel green')
    await split(h)
    const created = h.model().activePane
    expect(h.screen().channels[created]).toBe('green')
    expect(h.screen().panes[created]).toEqual(emptyTabs)
  })

  it('칸이 8개면 나누지 못하고 알린다', async () => {
    const h = harness()
    for (let n = 0; n < 7; n += 1) await split(h)
    const result = await h.run('split-window')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('8')
    expect(leaves(h.screen().layout)).toHaveLength(8)
  })

  it('select-pane: 방향 · 번호 · 다음(-n) · 앞(-p)', async () => {
    const h = harness()
    await split(h, 'split-window -h')
    const [left, right] = leaves(h.screen().layout) as [string, string]
    await h.run('select-pane -L')
    expect(h.model().activePane).toBe(left)
    await h.run('selectp -R')
    expect(h.model().activePane).toBe(right)
    await h.run('select-pane -t 0')
    expect(h.model().activePane).toBe(left)
    await h.run('select-pane -n')
    expect(h.model().activePane).toBe(right)
    await h.run('select-pane -p')
    expect(h.model().activePane).toBe(left)
    expect((await h.run('select-pane -t 5')).ok).toBe(false)
    expect((await h.run('select-pane -t x')).ok).toBe(false)
  })

  it('select-pane 의 방향 이동은 호스트가 준 화면 사각형을 쓴다', async () => {
    const h = harness()
    await split(h, 'split-window -h')
    const [left, right] = leaves(h.screen().layout) as [string, string]
    // 사각형이 위아래로 놓였다고 알려 주면 -D 가 오른쪽 칸으로 간다
    const rects = new Map<string, PaneRect>([[left, { left: 0, top: 0, right: 100, bottom: 50 }], [right, { left: 0, top: 50, right: 100, bottom: 100 }]])
    const h2 = harness(h.model(), { paneRects: () => rects })
    await h2.run('select-pane -t 0')
    await h2.run('select-pane -D')
    expect(h2.model().activePane).toBe(right)
  })

  it('칸이 하나면 방향 이동은 알리고 가만히 둔다', async () => {
    const h = harness()
    const before = h.model().activePane
    const result = await h.run('select-pane -L')
    expect(result.ok).toBe(false)
    expect(h.model().activePane).toBe(before)
  })

  it('resize-pane -Z 는 크게/원래 크기로를 오가고, 칸이 하나면 알린다', async () => {
    const h = harness()
    expect((await h.run('resize-pane -Z')).ok).toBe(false)
    await split(h)
    await h.run('resize-pane -Z')
    expect(h.screen().zoomed).toBe(h.model().activePane)
    await h.run('resizep -Z')
    expect(h.screen().zoomed).toBeNull()
    expect((await h.run('resize-pane')).ok).toBe(false)
  })

  it('크게 보던 중 select-pane 이나 나누기는 크게를 푼다', async () => {
    const h = harness()
    await split(h)
    await h.run('resize-pane -Z')
    await h.run('select-pane -t 0')
    expect(h.screen().zoomed).toBeNull()
    await h.run('resize-pane -Z')
    await split(h)
    expect(h.screen().zoomed).toBeNull()
  })

  it('kill-pane 은 칸을 닫고 탭을 이웃 칸으로 합치며 이웃을 만진다. 하나뿐이면 알린다', async () => {
    const h = harness()
    expect((await h.run('kill-pane')).ok).toBe(false)
    await split(h)
    const [left, right] = leaves(h.screen().layout) as [string, string]
    const model = h.model()
    const withTab: WorkspaceModel = {
      ...model,
      screens: { ...model.screens, screens: model.screens.screens.map((screen) => ({ ...screen, panes: { ...screen.panes, [right]: { tabs: [{ id: 'd1', title: 'D', kind: 'pdf' as const }], activeId: 'd1' } } })) },
    }
    const h2 = harness(withTab)
    await h2.run('killp')
    expect(leaves(h2.screen().layout)).toEqual([left])
    expect(h2.model().activePane).toBe(left)
    expect(h2.screen().panes[left]!.tabs.map((tab) => tab.id)).toEqual(['d1'])
    expect(h2.screen().panes[right]).toBeUndefined()
  })

  it('swap-pane -U/-D 는 칸 자리를 바꾸고 만지는 칸은 그대로다(끝에서는 돌아 나간다)', async () => {
    const h = harness()
    await split(h)
    const [left, right] = leaves(h.screen().layout) as [string, string]
    await h.run('select-pane -t 0')
    await h.run('swap-pane -D')
    expect(leaves(h.screen().layout)).toEqual([right, left])
    expect(h.model().activePane).toBe(left)
    await h.run('swapp -U')
    expect(leaves(h.screen().layout)).toEqual([left, right])
    expect((await harness().run('swap-pane -D')).ok).toBe(false)
  })

  it('select-layout 은 이름대로 다시 짜고, 이름이 없으면 차례로 돈다', async () => {
    const h = harness()
    await split(h)
    await split(h)
    await h.run('select-layout main-vertical')
    const root = h.screen().layout as Extract<LayoutNode, { kind: 'split' }>
    expect(root.dir).toBe('h')
    expect(root.a).toEqual(paneNode(leaves(h.screen().layout)[0]!))
    await h.run('selectl even-vertical')
    expect((h.screen().layout as Extract<LayoutNode, { kind: 'split' }>).dir).toBe('v')
    // 차례로 돌기: 방금 even-vertical(1번) 다음은 main-vertical
    const cycled = await h.run('select-layout')
    expect(cycled.message).toBe('배치: 큰 칸 + 세로')
    expect((await h.run('select-layout nope')).ok).toBe(false)
    expect((await harness().run('select-layout tiled')).ok).toBe(false)
  })

  it('set-channel 은 지금 칸의 색을 정한다(none 은 연동 끔)', async () => {
    const h = harness()
    const pane = h.model().activePane
    await h.run('set-channel orange')
    expect(h.screen().channels[pane]).toBe('orange')
    await h.run('set-channel none')
    expect(h.screen().channels[pane]).toBeNull()
    expect((await h.run('set-channel purple')).ok).toBe(false)
    expect((await h.run('set-channel')).ok).toBe(false)
  })
})

describe('명령 실행: 화면', () => {
  it('new-window 는 빈 화면을 맨 뒤에 만들어 그리로 간다(-n 이름)', async () => {
    const h = harness()
    await h.run('new-window')
    const screens = h.model().screens
    expect(screens.screens).toHaveLength(2)
    expect(screens.screens[1]!.name).toBe('화면 1')
    expect(screens.activeScreen).toBe(screens.screens[1]!.id)
    expect(screens.lastScreen).toBe(screens.screens[0]!.id)
    expect(h.model().activePane).toBe(leaves(screens.screens[1]!.layout)[0])
    await h.run('neww -n 비교')
    expect(h.model().screens.screens[2]!.name).toBe('비교')
    // 칸 id 는 모든 화면에서 겹치지 않는다
    const ids = h.model().screens.screens.flatMap((screen) => leaves(screen.layout))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('new-window -t 템플릿은 앱에 맡기고 이름을 넘긴다. 빈 화면은 바로 만든다', async () => {
    const newWindowFromTemplate = vi.fn(async () => undefined)
    const h = harness(oneScreen(), { newWindowFromTemplate })
    await h.run('new-window -t 읽기 -n 논문')
    expect(newWindowFromTemplate).toHaveBeenCalledWith('read', '논문', h.model().activePane)
    await h.run('new-window -t 빈 화면'.replace('빈 화면', '"빈 화면"'))
    expect(h.model().screens.screens).toHaveLength(2)
    const missing = await h.run('new-window -t 없는템플릿')
    expect(missing.ok).toBe(false)
    expect(missing.message).toContain('없는템플릿')
  })

  it('select-window / next / previous / last', async () => {
    const h = harness()
    await h.run('new-window -n 둘')
    await h.run('new-window -n 셋')
    const ids = h.model().screens.screens.map((screen) => screen.id)
    await h.run('select-window -t 0')
    expect(h.model().screens.activeScreen).toBe(ids[0])
    expect(h.model().activePane).toBe(leaves(h.screen().layout)[0])
    await h.run('selectw -t 둘')
    expect(h.model().screens.activeScreen).toBe(ids[1])
    await h.run('next-window')
    expect(h.model().screens.activeScreen).toBe(ids[2])
    await h.run('next')
    expect(h.model().screens.activeScreen).toBe(ids[0])
    await h.run('prev')
    expect(h.model().screens.activeScreen).toBe(ids[2])
    await h.run('last-window')
    expect(h.model().screens.activeScreen).toBe(ids[0])
    expect((await h.run('select-window -t 9')).ok).toBe(false)
    expect((await h.run('select-window')).ok).toBe(false)
  })

  it('화면이 하나면 next/prev/last 는 알린다', async () => {
    const h = harness()
    expect((await h.run('next-window')).ok).toBe(false)
    expect((await h.run('previous-window')).ok).toBe(false)
    expect((await h.run('last-window')).ok).toBe(false)
  })

  it('rename-window 는 보는 화면의 이름을 바꾼다(여러 낱말도)', async () => {
    const h = harness()
    await h.run('rename-window 논문 읽기')
    expect(activeScreenOf(h.model().screens).name).toBe('논문 읽기')
    await h.run('renamew "따옴표 이름"')
    expect(activeScreenOf(h.model().screens).name).toBe('따옴표 이름')
    expect((await h.run('rename-window')).ok).toBe(false)
  })

  it('kill-window 는 보는 화면을 닫고 바로 앞 화면으로 간다. 하나뿐이면 알린다', async () => {
    const h = harness()
    expect((await h.run('kill-window')).ok).toBe(false)
    await h.run('new-window -n 둘')
    const first = h.model().screens.screens[0]!.id
    await h.run('killw')
    expect(h.model().screens.screens).toHaveLength(1)
    expect(h.model().screens.activeScreen).toBe(first)
    expect(h.model().activePane).toBe(leaves(h.screen().layout)[0])
  })

  it('break-pane 은 칸을 새 화면으로 떼어 그리로 간다(탭 · 색을 가진 채). 칸이 하나면 알린다', async () => {
    const h = harness()
    expect((await h.run('break-pane')).ok).toBe(false)
    await split(h)
    const moved = h.model().activePane
    await h.run('breakp')
    expect(h.model().screens.screens).toHaveLength(2)
    expect(leaves(h.model().screens.screens[1]!.layout)).toEqual([moved])
    expect(h.model().screens.activeScreen).toBe(h.model().screens.screens[1]!.id)
    expect(h.model().activePane).toBe(moved)
    expect(leaves(h.model().screens.screens[0]!.layout)).toHaveLength(1)
  })

  it('join-pane -s N 은 그 화면의 첫 칸을 지금 칸 옆으로 가져온다(하나뿐인 화면은 닫힌다)', async () => {
    const h = harness()
    await h.run('new-window -n 둘')
    // 둘째 화면에서 칸을 둘로 나눠 두고 첫 화면으로 돌아온다
    await split(h)
    const [firstOfTwo] = leaves(h.screen().layout) as [string, string]
    await h.run('select-window -t 0')
    const here = h.model().activePane
    await h.run('join-pane -s 1')
    expect(leaves(h.screen().layout)).toEqual([here, firstOfTwo])
    expect(h.model().activePane).toBe(firstOfTwo)
    expect(h.model().screens.screens).toHaveLength(2)
    expect(leaves(h.model().screens.screens[1]!.layout)).toHaveLength(1)
    // 남은 한 칸짜리 화면도 가져오면 그 화면은 사라진다
    await h.run('joinp -s 1')
    expect(h.model().screens.screens).toHaveLength(1)
    expect(leaves(h.screen().layout)).toHaveLength(3)
    expect((await h.run('join-pane -s 0')).ok).toBe(false)
    expect((await h.run('join-pane')).ok).toBe(false)
    expect((await h.run('join-pane -s 7')).ok).toBe(false)
  })

  it('join-pane 이 가져온 칸은 탭과 색을 그대로 가진다', async () => {
    const a = blankScreen('가')
    const b = blankScreen('나')
    const pane = leaves(b.layout)[0]!
    const screens: ScreensState = {
      screens: [a, { ...b, panes: { [pane]: { tabs: [{ id: 'n1', title: 'N', kind: 'memoNote' as const }], activeId: 'n1' } }, channels: { [pane]: 'orange' } } as Screen],
      activeScreen: a.id,
      lastScreen: null,
    }
    const h = harness({ screens, activePane: leaves(a.layout)[0]! })
    await h.run('join-pane -s 나')
    expect(h.screen().panes[pane]!.tabs[0]!.id).toBe('n1')
    expect(h.screen().channels[pane]).toBe('orange')
  })
})

describe('명령 실행: 앱이 하는 일', () => {
  it('open 은 이름과 지금 칸을 앱에 넘기고, 앱의 답을 돌려준다', async () => {
    const open = vi.fn(async () => ({ ok: true, message: '열었습니다' }))
    const h = harness(oneScreen(), { open })
    const result = await h.run('open 노트 A')
    expect(open).toHaveBeenCalledWith('노트 A', h.model().activePane)
    expect(result).toEqual({ ok: true, message: '열었습니다' })
    expect((await h.run('open')).ok).toBe(false)
    expect((await harness().run('open 노트')).ok).toBe(false)
  })

  it('note-beside · apply-template · display-panes · list-keys · command-prompt 는 손잡이를 부른다', async () => {
    const noteBeside = vi.fn(async () => undefined)
    const applyTemplate = vi.fn(async () => undefined)
    const displayPanes = vi.fn()
    const listKeys = vi.fn()
    const promptCommand = vi.fn()
    const h = harness(oneScreen(), { noteBeside, applyTemplate, displayPanes, listKeys, promptCommand })
    await h.run('note-beside')
    expect(noteBeside).toHaveBeenCalledWith(h.model().activePane)
    await h.run('apply-template 비교')
    expect(applyTemplate).toHaveBeenCalledWith('compare', h.model().activePane)
    await h.run('displayp')
    expect(displayPanes).toHaveBeenCalled()
    await h.run('list-keys')
    expect(listKeys).toHaveBeenCalled()
    await h.run('command-prompt')
    expect(promptCommand).toHaveBeenCalledWith('')
    await h.run('rename-prompt')
    expect(promptCommand).toHaveBeenLastCalledWith('rename-window 읽기')
    expect((await h.run('apply-template 빈 화면')).ok).toBe(false)
    expect((await h.run('apply-template 없는것')).ok).toBe(false)
    expect((await h.run('apply-template')).ok).toBe(false)
  })

  it('confirm-kill-window 는 화면이 둘 이상일 때만 확인을 묻는다', async () => {
    const confirmKillWindow = vi.fn()
    const h = harness(oneScreen(), { confirmKillWindow })
    expect((await h.run('confirm-kill-window')).ok).toBe(false)
    await h.run('new-window')
    await h.run('confirm-kill-window')
    expect(confirmKillWindow).toHaveBeenCalledOnce()
    expect(h.model().screens.screens).toHaveLength(2)
  })

  it('source-file 은 keys.conf 를 다시 읽는 손잡이를 부른다', async () => {
    const reloadKeys = vi.fn(async () => ({ ok: true, message: 'keys.conf를 읽었습니다' }))
    const h = harness(oneScreen(), { reloadKeys })
    expect(await h.run('source')).toEqual({ ok: true, message: 'keys.conf를 읽었습니다' })
    expect(reloadKeys).toHaveBeenCalledOnce()
    expect((await harness().run('source-file')).ok).toBe(false)
  })

  describe('앱 창 명령', () => {
    it('new-client 는 지금 세션(이름이 없을 때) 또는 -t 로 고른 세션에 붙는 앱 창을 연다', async () => {
      const newClient = vi.fn(async (name: string | undefined) => ({ ok: true, message: `열었습니다 ${name ?? '지금'}` }))
      const h = harness(oneScreen(), { newClient })
      expect(await h.run('new-client')).toEqual({ ok: true, message: '열었습니다 지금' })
      expect(newClient).toHaveBeenLastCalledWith(undefined)
      await h.run('new-client -t 논문 3장')
      expect(newClient).toHaveBeenLastCalledWith('논문')
      await h.run('newc 발표')
      expect(newClient).toHaveBeenLastCalledWith('발표')
    })

    it('detach 는 앱이 하는 일(이 앱 창 닫기)에 맡기고, 없으면 지금은 안 된다', async () => {
      const detach = vi.fn(async () => ({ ok: true, message: '' }))
      expect(await harness(oneScreen(), { detach }).run('detach')).toEqual({ ok: true, message: '' })
      expect(detach).toHaveBeenCalledOnce()
      expect((await harness().run('detach-client')).ok).toBe(false)
      expect((await harness().run('new-client')).ok).toBe(false)
    })
  })

  describe('세션 명령', () => {
    const ok = (message = '') => ({ ok: true, message })
    const sessions = () => ({
      newSession: vi.fn(async (_name: string | undefined) => ok()),
      switchSession: vi.fn(async (_name: string) => ok()),
      renameSession: vi.fn(async (_name: string) => ok()),
      saveSession: vi.fn(async (_name: string | undefined) => ok()),
      killSession: vi.fn(async (_name: string | undefined) => ok()),
      showSessionMenu: vi.fn(),
    })

    it('줄임말을 읽는다(new · switchc · rename · ls)', () => {
      for (const [alias, name] of Object.entries({ new: 'new-session', switchc: 'switch-client', rename: 'rename-session', ls: 'list-sessions' })) {
        expect(canonicalCommandName(alias), alias).toBe(name)
      }
      expect(commandNames()).toEqual(expect.arrayContaining(['new-session', 'switch-client', 'rename-session', 'save-session', 'kill-session', 'list-sessions']))
    })

    it('new-session [이름] · -s 이름: 이름이 없으면 undefined', async () => {
      const handles = sessions()
      const h = harness(oneScreen(), handles)
      await h.run('new-session')
      await h.run('new-session 발표 준비')
      await h.run('new -s 논문')
      expect(handles.newSession.mock.calls.map(([name]) => name)).toEqual([undefined, '발표 준비', '논문'])
    })

    it('switch-client -t 이름 · 이름만 써도 된다 · 이름이 없으면 사용법', async () => {
      const handles = sessions()
      const h = harness(oneScreen(), handles)
      await h.run('switch-client -t 논문')
      await h.run('switchc "발표 준비"')
      expect(handles.switchSession.mock.calls.map(([name]) => name)).toEqual(['논문', '발표 준비'])
      const missing = await h.run('switch-client')
      expect(missing).toEqual({ ok: false, message: 'switch-client -t 이름' })
    })

    it('rename-session 이름 · 이름이 없으면 막는다', async () => {
      const handles = sessions()
      const h = harness(oneScreen(), handles)
      await h.run('rename-session 새 이름')
      expect(handles.renameSession).toHaveBeenCalledWith('새 이름')
      expect((await h.run('rename-session')).ok).toBe(false)
      expect(handles.renameSession).toHaveBeenCalledOnce()
    })

    it('save-session: 이름이 없으면 지금 저장, 있으면 갈래', async () => {
      const handles = sessions()
      const h = harness(oneScreen(), handles)
      await h.run('save-session')
      await h.run('save-session 갈래')
      expect(handles.saveSession.mock.calls.map(([name]) => name)).toEqual([undefined, '갈래'])
    })

    it('kill-session [-t 이름]', async () => {
      const handles = sessions()
      const h = harness(oneScreen(), handles)
      await h.run('kill-session')
      await h.run('kill-session -t 논문')
      expect(handles.killSession.mock.calls.map(([name]) => name)).toEqual([undefined, '논문'])
    })

    it('list-sessions · choose-session 은 세션 메뉴를 연다', async () => {
      const handles = sessions()
      const h = harness(oneScreen(), handles)
      await h.run('list-sessions')
      await h.run('choose-session')
      expect(handles.showSessionMenu).toHaveBeenCalledTimes(2)
    })

    it('손잡이가 없으면 「지금은 안 됩니다」, 손잡이가 실패를 돌려주면 그 말을 그대로 낸다', async () => {
      const h = harness()
      for (const line of ['new-session', 'switch-client -t x', 'rename-session x', 'save-session', 'kill-session', 'list-sessions']) {
        expect(await h.run(line), line).toEqual({ ok: false, message: '지금은 사용할 수 없습니다' })
      }
      const failing = harness(oneScreen(), { switchSession: async () => ({ ok: false, message: '세션을 찾을 수 없습니다: x' }) })
      expect(await failing.run('switch-client -t x')).toEqual({ ok: false, message: '세션을 찾을 수 없습니다: x' })
    })

    it('; 로 이은 줄에서 세션 명령이 실패하면 거기서 멈춘다', async () => {
      const handles = { ...sessions(), switchSession: vi.fn(async () => ({ ok: false, message: '없음' })) }
      const h = harness(oneScreen(), handles)
      const result = await h.run('switch-client -t x ; split-window -h')
      expect(result.ok).toBe(false)
      expect(h.screen().layout.kind).toBe('pane')
    })
  })

  describe('떠 있는 칸 명령', () => {
    const three = async () => {
      const h = harness()
      await split(h)
      await split(h)
      return h
    }
    const floatsOf = (h: ReturnType<typeof harness>) => h.screen().floats

    it('float-pane: 만지는 칸을 띄우고 그 칸이 만지는 칸이 된다. 하나뿐인 칸은 못 한다', async () => {
      const lone = harness()
      expect(await lone.run('float-pane')).toEqual({ ok: false, message: '칸이 하나뿐이라 띄울 수 없습니다' })
      const h = await three()
      const before = h.model().activePane
      expect((await h.run('float-pane')).ok).toBe(true)
      expect(floatsOf(h).map((float) => float.paneId)).toEqual([before])
      expect(h.model().activePane).toBe(before)
      expect(leaves(h.screen().layout)).not.toContain(before)
      expect(await h.run('float-pane')).toEqual({ ok: false, message: '이미 떠 있는 칸입니다' })
    })

    it('embed-pane: 떠 있는 칸을 붙은 칸(없으면 만지던 칸) 오른쪽에 나누어 넣는다', async () => {
      const h = await three()
      const floated = h.model().activePane
      await h.run('float-pane')
      expect((await h.run('embed-pane')).ok).toBe(true)
      expect(floatsOf(h)).toHaveLength(0)
      expect(leaves(h.screen().layout)).toContain(floated)
      expect(await h.run('embed-pane')).toEqual({ ok: false, message: '떠 있는 칸이 없습니다' })
    })

    it('toggle-floating: 숨기고 보이고, 숨긴 동안 select-pane -n 은 떠 있는 칸을 건너뛴다', async () => {
      const h = await three()
      await h.run('float-pane')
      const order = () => leaves(h.screen().layout)
      expect((await h.run('toggle-floating')).message).toBe('떠 있는 칸을 숨겼습니다')
      expect(h.screen().floatsHidden).toBe(true)
      expect(order()).toContain(h.model().activePane)
      const seen = new Set<string>()
      for (let index = 0; index < 4; index += 1) { await h.run('select-pane -n'); seen.add(h.model().activePane) }
      expect([...seen].sort()).toEqual([...order()].sort())
      expect((await h.run('toggle-floating')).message).toBe('떠 있는 칸을 보입니다')
      const floatId = floatsOf(h)[0]!.paneId
      const visited: string[] = []
      for (let index = 0; index < order().length + 1; index += 1) { await h.run('select-pane -n'); visited.push(h.model().activePane) }
      expect(visited).toContain(floatId)
    })

    it('select-pane -t N · 방향 이동은 트리의 칸만 센다', async () => {
      const h = await three()
      await h.run('float-pane')
      const tree = leaves(h.screen().layout)
      await h.run('select-pane -t 1')
      expect(h.model().activePane).toBe(tree[1])
      expect((await h.run(`select-pane -t ${tree.length}`)).ok).toBe(false)
      // 떠 있는 칸을 만지는 중에 방향을 누르면 그 칸이 붙은 트리 칸(없으면 첫 칸)에서 센다
      await h.run('select-pane -n')
      await h.run('select-pane -n')
      expect(h.model().activePane).toBeDefined()
    })

    it('kill-pane: 떠 있는 칸을 만지는 중이면 그 칸을 닫는다(트리의 칸은 그대로)', async () => {
      const h = await three()
      const count = leaves(h.screen().layout).length
      await h.run('float-pane')
      expect(leaves(h.screen().layout)).toHaveLength(count - 1)
      expect((await h.run('kill-pane')).ok).toBe(true)
      expect(floatsOf(h)).toHaveLength(0)
      expect(leaves(h.screen().layout)).toHaveLength(count - 1)
    })

    it('나누기 트리를 바꾸는 명령은 떠 있는 칸을 만지는 중이어도 그 칸이 붙은 트리 칸(없으면 첫 칸)에 한다', async () => {
      const h = await three()
      await h.run('float-pane')
      const before = leaves(h.screen().layout).length
      expect((await h.run('split-window -h')).ok).toBe(true)
      expect(leaves(h.screen().layout)).toHaveLength(before + 1)
      expect(floatsOf(h)).toHaveLength(1)
    })

    it('display-popup: 이름이 없으면 번역기 창을 연다(떠 있는 칸을 만들지 않는다). 번역기를 열 수 없는 곳이면 알린다', async () => {
      const openTranslator = vi.fn(() => true)
      const h = harness(oneScreen(), { openTranslator })
      expect((await h.run('display-popup')).ok).toBe(true)
      expect((await h.run('popup')).ok).toBe(true)
      expect(openTranslator).toHaveBeenCalledTimes(2)
      expect(floatsOf(h)).toHaveLength(0)
      expect(await harness().run('display-popup')).toEqual({ ok: false, message: '지금은 사용할 수 없습니다' })
    })

    it('display-popup: 번역이 꺼져 있어 번역기가 열리지 않으면 ok 가 아니라 이유로 실패한다', async () => {
      const openTranslator = vi.fn(() => false)
      const h = harness(oneScreen(), { openTranslator })
      expect(await h.run('display-popup')).toEqual({ ok: false, message: '번역이 꺼져 있습니다. 설정에서 켜세요' })
      expect(openTranslator).toHaveBeenCalledTimes(1)
      expect(floatsOf(h)).toHaveLength(0)
    })

    it('display-popup 이름: 만든 떠 있는 칸에 그 이름을 열고, 열지 못하면 빈 칸을 남기지 않는다', async () => {
      const opened = vi.fn(async (_query: string, pane: string) => {
        opened.mockImplementationOnce
        void pane
        return { ok: true, message: '열었습니다' }
      })
      let h: ReturnType<typeof harness>
      const open = async (query: string, pane: string) => {
        const result = await opened(query, pane)
        // 열린 탭이 그 떠 있는 칸에 들어간다
        const screen = activeScreenOf(h.model().screens)
        h.host.setModel({ ...h.model(), screens: { ...h.model().screens, screens: h.model().screens.screens.map((candidate) => (candidate.id === screen.id ? { ...screen, panes: { ...screen.panes, [pane]: { tabs: [{ id: 'n', title: query, kind: 'memoNote' as const }], activeId: 'n' } } } : candidate)) } })
        return result
      }
      h = harness(oneScreen(), { open })
      expect((await h.run('display-popup 노트 A')).ok).toBe(true)
      expect(floatsOf(h)).toHaveLength(1)
      expect(opened).toHaveBeenCalledWith('노트 A', floatsOf(h)[0]!.paneId)
      expect(h.model().activePane).toBe(floatsOf(h)[0]!.paneId)
      const failing = harness(oneScreen(), { open: async () => ({ ok: false, message: '찾을 수 없습니다' }) })
      expect(await failing.run('display-popup 없음')).toEqual({ ok: false, message: '찾을 수 없습니다' })
      expect(floatsOf(failing)).toHaveLength(0)
      const noOpen = harness()
      expect(await noOpen.run('display-popup 노트')).toEqual({ ok: false, message: '지금은 사용할 수 없습니다' })
    })

    it('display-popup 이름은 문서를 보는 칸에서 부르면 그 칸에 붙인다', async () => {
      const base = oneScreen()
      const pane = base.activePane
      const screen = activeScreenOf(base.screens)
      const withDoc: WorkspaceModel = { ...base, screens: { ...base.screens, screens: [{ ...screen, panes: { [pane]: { tabs: [{ id: 'd1', title: 'D', kind: 'pdf' as const }], activeId: 'd1' } } }] } }
      // 떠 있는 칸은 열기 직전에 만들어진다: 그때의 붙은 곳을 본다
      let anchor: unknown
      const h = harness(withDoc, { open: async () => { anchor = h.screen().floats[0]?.anchor; return { ok: true, message: '' } } })
      await h.run('display-popup 노트 A')
      expect(anchor).toEqual({ kind: 'pane', paneId: pane })
    })

    it('set-channel 은 떠 있는 칸에도 된다', async () => {
      const h = await three()
      await h.run('float-pane')
      const floated = h.model().activePane
      expect((await h.run('set-channel orange')).ok).toBe(true)
      expect(h.screen().channels[floated]).toBe('orange')
    })

    it('명령 이름 목록에 보이고 도움말에 쓴다', () => {
      expect(commandNames()).toEqual(expect.arrayContaining(['float-pane', 'embed-pane', 'toggle-floating', 'display-popup']))
      expect(canonicalCommandName('popup')).toBe('display-popup')
    })
  })

  it('손잡이가 없으면 「지금은 안 됩니다」로 답한다', async () => {
    const h = harness()
    expect((await h.run('display-panes')).ok).toBe(false)
    expect((await h.run('note-beside')).ok).toBe(false)
    expect((await h.run('choose-session')).ok).toBe(false)
  })
})

describe('명령 줄 전체', () => {
  it('; 로 이은 명령을 차례로 실행하고 앞 명령의 결과를 다음 명령이 본다', async () => {
    const open = vi.fn(async (_query: string, pane: string) => ({ ok: true, message: pane }))
    const settle = vi.fn(async () => undefined)
    const h = harness(oneScreen(), { open, settle })
    const result = await h.run('split-window -h ; open 노트 A')
    expect(result.ok).toBe(true)
    // open 은 방금 나눠서 생긴 칸(새 칸)을 받는다
    expect(open).toHaveBeenCalledWith('노트 A', leaves(h.screen().layout)[1])
    expect(settle).toHaveBeenCalledTimes(1)
  })

  it('하나가 실패하면 거기서 멈추고 그 오류를 돌려준다', async () => {
    const h = harness()
    const result = await h.run('kill-pane ; split-window -h ; split-window -h')
    expect(result.ok).toBe(false)
    expect(leaves(h.screen().layout)).toHaveLength(1)
  })

  it('파서 오류는 아무것도 실행하지 않는다', async () => {
    const h = harness()
    const result = await h.run('split-window -h ; 모르는명령')
    expect(result).toEqual({ ok: false, message: '알 수 없는 명령: 모르는명령. ?를 입력하면 목록이 나옵니다' })
    expect(leaves(h.screen().layout)).toHaveLength(1)
  })
})
