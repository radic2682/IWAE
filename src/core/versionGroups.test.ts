import { describe, expect, it } from 'vitest'
import {
  addVersion, createGroup, defaultVersion, dissolveGroup, forgetDocs, groupOfDoc, guessVersionLabel, hiddenVersionDocIds, nextVersionNumberLabel,
  parseVersionGroups, removeVersion, renameVersion, setDefaultVersion, compareVersionLabels, groupTitleFromDocTitle, matchVersionPage, versionlessName, findVersionSibling, createSingleGroup, remapFolderVersions,
} from './versionGroups'

const make = () => {
  const created = createGroup({}, { docId: 'a', title: 'Handbook', label: 'Jan 2025' }, { docId: 'b', label: 'Jul 2026' })!
  return created
}

describe('판 묶음', () => {
  it('두 문서를 묶으면 아래 문서가 대표 자리·기본 판이고, 위에 겹친 판은 목록에서 숨는다', () => {
    const { groups, group } = make()
    expect(group.anchorDocId).toBe('a')
    expect(defaultVersion(group).docId).toBe('a')
    expect([...hiddenVersionDocIds(groups)]).toEqual(['b'])
    expect(groupOfDoc(groups, 'b')?.id).toBe(group.id)
  })

  it('이미 묶인 문서는 다른 묶음에 못 들어간다', () => {
    const { groups } = make()
    expect(createGroup(groups, { docId: 'a', title: 'x', label: '1' }, { docId: 'c', label: '2' })).toBeNull()
    const grown = addVersion(groups, groupOfDoc(groups, 'a')!.id, { docId: 'c', label: 'v3' })
    expect(groupOfDoc(grown, 'c')).not.toBeNull()
    expect(addVersion(grown, groupOfDoc(grown, 'a')!.id, { docId: 'c', label: 'again' })).toBe(grown)
  })

  it('핀으로 기본 판을 바꾸고, 판 이름을 바꾼다', () => {
    const { groups } = make()
    const pinned = setDefaultVersion(groups, 'b')
    expect(defaultVersion(groupOfDoc(pinned, 'a')!).docId).toBe('b')
    // 대표 자리(목록 위치)는 그대로
    expect(groupOfDoc(pinned, 'a')!.anchorDocId).toBe('a')
    expect(groupOfDoc(renameVersion(pinned, 'b', '최신'), 'b')!.versions[1]!.label).toBe('최신')
    expect(renameVersion(pinned, 'b', '  ')).toBe(pinned)
  })

  it('판을 빼면 독립 문서로 돌아가고, 하나가 남아도 묶음은 남는다(다 빼면 없어진다)', () => {
    const { groups } = make()
    const three = addVersion(groups, groupOfDoc(groups, 'a')!.id, { docId: 'c', label: 'v3' })
    const withoutAnchor = removeVersion(three, 'a')
    const group = groupOfDoc(withoutAnchor, 'b')!
    expect(group.anchorDocId).toBe('b')
    expect(group.defaultDocId).toBe('b')
    expect(groupOfDoc(withoutAnchor, 'a')).toBeNull()
    const single = removeVersion(withoutAnchor, 'c')
    expect(groupOfDoc(single, 'b')?.versions.map((version) => version.docId)).toEqual(['b'])
    expect(removeVersion(single, 'b')).toEqual({})
    expect(dissolveGroup(three, groupOfDoc(three, 'a')!.id)).toEqual({})
  })

  it('지워진 문서는 모든 묶음에서 빠진다', () => {
    const { groups } = make()
    expect(forgetDocs(groups, new Set(['a', 'b']))).toEqual({})
    expect(groupOfDoc(forgetDocs(groups, new Set(['b'])), 'b')).toBeNull()
  })

  it('저장 파일을 읽을 때 한 문서는 한 묶음에만, 판이 하나도 없으면 버린다(하나짜리는 남긴다)', () => {
    const file = parseVersionGroups({
      version: 1,
      groups: {
        g1: { title: 'A', anchorDocId: 'x', defaultDocId: 'nope', versions: [{ docId: 'a', label: '1' }, { docId: 'b', label: '2' }] },
        g2: { title: 'B', versions: [{ docId: 'a', label: 'dup' }, { docId: 'c', label: 'c' }] },
        g3: { title: 'C', versions: [{ docId: 'z', label: 'z' }] },
      },
    })
    expect(Object.keys(file.groups)).toEqual(['g1', 'g2', 'g3'])
    expect(file.groups.g2!.versions.map((version) => version.docId)).toEqual(['c'])
    expect(file.groups.g1!.anchorDocId).toBe('a')
    expect(file.groups.g1!.defaultDocId).toBe('a')
  })
})

describe('판 이름 추정', () => {
  it.each([
    ['STD0236_1.4.0.pdf', '1.4.0'],
    ['Spec v2.1 final.pdf', '2.1'],
    ['Handbook_Rev_B.pdf', 'Rev B'],
    ['ACME1234 (July 2026).pdf', 'Jul 2026'],
    ['XYZ5113_Jan 2025.pdf', 'Jan 2025'],
    ['report_2026-07-28.pdf', '2026-07-28'],
    ['manual 2024.pdf', '2024'],
    ['Plain Name.pdf', 'v1'],
  ])('%s → %s', (file, label) => {
    expect(guessVersionLabel(file)).toBe(label)
  })
})

describe('판 이름을 못 찾을 때', () => {
  it('임시 번호를 쓴다', () => {
    expect(guessVersionLabel('Neighborhood Library Survey Results.pdf')).toBe('v1')
    expect(guessVersionLabel('Plain.pdf', undefined, 'v3')).toBe('v3')
  })
  it('다음 임시 번호는 쓰인 번호 다음', () => {
    expect(nextVersionNumberLabel(['v1'])).toBe('v2')
    expect(nextVersionNumberLabel(['1.4.0', '2.0'])).toBe('v3')
    expect(nextVersionNumberLabel(['v1', 'v5'])).toBe('v6')
  })
})

describe('판 이름 추정 — 실제 파일 이름 꼴', () => {
  it.each([
    ['Standard_3_3_1_20241020.pdf', undefined, '3.3.1'],
    ['Standard_3_2_20220112.pdf', undefined, '3.2'],
    ['Standard_3_2_20220112.pdf', '(3.2) Specification', '3.2'],
    ['ds_x.pdf', '(July 2026) ACME - X100', 'Jul 2026'],
    ['DRAFT STD-TR-1009_R4.1.4_NCB.pdf', undefined, '4.1.4'],
    ['ACME_x2_handbook_2.00a-rc00.pdf', undefined, '2.00a'],
    ['Report_20241020.pdf', undefined, '2024-10-20'],
    ['Open-Data-Exchange-Format-Specification-Revision-2.1-2025.08.01-Ratified.pdf', undefined, '2.1'],
  ])('%s (%s) → %s', (file, title, label) => {
    expect(guessVersionLabel(file, title)).toBe(label)
  })
})

describe('판 비교와 묶음 이름', () => {
  it('새 판이 양수, 같은 꼴만 비교한다', () => {
    expect(compareVersionLabels('3.3.1', '3.2')).toBeGreaterThan(0)
    expect(compareVersionLabels('1.4.0', '1.11.0')).toBeLessThan(0)
    expect(compareVersionLabels('Jul 2026', 'Jan 2025')).toBeGreaterThan(0)
    expect(compareVersionLabels('2.00b', '2.00a')).toBeGreaterThan(0)
    expect(compareVersionLabels('Rev B', 'Rev A')).toBeGreaterThan(0)
    expect(compareVersionLabels('2026-07', '1.4')).toBe(0)
    expect(compareVersionLabels('draft', '1.0')).toBe(0)
  })
  it('제목 앞뒤 판 표시를 걷어 낸다', () => {
    expect(groupTitleFromDocTitle('(3.3.1) Specification', '3.3.1')).toBe('Specification')
    expect(groupTitleFromDocTitle('Guide (v2.1)', '2.1')).toBe('Guide')
    expect(groupTitleFromDocTitle('(3.3.1)', '3.3.1')).toBe('(3.3.1)')
    expect(groupTitleFromDocTitle('Handbook', '1.0')).toBe('Handbook')
    expect(groupTitleFromDocTitle('[STD0236] (1.4.0) Transport Base', '1.4.0')).toBe('[STD0236] Transport Base')
  })
})

describe('판 바꿀 때 읽던 자리', () => {
  const v1 = [{ title: '1 Intro', page: 0 }, { title: '2 Protocol', page: 4 }, { title: '2.1 Timing', page: 6 }, { title: 'Ext', page: null }]
  const v2 = [{ title: '1 Intro', page: 0 }, { title: '2 Protocol', page: 7 }, { title: '2.1  timing', page: 10 }]
  it('같은 제목의 절로 가고 절 안 쪽 차이는 유지한다', () => {
    expect(matchVersionPage(v1, 7, v2, 40)).toBe(11)
    expect(matchVersionPage(v1, 5, v2, 40)).toBe(8)
  })
  it('같은 절이 없으면 같은 쪽, 새 판 쪽 수 안으로', () => {
    expect(matchVersionPage(v1, 7, [], 40)).toBe(7)
    expect(matchVersionPage(v1, 7, [], 5)).toBe(4)
    expect(matchVersionPage([], 3, v2, 40)).toBe(3)
  })
})

describe('같은 문서의 다른 판 찾기', () => {
  it('판 표시를 뺀 이름', () => {
    expect(versionlessName('STD0236_1.3.3.pdf')).toBe('std0236')
    expect(versionlessName('Standard_3_2_20220112.pdf')).toBe('standard')
    expect(versionlessName('Standard_3_3_1_20241020')).toBe('standard')
    expect(versionlessName('Secure Boot Guide v1.1.pdf')).toBe('secure boot guide')
    expect(versionlessName('Guide_1.05a-rc00')).toBe('guide')
    expect(versionlessName('STD0233_1.0.1')).toBe('std0233')
    expect(versionlessName('ACME X100 (July 2026)')).toBe('acme x100')
  })
  it('같은 폴더에서 하나만 맞으면 그 문서, 이름에 판 표시가 없으면 묻지 않는다', () => {
    const library = [
      { docId: 'a', title: 'STD0236_1.3.3', folderPath: 'transport' },
      { docId: 'b', title: 'STD0233_1.0.1', folderPath: 'transport' },
      { docId: 'c', title: 'STD0236_1.2.0', folderPath: 'old' },
      { docId: 'm', title: 'Manual', folderPath: 'transport' },
    ]
    expect(findVersionSibling({ docId: 'n', title: 'STD0236_1.4.0', folderPath: 'transport' }, library, {})).toBe('a')
    expect(findVersionSibling({ docId: 'n', title: 'STD9999_1.0', folderPath: 'transport' }, library, {})).toBeNull()
    expect(findVersionSibling({ docId: 'n', title: 'Manual', folderPath: 'transport' }, library, {})).toBeNull()
  })
})

describe('판 관리 시작(문서 하나)', () => {
  it('문서 하나로 묶음을 만들고, 이미 묶였으면 만들지 않는다', () => {
    const created = createSingleGroup({}, { docId: 'a', title: 'Spec', label: '1.0' })!
    expect(created.group.versions).toHaveLength(1)
    expect(created.group.defaultDocId).toBe('a')
    expect(createSingleGroup(created.groups, { docId: 'a', title: 'Spec', label: '1.0' })).toBeNull()
    const added = addVersion(created.groups, created.group.id, { docId: 'b', label: '2.0' })
    expect(groupOfDoc(added, 'b')?.versions).toHaveLength(2)
  })
})

describe('폴더 판', () => {
  it('폴더를 옮기면 그 폴더(와 안쪽)의 판 id 가 따라간다', () => {
    const created = createGroup({}, { docId: 'folder:Docs/v1', title: 'Docs', label: 'v1' }, { docId: 'folder:Docs/v2', label: 'v2' })!
    const moved = remapFolderVersions(created.groups, 'Docs', 'Archive/Docs')
    const group = Object.values(moved)[0]!
    expect(group.versions.map((version) => version.docId)).toEqual(['folder:Archive/Docs/v1', 'folder:Archive/Docs/v2'])
    expect(group.anchorDocId).toBe('folder:Archive/Docs/v1')
    expect(remapFolderVersions(moved, 'Other', 'X')).toBe(moved)
  })
})
