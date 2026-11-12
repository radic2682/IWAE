// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultHandle } from '../bridge/vault'
import type { VaultTreeNode } from '../core/vaultTree'
import { createMemoryCanvasStorage } from './useCanvasAutosave'
import { useMcpCanvasBridge } from './useMcpCanvasBridge'
import { CANVAS_ENABLED } from '../core/features'

const tauri = vi.hoisted(() => ({
  handler: null as null | ((event: { payload: { requestId: number; op: string; args: Record<string, unknown> } }) => void),
  invoke: vi.fn(async () => undefined),
  listen: vi.fn(),
}))

vi.mock('../bridge/window', async (importOriginal) => ({ ...(await importOriginal<object>()), isDesktop: () => true }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_name: string, handler: (event: { payload: { requestId: number; op: string; args: Record<string, unknown> } }) => void) => {
    tauri.listen(_name)
    tauri.handler = handler
    return () => { tauri.handler = null }
  },
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }))

const vault = { root: 'C:/Vault' } as VaultHandle
const tree: VaultTreeNode[] = [
  { id: 'note:a', kind: 'note', name: '정리', path: 'a.canvas' },
  { id: 'folder:f', kind: 'folder', name: 'f', path: 'f', children: [{ id: 'note:f/b', kind: 'note', name: '비교', path: 'f/b.canvas' }] },
]

function mount(enabled: boolean | undefined) {
  const storage = createMemoryCanvasStorage()
  const view = renderHook(() => useMcpCanvasBridge({ vault, tree, storage, loadPdfById: vi.fn(), enabled }))
  return { storage, view }
}

async function call(op: string, args: Record<string, unknown> = {}) {
  const before = tauri.invoke.mock.calls.length
  await waitFor(() => expect(tauri.handler).not.toBeNull())
  tauri.handler!({ payload: { requestId: 7, op, args } })
  await waitFor(() => expect(tauri.invoke.mock.calls.length).toBeGreaterThan(before))
  return (tauri.invoke.mock.calls.at(-1) as unknown as [string, { ok: boolean; result: unknown; error: string | null }])[1]
}

beforeEach(() => {
  tauri.handler = null
  tauri.invoke.mockClear()
  tauri.listen.mockClear()
})
afterEach(() => { tauri.handler = null })

describe('MCP 캔버스 도구(웹뷰 다리) — 다리를 켠 상태(enabled)', () => {
  it('앱의 기능 스위치(CANVAS_ENABLED)는 지금 꺼져 있어 앱은 다리를 끈다(코드는 남아 있어 enabled 로 켜면 돈다)', async () => {
    expect(CANVAS_ENABLED).toBe(false)
    mount(CANVAS_ENABLED)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(tauri.listen).not.toHaveBeenCalled()
  })

  it('canvas_list 는 트리의 캔버스(폴더 안 것 포함)를 열림 여부와 함께 돌려준다', async () => {
    mount(true)
    const reply = await call('canvas_list')
    expect(reply.ok).toBe(true)
    expect(reply.result).toEqual([
      { canvas: 'a.canvas', title: '정리', folder: '', open: false },
      { canvas: 'f/b.canvas', title: '비교', folder: 'f', open: false },
    ])
  })

  it('닫힌 캔버스에 블록을 더하고 읽는다(파일을 고친다)', async () => {
    mount(true)
    const added = await call('canvas_add_blocks', { canvas: 'a.canvas', tidy: false, blocks: [{ type: 'text', text: '본문' }] })
    expect(added.ok).toBe(true)
    const read = await call('canvas_read', { canvas: 'a.canvas' })
    expect(read.ok).toBe(true)
    expect(JSON.stringify(read.result)).toContain('본문')
  })

  it('알 수 없는 캔버스·캔버스가 아닌 op 는 오류로 답하거나 받지 않는다', async () => {
    mount(true)
    const missing = await call('canvas_read', { canvas: '없음.canvas' })
    expect(missing.ok).toBe(false)
    const before = tauri.invoke.mock.calls.length
    tauri.handler!({ payload: { requestId: 8, op: 'memo_list', args: {} } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(tauri.invoke.mock.calls.length).toBe(before)
  })

  it('enabled 가 꺼져 있으면 요청을 듣지 않는다', async () => {
    mount(false)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(tauri.listen).not.toHaveBeenCalled()
  })
})
