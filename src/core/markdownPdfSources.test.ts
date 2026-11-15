// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { markdownPdfHtml, stripRemoteImages } from './markdownPdf'

const BS = String.fromCharCode(92)
/** 슬래시를 역슬래시로 바꿔 쓴다(소스에 역슬래시를 겹쳐 쓰지 않으려고) */
const win = (text: string) => text.replaceAll('/', BS)

const note = win('C:/Vault/Docs/Spec.md')
const printable = (src: string, vault?: string) => stripRemoteImages(`<img src="${src}">`, note, vault).startsWith('<img')

describe('인쇄할 그림 주소 거르기(SMB·UNC 누출 방지)', () => {
  it('호스트가 있는 주소는 모두 뺀다', () => {
    for (const src of [
      win('//host/share/x.png'),
      `/${BS}host/share/x.png`,
      '//host/share/x.png',
      `${BS}/host/x.png`,
      'file://host/share/x.png',
      win('//?/UNC/host/x.png'),
      win('C:/x.png'),
      'ftp://host/x.png',
      'javascript:alert(1)',
    ]) {
      expect(printable(src), src).toBe(false)
    }
  })

  it('문자 참조·퍼센트·공백으로 숨긴 UNC 도 뺀다', () => {
    for (const src of [
      '&#92;&#92;host&#92;share&#92;x.png',
      '&bsol;&bsol;host/x.png',
      '&#x5c;&#x5c;host/x.png',
      '%5C%5Chost/x.png',
      ` \t${BS}${BS}host${BS}x.png`,
      'file:&#47;&#47;host/x.png',
      '..%5C..%5Chost/x.png',
      'images/C:/x.png',
    ]) {
      expect(printable(src), src).toBe(false)
    }
  })

  it('원문 폴더 기준 상대 경로와 data·file:/// 그림은 남긴다', () => {
    for (const src of ['images/a.png', './images/a.png', '../images/a.png', win('images/a.png'), 'data:image/png;base64,AAAA', 'file:///C:/Vault/x.png', 'a%20b.png?x=1']) {
      expect(printable(src), src).toBe(true)
    }
  })

  it('Vault 를 주면 Vault 밖으로 나가는 그림은 뺀다', () => {
    const vault = win('C:/Vault')
    expect(printable('../x.png', vault)).toBe(true)
    expect(printable('../../x.png', vault)).toBe(false)
    expect(printable('../../../../x.png', vault)).toBe(false)
    expect(printable('file:///D:/other/x.png', vault)).toBe(false)
    expect(printable('file:///c:/vault/x.png', vault)).toBe(true)
  })

  it('srcset 과 source 는 뺀다', () => {
    expect(stripRemoteImages(`<img src="a.png" srcset="${win('//host/x.png')} 2x">`, note)).toBe('<img src="a.png">')
    expect(stripRemoteImages('<picture><source srcset="//h/x.png"><img src="a.png"></picture>', note)).toBe('<picture><img src="a.png"></picture>')
  })

  it('markdownPdfHtml 에서 raw HTML 의 UNC 그림이 사라진다', () => {
    const unc = win('//localhost/C$/x.png')
    const html = markdownPdfHtml(`<img src="${unc}" alt="가려진">\n\n<img src="/${BS}localhost/C$/x.png">\n\n![ok](a.png)`, 'T', note, win('C:/Vault'))
    expect(html).not.toContain('localhost')
    expect(html).toContain('src="a.png"')
    expect(html).toContain('md-remote-image')
  })
})
