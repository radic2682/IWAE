import { describe, expect, it } from 'vitest'
import { createDefaultTextBlockStyle } from './canvasDocument'
import { createUserBlockPreset, parseUserBlockPresets, userBlockPresetFile } from './blockPresets'

describe('block presets', () => {
  it('일반 블록의 모양과 내용을 Vault 프리셋으로 직렬화한다', () => {
    const block = {
      kind: 'paragraph' as const,
      width: 320,
      height: 80,
      style: { ...createDefaultTextBlockStyle(), background: '#fff6c7' },
      text: '결론',
    }
    const preset = createUserBlockPreset('preset-1', block, [])

    expect(preset).toMatchObject({ id: 'preset-1', name: '본문 1', block })
    expect(parseUserBlockPresets(userBlockPresetFile([preset]))).toEqual([preset])
  })

  it('PDF 발췌처럼 출처에 종속된 블록은 프리셋으로 만들지 않는다', () => {
    expect(() => createUserBlockPreset('preset-1', {
      kind: 'translation',
      width: 300,
      height: 100,
      style: createDefaultTextBlockStyle(),
      text: '번역',
      sourceBlockId: 'source',
      targetLanguage: 'ko',
      model: 'model',
      source: { relation: 'translation' },
    }, [])).toThrow('프리셋')
  })

  it('깨진 구버전 항목만 건너뛰고 알 수 없는 필드가 있는 유효 프리셋은 복원한다', () => {
    const style = createDefaultTextBlockStyle()
    const parsed = parseUserBlockPresets({
      version: 1,
      presets: [
        { id: 'valid-a', name: '본문', block: { kind: 'paragraph', width: 280, height: 80, style, text: '' } },
        { id: 'broken', name: '깨짐', block: { kind: 'future-block' } },
        { id: 'valid-b', name: '제목', future: true, block: { kind: 'title', width: 320, height: 60, style, text: '', future: true } },
      ],
    })

    expect(parsed.map(({ id }) => id)).toEqual(['valid-a', 'valid-b'])
  })
})
