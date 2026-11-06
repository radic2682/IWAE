import { describe, expect, it } from 'vitest'
import { previewGithubUrl } from './github'

describe('previewGithubUrl', () => {
  it('저장소·브랜치·폴더를 읽는다', () => {
    expect(previewGithubUrl('https://github.com/example-org/example-docs/tree/main/docs')).toEqual({ owner: 'example-org', repo: 'example-docs', reference: 'main', path: 'docs' })
    expect(previewGithubUrl('github.com/a/b.git')).toEqual({ owner: 'a', repo: 'b', reference: null, path: null })
    expect(previewGithubUrl('https://gitlab.com/a/b')).toBeNull()
  })
})
