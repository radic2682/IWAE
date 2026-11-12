// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearUndo } from '../undoStack'
import { resetAiActivity } from './aiActivityStore'
import { resetAiChangeLog } from './aiChangeLog'
import { layoutForLegacyId } from '../../core/layoutTree'
import { fakeApp, makeEnv } from './testHarness'
import type { McpDeps } from './types'

vi.mock('../../bridge/pdf', async () => {
  const h = await import('./testPdf')
  return { ...(await vi.importActual<object>('../../bridge/pdf')), pageTextIndex: h.fakePageTextIndex }
})

beforeEach(() => {
  clearUndo()
  resetAiChangeLog()
  resetAiActivity()
})

describe('app_state / settings_get / sources', () => {
  it('app_state 는 창·탭·지금 문서·선택·열린 노트·AI 변경 수를 작게 돌려준다', async () => {
    const app = fakeApp({
      paneCount: 2,
      activePane: 'pB',
      layout: layoutForLegacyId('cols2', ['pA', 'pB'], 0.4),
      panes: [
        { index: 0, id: 'pA', tabs: [{ id: 'd1', title: '사양서', kind: 'pdf' }], activeId: 'd1', channel: 'blue' },
        { index: 1, id: 'pB', tabs: [{ id: '노트/전원.iwnote', title: '전원', kind: 'memoNote' }], activeId: '노트/전원.iwnote', channel: null },
      ],
      docViews: { pA: { docId: 'd1', page: 3, pageCount: 10 } },
      docs: [{ docId: 'd1', title: '사양서', kind: 'pdf', folder: '', favorite: false, pageCount: 10, lastOpenedAt: null, addedAt: null, pagesWithText: 10, scanned: false, ocr: 'done' }],
      selection: () => ({ docId: 'd1', page: 3, text: '고른 글' }),
    })
    const env = makeEnv({ app, pdfs: { d1: ['a'] } })
    await env.call('note_create', { title: '전원', doc_id: 'd1' })
    const state = await env.call('app_state') as Record<string, unknown>
    expect(state).toMatchObject({
      vault: { open: true, documents: 1, notes: 1 },
      layout: {
        pane_count: 2,
        active_pane: 1,
        active_pane_id: 'pB',
        // 칸 번호로 적은 트리: 좌우로 나눈 두 칸, 왼쪽 몫 0.4
        tree: { split: 'h', ratio: 0.4, a: { pane: 0 }, b: { pane: 1 } },
      },
      active_doc: { doc_id: 'd1', title: '사양서', page: 3, page_count: 10 },
      selection: { doc_id: 'd1', page: 3, text: '고른 글' },
      open_notes: ['전원'],
      ai_session: { changes: 1 },
    })
    const panes = state.panes as { index: number; id: string; channel: string | null; tabs: { id: string; kind: string; doc_id?: string; note?: string }[]; active_tab: string | null }[]
    expect(panes.map((pane) => [pane.index, pane.id, pane.channel])).toEqual([[0, 'pA', 'blue'], [1, 'pB', null]])
    expect(panes[0]!.tabs[0]).toMatchObject({ id: 'd1', kind: 'pdf', doc_id: 'd1' })
    expect(panes[1]!.tabs[0]).toMatchObject({ kind: 'memoNote', note: '전원' })
  })

  it('app_state 는 모든 화면을 screens 로 알리고, panes 는 보는 화면의 칸이다(예전 도구와 호환)', async () => {
    const first = [{ index: 0, id: 'pA', tabs: [{ id: 'd1', title: '사양서', kind: 'pdf' as const }], activeId: 'd1', channel: 'blue' as const }]
    const second = [
      { index: 0, id: 'pC', tabs: [{ id: '노트/전원.iwnote', title: '전원', kind: 'memoNote' as const }], activeId: '노트/전원.iwnote', channel: 'green' as const },
      { index: 1, id: 'pD', tabs: [], activeId: null, channel: null },
    ]
    const app = fakeApp({
      activePane: 'pC',
      panes: second,
      screens: [
        { index: 0, id: 'w1', name: '읽기', active: false, panes: first },
        { index: 1, id: 'w2', name: '비교', active: true, panes: second },
      ],
    })
    const env = makeEnv({ app })
    const state = await env.call('app_state') as { panes: { id: string }[]; screens: { index: number; name: string; active: boolean; panes: { id: string; tabs: { doc_id?: string; note?: string }[] }[] }[] }
    expect(state.screens.map((screen) => [screen.index, screen.name, screen.active, screen.panes.map((pane) => pane.id)])).toEqual([[0, '읽기', false, ['pA']], [1, '비교', true, ['pC', 'pD']]])
    expect(state.screens[0]!.panes[0]!.tabs[0]).toMatchObject({ doc_id: 'd1' })
    expect(state.screens[1]!.panes[0]!.tabs[0]).toMatchObject({ note: '전원' })
    // 예전처럼 panes 만 읽어도 지금 보는 화면의 칸이 온다
    expect(state.panes.map((pane) => pane.id)).toEqual(['pC', 'pD'])
  })

  it('app_state 의 트리는 칸 번호로 중첩해 적는다(위아래 나누기 포함)', async () => {
    const app = fakeApp({
      paneCount: 3,
      activePane: 'z',
      layout: layoutForLegacyId('left1-right2', ['x', 'y', 'z']),
      panes: [
        { index: 0, id: 'x', tabs: [], activeId: null, channel: 'blue' },
        { index: 1, id: 'y', tabs: [], activeId: null, channel: 'blue' },
        { index: 2, id: 'z', tabs: [], activeId: null, channel: 'blue' },
      ],
    })
    const env = makeEnv({ app })
    const state = await env.call('app_state') as { layout: { active_pane: number; tree: unknown } }
    expect(state.layout.active_pane).toBe(2)
    expect(state.layout.tree).toEqual({ split: 'h', ratio: 0.5, a: { pane: 0 }, b: { split: 'v', ratio: 0.5, a: { pane: 1 }, b: { pane: 2 } } })
  })

  it('앱 화면 정보가 없어도 app_state 가 돌고, settings_get 은 비밀 없이 언어·테마·번역 방식만 준다', async () => {
    const env = makeEnv()
    expect((await env.call('app_state')) as Record<string, unknown>).toMatchObject({ vault: { open: true, notes: 0 }, panes: [], active_doc: null, selection: null })
    const withApp = makeEnv({ app: fakeApp({ translation: { enabled: true, executionMode: 'external-api', externalProvider: 'deepl', targetLanguage: 'ko', ready: true, translate: async () => '' } }) })
    const settings = await withApp.call('settings_get')
    expect(settings).toEqual({ language: 'ko', theme: 'light', translation_mode: 'external' })
    expect(JSON.stringify(settings)).not.toMatch(/key|token|secret/iu)
  })

  it('source_remove 는 소프트 삭제: ai_undo 가 같은 내용으로 다시 단다', async () => {
    const store: Record<string, { id: string; label: string; target: string; note: string }[]> = {}
    let counter = 0
    const base = makeEnv()
    const deps: McpDeps = {
      ...base.deps,
      docSources: {
        all: () => store as never,
        add: (docId, input) => {
          if ((store[docId] ?? []).some((item) => item.target === input.target)) return false
          counter += 1
          store[docId] = [...(store[docId] ?? []), { id: `s${counter}`, label: input.label ?? '', target: input.target, note: input.note ?? '' }]
          return true
        },
        update: (docId, id, patch) => { store[docId] = (store[docId] ?? []).map((item) => item.id === id ? { ...item, ...patch } : item) },
        remove: (docId, id) => { store[docId] = (store[docId] ?? []).filter((item) => item.id !== id) },
      },
    }
    const { handleMcpOp } = await import('./index')
    const added = await handleMcpOp('source_add', { doc_id: 'd1', sources: [{ target: 'www.example.com/a', label: '원본' }, { target: 'javascript:x' }] }, deps) as { added: string[]; skipped: unknown[] }
    expect(added.added).toEqual(['https://www.example.com/a'])
    expect(added.skipped).toHaveLength(1)
    await handleMcpOp('source_update', { doc_id: 'd1', id: 's1', label: '최신' }, deps)
    expect(store.d1![0]!.label).toBe('최신')
    await expect(handleMcpOp('source_update', { doc_id: 'd1', id: 'nope' }, deps)).rejects.toThrow(/없는 출처/u)
    await handleMcpOp('source_remove', { doc_id: 'd1', ids: ['s1'] }, deps)
    expect(store.d1).toHaveLength(0)
    const { aiUndo } = await import('./aiChangeLog')
    await aiUndo()
    expect(store.d1).toHaveLength(1)
    expect(store.d1![0]).toMatchObject({ target: 'https://www.example.com/a', label: '최신' })
  })
})
