import { describe, expect, it } from 'vitest'
import { memoNoteChangeOf } from './memoNotes'

const ROOT = 'C:/Users/me/Vault/'

describe('memoNoteChangeOf', () => {
  it('노트 폴더(「노트」·「Notes」, 하위 폴더 포함)의 *.iwnote 만 노트 변경으로 본다', () => {
    expect(memoNoteChangeOf(['C:\\Users\\me\\Vault\\노트\\Bus Protocol Spec.iwnote'], ROOT)).toEqual({ notePaths: ['노트/Bus Protocol Spec.iwnote'], rescan: false })
    expect(memoNoteChangeOf(['c:/users/me/vault/Notes/회의/A.IWNOTE'], ROOT)?.notePaths).toEqual(['Notes/회의/A.IWNOTE'])
    expect(memoNoteChangeOf(['C:/Users/me/Vault/문서/a.iwnote', 'C:/Users/me/Vault/노트/a.md'], ROOT)).toEqual({ notePaths: [], rescan: true })
    expect(memoNoteChangeOf(['C:/Users/me/Vault/문서/a.pdf', 'C:/Users/me/Vault/.iwae/journal/x.iwnote', 'D:/elsewhere/노트/a.iwnote'], ROOT)).toBeNull()
  })

  it('폴더·이름 바뀜은 목록 다시 맞추기로, 임시 파일은 무시한다', () => {
    expect(memoNoteChangeOf(['C:/Users/me/Vault/노트/새 폴더'], ROOT)).toEqual({ notePaths: [], rescan: true })
    expect(memoNoteChangeOf(['C:/Users/me/Vault/노트'], ROOT)).toEqual({ notePaths: [], rescan: true })
    expect(memoNoteChangeOf(['C:/Users/me/Vault/노트/A.iwnote.tmp', 'C:/Users/me/Vault/노트/.hidden.iwnote'], ROOT)).toBeNull()
  })
})
