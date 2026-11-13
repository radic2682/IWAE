import { createContext } from 'react'

/** 번역기가 쓰는 번역 기능. App 이 번역을 켜 둘 때만 준다(null 이면 번역기 단추도 없다) */
export interface TranslatorService {
  /** 글을 번역한다. 원문 언어가 없으면 번역기가 알아서 본다 */
  readonly translate: (text: string, sourceLanguage: string | undefined, targetLanguage: string) => Promise<{ readonly text: string; readonly model: string } | null>
  /** 번역기(모델·서비스) 이름 */
  readonly providerLabel: string
}

export const TranslatorContext = createContext<TranslatorService | null>(null)
