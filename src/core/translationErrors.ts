import { t } from '../i18n'

export type TranslationErrorKind = 'setup' | 'key' | 'quota' | 'network' | 'region' | 'local' | 'other'

export interface ExplainedTranslationError {
  readonly kind: TranslationErrorKind
  /** 사용자에게 보이는 한두 문장 */
  readonly text: string
}

/** 번역 오류(Rust 가 올린 문장)를 「무엇을 고치면 되는가」로 풀어 쓴다. 한국어·영어 문장 모두 읽는다 */
export function explainTranslationError(message: string, local: boolean): ExplainedTranslationError {
  if (isTranslationNotConfigured(message)) return { kind: 'setup', text: t('이 번역기에 필요한 설정이 아직 없습니다. 위의 카드에서 필요한 것을 채운 뒤 다시 확인하세요.') }
  const http = /HTTP\s+(\d{3})/iu.exec(message)?.[1]
  const code = http === undefined ? 0 : Number(http)
  const lower = message.toLowerCase()
  if (code === 401 || code === 403 || /unauthor|invalid.*key|api key|authentication|인증/iu.test(lower)) {
    return { kind: 'key', text: t('API key 가 맞지 않습니다. 키를 다시 복사해 붙여 넣었는지, 앞뒤 공백이 없는지 확인하세요.') }
  }
  if (code === 456 || code === 429 || /quota|rate.?limit|too many|한도|초과 사용/iu.test(lower)) {
    return { kind: 'quota', text: t('사용 한도를 넘었거나 요청이 너무 많습니다. 잠시 뒤 다시 하거나 요금제·한도를 확인하세요.') }
  }
  if (code === 400 && /region|resource|지역/iu.test(lower)) {
    return { kind: 'region', text: t('리소스 지역이 맞지 않을 수 있습니다. Azure 포털에서 지역 이름을 확인하세요.') }
  }
  if (/연결할 수 없|can'?t connect|connect|시간이 초과|timed out|timeout|network|dns|네트워크/iu.test(lower)) {
    return local
      ? { kind: 'local', text: t('Ollama 에 연결할 수 없습니다. Ollama 를 실행했는지, 서버 주소가 맞는지 확인하세요.') }
      : { kind: 'network', text: t('서비스에 연결하지 못했습니다. 인터넷 연결과 endpoint 주소를 확인하세요.') }
  }
  return { kind: 'other', text: message }
}

/** 번역기를 아직 고르거나 설정하지 않아서 생긴 오류인가(→ 설정 화면으로 안내) */
export function isTranslationNotConfigured(message: string): boolean {
  return /API key 를 넣으세요|API key를 입력하세요|endpoint와 모델을 설정|모델이 선택되지 않았|Enter an API key|Set the external API endpoint|no model is selected|API key/iu.test(message)
    && !/HTTP\s+\d{3}/iu.test(message)
}
