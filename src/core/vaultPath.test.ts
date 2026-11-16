import { describe, expect, it } from 'vitest'
import { vaultRelativePath } from './vaultPath'

const BS = String.fromCharCode(92)
const win = (path: string) => path.replaceAll('/', BS)

describe('vaultRelativePath', () => {
  it('Vault 안의 경로는 상대 경로로 돌려준다(슬래시·역슬래시·대소문자 무관)', () => {
    expect(vaultRelativePath('C:/Vault', 'C:/Vault/Docs/a.txt')).toBe('Docs/a.txt')
    expect(vaultRelativePath(win('C:/Vault'), win('C:/Vault/Docs/a.txt'))).toBe('Docs/a.txt')
    expect(vaultRelativePath('C:/Vault/', win('c:/VAULT/Docs/A.TXT'))).toBe('Docs/A.TXT')
    expect(vaultRelativePath(win('c:/vault'), 'C:/Vault//Docs/a.txt')).toBe('Docs/a.txt')
  })
  it('Vault 밖·같은 이름 접두·Vault 자신·.. 조각은 null', () => {
    expect(vaultRelativePath('C:/Vault', 'C:/Vault2/a.txt')).toBeNull()
    expect(vaultRelativePath('C:/Vault', 'D:/Vault/a.txt')).toBeNull()
    expect(vaultRelativePath('C:/Vault', 'C:/Vault')).toBeNull()
    expect(vaultRelativePath('C:/Vault', 'C:/Vault/../Other/a.txt')).toBeNull()
    expect(vaultRelativePath('C:/Vault', 'C:/Vault/Docs/../a.txt')).toBeNull()
  })
  it('한글 이름은 NFC·NFD 가 달라도 같게 본다', () => {
    expect(vaultRelativePath('C:/보관함', 'C:/보관함/글/메모.txt'.normalize('NFD'))).not.toBeNull()
  })
  it('UNC Vault 도 된다', () => {
    expect(vaultRelativePath(`${BS}${BS}nas${BS}share${BS}Vault`, `${BS}${BS}NAS${BS}share${BS}Vault${BS}a.txt`)).toBe('a.txt')
  })
})
