// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleMcpMemoRequest, ownsOp } from './useMcpMemoBridge'
import { makeEnv } from '../mcp/testHarness'
import { clearUndo } from '../undoStack'
import { resetAiActivity } from '../mcp/aiActivityStore'
import { resetAiChangeLog } from '../mcp/aiChangeLog'

vi.mock('../../bridge/pdf', async () => {
  const h = await import('../mcp/testPdf')
  return { ...(await vi.importActual<object>('../../bridge/pdf')), pageTextIndex: h.fakePageTextIndex }
})

beforeEach(() => {
  clearUndo()
  resetAiChangeLog()
  resetAiActivity()
})
afterEach(() => resetAiActivity())

describe('MCP 웹뷰 다리(얇은 전달자)', () => {
  it('표에 있는 op 는 처리하고, 이름 공간(memo_/note_/source_)의 모르는 op 는 unsupported 로 답한다', async () => {
    const env = makeEnv()
    expect(await handleMcpMemoRequest('note_list', {}, env.deps)).toEqual({ notes: [] })
    await expect(handleMcpMemoRequest('memo_frobnicate', {}, env.deps)).rejects.toThrow('unsupported op: memo_frobnicate')
    await expect(handleMcpMemoRequest('canvas_add_blocks', {}, env.deps)).rejects.toThrow('unsupported op: canvas_add_blocks')
  })

  it('이 다리가 답할 op 는 표에 있거나 우리 이름 공간인 것뿐이고 캔버스 op 는 다른 다리가 받는다', () => {
    expect(ownsOp('note_build')).toBe(true)
    expect(ownsOp('goto')).toBe(true)
    expect(ownsOp('note_future_tool')).toBe(true)
    expect(ownsOp('canvas_add_blocks')).toBe(false)
    expect(ownsOp('canvas_list')).toBe(false)
  })

  it('노트 저장소가 없으면(Vault 가 닫힘) 알려 준다', async () => {
    const env = makeEnv()
    await expect(handleMcpMemoRequest('note_list', {}, { ...env.deps, notes: undefined })).rejects.toThrow(/Vault/u)
  })
})
