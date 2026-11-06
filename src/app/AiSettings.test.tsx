// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AiSettings } from './AiSettings'
import * as ai from '../bridge/ai'

vi.mock('../bridge/ai', () => ({
  aiSettingsGet: vi.fn(),
  aiApiStatus: vi.fn(),
  aiApiConfigure: vi.fn(),
  aiApiRegenerateToken: vi.fn(),
  aiEmbeddingConfigure: vi.fn(),
  ragStatus: vi.fn(),
  ragIndex: vi.fn(),
  listenRagProgress: vi.fn(async () => () => undefined),
}))

const settings = {
  api: { enabled: false, port: 47821, token: 'a'.repeat(64) },
  embedding: { enabled: false, endpoint: 'http://127.0.0.1:11434', model: 'bge-m3' },
}

function setup(over: { listModels?: () => Promise<string[]>; pullModel?: () => Promise<void> } = {}) {
  const props = {
    listModels: over.listModels ?? vi.fn(async () => ['translategemma:4b']),
    pullModel: over.pullModel ?? vi.fn(async () => undefined),
  }
  render(<AiSettings {...props} />)
  return props
}

describe('AiSettings', () => {
  beforeEach(() => {
    vi.mocked(ai.aiSettingsGet).mockResolvedValue(settings)
    vi.mocked(ai.aiApiStatus).mockResolvedValue({ running: false, error: null })
    vi.mocked(ai.ragStatus).mockResolvedValue({ documents: 12, chunks: 340, embedded: 0, lastIndexedAt: null, running: false, vaultOpen: true })
    vi.mocked(ai.aiApiConfigure).mockResolvedValue({ running: true, error: null })
    vi.mocked(ai.aiApiRegenerateToken).mockResolvedValue({ ...settings, api: { ...settings.api, token: 'b'.repeat(64) } })
    vi.mocked(ai.aiEmbeddingConfigure).mockResolvedValue({ ...settings, embedding: { ...settings.embedding, enabled: true } })
    vi.mocked(ai.ragIndex).mockResolvedValue(undefined)
  })

  it('turns the server on and shows the Claude Code command', async () => {
    setup()
    const toggle = await screen.findByRole('switch', { name: '외부 AI가 IWAE를 사용하도록 허용' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    await waitFor(() => expect(ai.aiApiConfigure).toHaveBeenCalledWith(true, 47821))
    expect(await screen.findByText('실행 중')).toBeTruthy()
    const command = screen.getByRole('textbox', { name: 'Claude Code 연결 명령' }) as HTMLTextAreaElement
    expect(command.value).toBe(`claude mcp add --transport http iwae http://127.0.0.1:47821/mcp --header "Authorization: Bearer ${'a'.repeat(64)}"`)
  })

  it('regenerates the token and reports server errors', async () => {
    vi.mocked(ai.aiApiStatus).mockResolvedValue({ running: false, error: '47821 포트를 열지 못했습니다' })
    setup()
    expect(await screen.findByText(/포트를 열지 못했습니다/u)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '토큰 재발급' }))
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Claude Code 연결 명령' }) as HTMLTextAreaElement).value).toContain('b'.repeat(64)))
  })

  it('shows index counts and reindexes on request', async () => {
    setup()
    expect(await screen.findByText('문서 12 · 조각 340 · 의미 벡터 0')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '지금 색인' }))
    expect(ai.ragIndex).toHaveBeenCalled()
  })

  it('downloads the embedding model before enabling semantic search', async () => {
    const pullModel = vi.fn(async () => undefined)
    setup({ pullModel })
    expect(await screen.findByText('bge-m3 모델이 아직 없습니다')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'bge-m3 받기' }))
    await waitFor(() => expect(pullModel).toHaveBeenCalledWith('http://127.0.0.1:11434', 'bge-m3', expect.any(Function)))
    await waitFor(() => expect(ai.aiEmbeddingConfigure).toHaveBeenCalledWith({ enabled: true, endpoint: 'http://127.0.0.1:11434', model: 'bge-m3' }))
  })

  it('explains that it needs the desktop app', async () => {
    vi.mocked(ai.aiSettingsGet).mockResolvedValue(null)
    setup()
    expect(await screen.findByText('외부 AI 연결은 데스크톱 앱에서만 쓸 수 있습니다.')).toBeTruthy()
  })
})
