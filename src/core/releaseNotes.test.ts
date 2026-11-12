import { describe, expect, it } from 'vitest'
import packageMetadata from '../../package.json'
import {
  BUNDLED_RELEASE_NOTES,
  buildReleaseNotes,
  compareVersions,
  parseReleaseBody,
  planWhatsNew,
  versionFromFileName,
  type ReleaseNote,
} from './releaseNotes'

const note = (version: string, date: string | null = null): ReleaseNote => ({ version, date, body: `notes ${version}` })

describe('릴리스 노트 파일 읽기', () => {
  it('파일 이름에서 버전을 읽고 버전이 아닌 파일은 건너뛴다', () => {
    expect(versionFromFileName('/docs/releases/v0.1.19.md')).toBe('0.1.19')
    expect(versionFromFileName('C:\\x\\docs\\releases\\v1.20.3.md')).toBe('1.20.3')
    expect(versionFromFileName('/docs/releases/README.md')).toBeNull()
    expect(versionFromFileName('/docs/releases/v0.1.md')).toBeNull()
  })

  it('버전은 숫자로 비교한다(0.1.9 < 0.1.10)', () => {
    expect(compareVersions('0.1.9', '0.1.10')).toBeLessThan(0)
    expect(compareVersions('v0.2.0', '0.1.99')).toBeGreaterThan(0)
    expect(compareVersions('0.1.19', 'v0.1.19')).toBe(0)
  })

  it('새 버전이 앞에 오게 정렬한다', () => {
    const notes = buildReleaseNotes({
      '/docs/releases/v0.1.9.md': '# IWAE v0.1.9\n\nnine',
      '/docs/releases/v0.1.19.md': '# IWAE v0.1.19\n\nnineteen',
      '/docs/releases/v0.1.10.md': '# IWAE v0.1.10\n\nten',
      '/docs/releases/notes.md': 'skip',
    })
    expect(notes.map((entry) => entry.version)).toEqual(['0.1.19', '0.1.10', '0.1.9'])
  })

  it('제목 줄을 떼고 본문만 남기며, 날짜가 있으면 읽는다', () => {
    expect(parseReleaseBody('# IWAE v0.1.12\n\nA quick fix release.\n\n## Fixed\n\n- one\n')).toEqual({
      date: null,
      body: 'A quick fix release.\n\n## Fixed\n\n- one',
    })
    expect(parseReleaseBody('# IWAE v0.1.13 · 2026-11-03\n\nText').date).toBe('2026-11-03')
    expect(parseReleaseBody('# IWAE v0.1.13\n\nReleased 2026-11-03.\n\n- a').date).toBe('2026-11-03')
    // 본문 깊숙한 날짜는 릴리스 날짜가 아니다
    expect(parseReleaseBody('# IWAE v0.1.13\n\na\n\nb\n\nc\n\nd on 2026-01-01').date).toBeNull()
  })

  it('앞의 주석·그림 머리말을 떼고, 영어 구역이 따로 있으면 그 뒤만 쓴다', () => {
    const raw = '<!-- c -->\n\n<p><img src="x"></p>\n\n# IWAE v0.1.10\n\n한국어\n\n---\n\n# IWAE v0.1.10 (English)\n\nEnglish only\r\n'
    expect(parseReleaseBody(raw).body).toBe('English only')
    expect(parseReleaseBody('<!-- c -->\n# IWAE v0.1.1\n\nBody').body).toBe('Body')
  })

  it('제목 줄이 없으면 원문 그대로', () => {
    expect(parseReleaseBody('Just text').body).toBe('Just text')
  })
})

describe('묶인 노트', () => {
  it('저장소의 docs/releases 가 묶이고 지금 버전의 노트가 있다', () => {
    expect(BUNDLED_RELEASE_NOTES.length).toBeGreaterThan(5)
    expect(BUNDLED_RELEASE_NOTES.some((entry) => entry.version === packageMetadata.version)).toBe(true)
    expect(BUNDLED_RELEASE_NOTES.every((entry) => !/^#\s+IWAE\s+v/imu.test(entry.body))).toBe(true)
  })
})

describe('새 버전 안내 계획', () => {
  const notes = [note('0.1.19'), note('0.1.18'), note('0.1.17'), note('0.1.16')]

  it('처음 설치(저장된 버전 없음)는 보이지 않고 기록만 한다', () => {
    expect(planWhatsNew(null, '0.1.19', notes)).toEqual({ kind: 'store' })
    expect(planWhatsNew('garbage', '0.1.19', notes)).toEqual({ kind: 'store' })
  })

  it('같은 버전이면 아무것도 하지 않는다', () => {
    expect(planWhatsNew('0.1.19', '0.1.19', notes)).toEqual({ kind: 'none' })
  })

  it('한 버전 올랐으면 그 버전의 노트만 보인다', () => {
    expect(planWhatsNew('0.1.18', '0.1.19', notes)).toEqual({ kind: 'show', notes: [note('0.1.19')] })
  })

  it('건너뛴 버전은 새 버전 먼저 쌓아 보인다', () => {
    const plan = planWhatsNew('0.1.16', '0.1.19', notes)
    expect(plan.kind === 'show' && plan.notes.map((entry) => entry.version)).toEqual(['0.1.19', '0.1.18', '0.1.17'])
  })

  it('지금 버전의 노트가 없으면 기록만 하고, 지금보다 새 노트는 보이지 않는다', () => {
    expect(planWhatsNew('0.1.15', '0.1.20', notes)).toEqual({ kind: 'store' })
    const plan = planWhatsNew('0.1.16', '0.1.18', notes)
    expect(plan.kind === 'show' && plan.notes.map((entry) => entry.version)).toEqual(['0.1.18', '0.1.17'])
  })

  it('버전이 내려가면 기록만 새로 한다', () => {
    expect(planWhatsNew('0.1.20', '0.1.19', notes)).toEqual({ kind: 'store' })
  })
})
