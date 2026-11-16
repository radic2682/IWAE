// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isAppUrl, isSafeLocalImageRef, resolveImageFile } from './imageRef'
import { renderMarkdown, resolveRelativePath } from './markdown'
import { renderFlowDocument } from './flowRender'

const BS = String.fromCharCode(92)
const doc = 'C:/Vault/docs/a.md'
const root = 'C:/Vault'
const resolve = (relative: string) => resolveImageFile(relative, doc, root, resolveRelativePath)

const unsafeRefs: readonly string[] = [
  `/${BS}host/share/x.png`,
  `${BS}${BS}host${BS}share${BS}x.png`,
  '//host/share/x.png',
  '/C:/x.png',
  `C:${BS}x.png`,
  'C:/x.png',
  `%5c%5chost%5cx.png`,
  `%255c%255chost%255cx.png`,
  '%2f%2fhost/x.png',
  `..${BS}..${BS}x.png`,
  'file:///C:/x.png',
  `a/b${BS}c.png`,
]

describe('그림 참조 검사', () => {
  for (const ref of unsafeRefs) {
    it(`${JSON.stringify(ref)} 는 그림 파일로 풀리지 않는다`, () => {
      expect(isSafeLocalImageRef(ref)).toBe(false)
      expect(resolve(ref)).toBeNull()
    })
  }

  it('Vault 밖으로 나가는 상대 경로는 막는다', () => {
    expect(resolve('../../../x.png')).toBeNull()
    expect(resolve('../../x.png')).toBeNull()
  })

  it('보통 상대 경로는 뿌리 안의 경로로 풀린다(%20·./·../ 포함)', () => {
    expect(resolve('images/a.png')).toBe('C:/Vault/docs/images/a.png')
    expect(resolve('./a%20b.png')).toBe('C:/Vault/docs/a b.png')
    expect(resolve('../img/a.png?raw=1')).toBe('C:/Vault/img/a.png')
    expect(resolve('/top.png')).toBe('C:/Vault/top.png')
  })

  it('장치 경로 뿌리는 거절한다', () => {
    expect(resolveImageFile('a.png', `${BS}${BS}?${BS}C:${BS}a.md`, `${BS}${BS}?${BS}C:`, resolveRelativePath)).toBeNull()
    expect(resolveImageFile('a.png', '//./C:/a.md', '//./C:', resolveRelativePath)).toBeNull()
    expect(resolveImageFile('a.png', '//?/UNC/host/share/a.md', '//?/UNC/host/share', resolveRelativePath)).toBeNull()
    // 호스트만 있고 공유가 없는 뿌리는 믿지 않는다
    expect(resolveImageFile('a.png', '//host/a.md', '//host', resolveRelativePath)).toBeNull()
  })

  it('사용자가 고른 UNC Vault 뿌리는 믿고, 같은 호스트·공유 안의 그림만 푼다', () => {
    const root = `${BS}${BS}nas${BS}share${BS}Vault`
    const file = `${BS}${BS}nas${BS}share${BS}Vault${BS}docs${BS}a.md`
    expect(resolveImageFile('img/a.png', file, root, resolveRelativePath)).toBe('//nas/share/Vault/docs/img/a.png')
    expect(resolveImageFile('../top.png', file, root, resolveRelativePath)).toBe('//nas/share/Vault/top.png')
    expect(resolveImageFile('/top.png', file, root, resolveRelativePath)).toBe('//nas/share/Vault/top.png')
    // 대소문자는 가리지 않는다(Windows)
    expect(resolveImageFile('a.png', '//NAS/Share/vault/docs/a.md', '//nas/share/Vault', resolveRelativePath)).toBe('//NAS/Share/vault/docs/a.png')
  })

  it('UNC 뿌리라도 뿌리 밖·다른 호스트·공유로 나가는 참조는 막는다', () => {
    const root = '//nas/share/Vault'
    const file = '//nas/share/Vault/docs/a.md'
    expect(resolveImageFile('../../x.png', file, root, resolveRelativePath)).toBeNull()
    expect(resolveImageFile('../../../x.png', file, root, resolveRelativePath)).toBeNull()
    for (const ref of ['//evil/share/x.png', `${BS}${BS}evil${BS}share${BS}x.png`, 'C:/x.png', '//?/C:/x.png', `${BS}${BS}?${BS}C:${BS}x.png`]) {
      expect(resolveImageFile(ref, file, root, resolveRelativePath)).toBeNull()
    }
    // 문서가 다른 공유·호스트에 있으면 이 뿌리 밖이다
    expect(resolveImageFile('a.png', '//nas/other/docs/a.md', root, resolveRelativePath)).toBeNull()
    expect(resolveImageFile('a.png', '//evil/share/Vault/docs/a.md', root, resolveRelativePath)).toBeNull()
  })

  it('참조 문서는 그 파일이 든 폴더 안만 읽는다', () => {
    expect(resolveImageFile('a.png', 'D:/ext/note.md', 'D:/ext', resolveRelativePath)).toBe('D:/ext/a.png')
    expect(resolveImageFile('../a.png', 'D:/ext/note.md', 'D:/ext', resolveRelativePath)).toBeNull()
  })
})

describe('resolveRelativePath', () => {
  it('역슬래시·드라이브·// 로 시작하는 참조는 풀지 않는다', () => {
    for (const ref of unsafeRefs.slice(0, 5)) expect(resolveRelativePath(ref, 'docs/a.md')).toBeNull()
    expect(resolveRelativePath('b/c.md', 'docs/a.md')).toBe('docs/b/c.md')
  })
})

describe('문서 안 그림·링크 걸러내기(Markdown·HTML)', () => {
  const imgs = [
    ...unsafeRefs.slice(0, 5).map((ref) => `<img src="${ref}">`),
    '<img src="//host/x.png">',
  ]

  it('위험한 상대 참조는 src 도 data-md-src 도 남기지 않는다', () => {
    for (const html of imgs) {
      for (const out of [renderMarkdown(html), renderFlowDocument('html', html).html]) {
        expect(out).not.toContain('data-md-src')
        expect(out).not.toMatch(/\ssrc=/u)
      }
    }
  })

  it('보통 상대 그림은 data-md-src 로 옮긴다', () => {
    expect(renderMarkdown('<img src="images/a.png">')).toContain('data-md-src="images/a.png"')
    expect(renderFlowDocument('html', '<img src="images/a.png">').html).toContain('data-md-src="images/a.png"')
  })

  it('앱 자신의 주소로 가는 그림·링크는 주소를 지운다', () => {
    const urls = ['iwae://x', 'http://iwae.localhost/a', 'https://iwae.localhost/a', 'http://tauri.localhost/a', 'asset://localhost/a', 'ipc://localhost/a', 'https://user@iwae.localhost:1/x', '//iwae.localhost/a']
    for (const url of urls) {
      expect(isAppUrl(url)).toBe(true)
      for (const out of [
        renderMarkdown(`<img src="${url}"> <a href="${url}">x</a>`),
        renderFlowDocument('html', `<img src="${url}"><a href="${url}">x</a>`).html,
      ]) {
        expect(out).not.toMatch(/\ssrc=/u)
        expect(out).not.toContain('href=')
      }
    }
    expect(renderMarkdown('[x](https://iwae.localhost/a)')).not.toContain('href=')
  })

  it('보통 바깥 주소는 그대로 둔다', () => {
    expect(isAppUrl('https://example.com/iwae.localhost')).toBe(false)
    expect(renderMarkdown('[x](https://example.com)')).toContain('href="https://example.com"')
  })
})
