import { describe, expect, it } from 'vitest'
import {
  RECOMMENDED_TRANSLATION_MODELS,
  createBenchmarkCacheKey,
  selectAutoModel,
  type BenchmarkResult,
  type TranslationModel,
  type TranslationProvider,
  type TranslationRequest,
  type TranslationResult,
} from './translation'

function model(name: string, size: number, digest = `${name}-digest`): TranslationModel {
  return { name, size, digest }
}

function result(
  name: string,
  elapsedMs: number,
  success: boolean,
  size = Number.parseInt(name, 10),
): BenchmarkResult {
  return { model: model(name, size), elapsedMs, success }
}

describe('translation domain', () => {
  it('권장 모드를 명시적인 Ollama 태그로 매핑한다', () => {
    expect(RECOMMENDED_TRANSLATION_MODELS).toEqual({
      '4b': 'translategemma:4b',
      '12b': 'translategemma:12b',
      '27b': 'translategemma:27b',
    })
  })

  it('자동 모드는 목표 지연 안의 가장 큰 성공 모델을 선택한다', () => {
    expect(selectAutoModel([
      result('4b', 800, true),
      result('12b', 1800, true),
      result('27b', 9000, true),
    ], 2500)?.name).toBe('12b')
  })

  it('설치되어 벤치마크된 후보가 없으면 모델을 선택하지 않는다', () => {
    expect(selectAutoModel([], 2500)).toBeUndefined()
  })

  it('실패했거나 목표 지연을 넘은 벤치마크를 제외한다', () => {
    expect(selectAutoModel([
      result('27b', 1200, false),
      result('12b', 3200, true),
      result('4b', 900, true),
    ], 2500)?.name).toBe('4b')
    expect(selectAutoModel([result('4b', 500, false)], 2500)).toBeUndefined()
  })

  it('벤치마크 캐시 키는 endpoint·장치·정렬된 모델 이름과 digest를 포함한다', () => {
    const first = createBenchmarkCacheKey(
      'http://127.0.0.1:11434',
      'cuda:RTX-5070-Ti',
      [model('12b', 12, 'sha-12'), model('4b', 4, 'sha-4')],
    )
    const reordered = createBenchmarkCacheKey(
      'http://127.0.0.1:11434',
      'cuda:RTX-5070-Ti',
      [model('4b', 4, 'sha-4'), model('12b', 12, 'sha-12')],
    )

    expect(reordered).toBe(first)
    expect(first).toContain('http://127.0.0.1:11434')
    expect(first).toContain('cuda:RTX-5070-Ti')
    expect(first).toContain('12b@sha-12')
    expect(first).toContain('4b@sha-4')
    expect(createBenchmarkCacheKey(
      'http://127.0.0.1:11434',
      'cpu:x86-64',
      [model('4b', 4, 'sha-4'), model('12b', 12, 'sha-12')],
    )).not.toBe(first)
    expect(createBenchmarkCacheKey(
      'http://127.0.0.1:11434',
      'cuda:RTX-5070-Ti',
      [model('4b', 4, 'sha-new'), model('12b', 12, 'sha-12')],
    )).not.toBe(first)
  })

  it('provider 계약이 상태·목록·다운로드·벤치마크·번역을 모두 표현한다', async () => {
    const request: TranslationRequest = {
      text: 'hello',
      targetLanguage: 'ko',
      model: 'translategemma:4b',
    }
    const translated: TranslationResult = {
      translatedText: '안녕하세요',
      model: 'translategemma:4b',
      elapsedMs: 320,
    }
    const provider: TranslationProvider = {
      status: async () => ({ available: true, version: '0.12.0', deviceKey: 'metal:m4' }),
      listModels: async () => [model('translategemma:4b', 3_300_000_000)],
      pullModel: async (_endpoint, _model, onProgress) => {
        onProgress({ status: 'pulling', completed: 1, total: 1 })
      },
      benchmark: async () => result('4b', 300, true),
      translate: async () => translated,
    }

    expect(request.targetLanguage).toBe('ko')
    await expect(provider.translate('http://127.0.0.1:11434', request)).resolves.toEqual(translated)
  })
})
