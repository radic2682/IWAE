import { describe, expect, it } from 'vitest'
import { decodeDocumentBytes, MAX_DOCUMENT_BYTES } from './textDecode'

const utf8 = (text: string) => new TextEncoder().encode(text)

function utf16(text: string, littleEndian: boolean, bom: boolean): Uint8Array {
  const units = [...(bom ? '﻿' : ''), ...text].flatMap((char) => [...char].map((c) => c.codePointAt(0)!))
  const bytes: number[] = []
  for (const unit of units) {
    const high = unit >> 8
    const low = unit & 0xff
    bytes.push(...(littleEndian ? [low, high] : [high, low]))
  }
  return Uint8Array.from(bytes)
}

describe('decodeDocumentBytes', () => {
  it('UTF-8 은 그대로 푼다', () => {
    expect(decodeDocumentBytes(utf8('안녕 world\n'))).toBe('안녕 world\n')
  })

  it('UTF-8 BOM 을 뗀다', () => {
    expect(decodeDocumentBytes(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8('가나다')]))).toBe('가나다')
  })

  it('UTF-16 LE·BE 는 BOM 으로 알아본다', () => {
    expect(decodeDocumentBytes(utf16('한글 text', true, true))).toBe('한글 text')
    expect(decodeDocumentBytes(utf16('한글 text', false, true))).toBe('한글 text')
  })

  it('CP949 한글 파일은 euc-kr 로 푼다', () => {
    // "안녕하세요" 의 CP949 바이트
    const bytes = Uint8Array.from([0xbe, 0xc8, 0xb3, 0xe7, 0xc7, 0xcf, 0xbc, 0xbc, 0xbf, 0xe4])
    expect(decodeDocumentBytes(bytes)).toBe('안녕하세요')
  })

  it('CP949 문장에 ASCII 가 섞여도 푼다', () => {
    const bytes = Uint8Array.from([0x41, 0x20, 0xb0, 0xa1, 0xb3, 0xaa, 0x0a])
    expect(decodeDocumentBytes(bytes)).toBe('A 가나\n')
  })

  it('글에 U+FFFD 가 정말 들어 있는 UTF-8 은 CP949 로 바꾸지 않는다', () => {
    expect(decodeDocumentBytes(utf8('깨진 글자 � 끝'))).toBe('깨진 글자 � 끝')
  })

  it('어느 부호화로도 안 풀리는 바이트는 UTF-8 로 풀고 깨진 자리를 U+FFFD 로 둔다', () => {
    const decoded = decodeDocumentBytes(Uint8Array.from([0x61, 0xff, 0xff, 0x62, 0x80, 0x80, 0x80, 0xfe]))
    expect(decoded.startsWith('a')).toBe(true)
    expect(decoded).toContain('�')
  })

  it('빈 파일은 빈 글', () => {
    expect(decodeDocumentBytes(new Uint8Array())).toBe('')
  })

  it('크기 한도는 20MB', () => {
    expect(MAX_DOCUMENT_BYTES).toBe(20 * 1024 * 1024)
  })
})
