// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fakeApp, makeEnv } from './testHarness'

function envWith(executionMode: string, enabled = true) {
  const translate = vi.fn(async (text: string) => `번역:${text}`)
  const base = fakeApp()
  const env = makeEnv({ app: fakeApp({ translation: { ...base.translation, executionMode, enabled, externalProvider: 'deepl', translate } }) })
  return { env, translate }
}

describe('MCP 번역 도구', () => {
  it('로컬 번역은 그대로 된다', async () => {
    const { env, translate } = envWith('auto')
    expect(await env.call('translate_text', { text: 'hello', target: 'en' })).toEqual({ translation: '번역:hello', provider: 'local', source: 'auto', target: 'en', external: false })
    expect(translate).toHaveBeenCalledWith('hello', undefined, 'en')
    expect(await env.call('translation_status')).toEqual({ mode: 'local', provider: 'local', external: false, ready: true })
  })

  it('외부 번역기는 allow_external 이 없으면 보내지 않는다', async () => {
    const { env, translate } = envWith('external-api')
    await expect(env.call('translate_text', { text: 'secret' })).rejects.toThrow(/leave this computer/u)
    expect(translate).not.toHaveBeenCalled()
    const ok = await env.call('translate_text', { text: 'x', allow_external: true }) as { external: boolean; provider: string }
    expect(ok).toMatchObject({ external: true, provider: 'deepl' })
    expect(await env.call('translation_status')).toMatchObject({ mode: 'external', external: true })
  })

  it('4000자를 넘기거나 꺼져 있으면 거절한다', async () => {
    const { env } = envWith('auto')
    await expect(env.call('translate_text', { text: 'a'.repeat(4001) })).rejects.toThrow(/4000/u)
    const off = envWith('auto', false).env
    await expect(off.call('translate_text', { text: 'a' })).rejects.toThrow(/turned off/u)
  })
})
