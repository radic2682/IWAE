/** 데이터 보호(저장 파일 읽기·복구) 문장의 영어 */
export const DATA_SAFETY: Readonly<Record<string, string>> = {
  '문서 목록': 'document list',
  '트리 순서': 'tree order',
  'Vault 설정': 'vault settings',
  '{name} 파일은 더 새로운 버전의 IWAE가 만든 것이라, 이번에는 읽기만 하고 저장하지 않습니다.': '{name} was made by a newer version of IWAE, so it is read-only this time and will not be saved.',
  '{name} 파일이 깨져 있어 .iwae/conflicts/diagnostics 폴더에 복사해 두고 다시 만듭니다.': '{name} is damaged. A copy is kept in .iwae/conflicts/diagnostics and it is being rebuilt.',
  'PDF 편집 기록을 아직 읽지 못해 저장을 미뤄 두었습니다. 읽는 대로 저장하니 그때까지 앱을 닫지 마세요.': "The PDF edit record could not be read yet, so saving is on hold. It will be saved as soon as it can be read; please don't close the app until then.",
  '이 노트는 더 새로운 버전의 IWAE가 만든 것이라 저장하지 않았습니다. 파일은 그대로 두었습니다.': 'This note was made by a newer version of IWAE, so it was not saved. The file was left as it is.',
  '이 노트 파일은 읽을 수 없는 모양이라 저장하지 않았습니다. 파일은 그대로 두었습니다.': 'This note file is in a shape that cannot be read, so it was not saved. The file was left as it is.',
  '읽을 수 없는 충돌 기록 {count}개는 건너뛰었습니다.': 'Skipped {count} unreadable conflict record(s).',
  '읽을 수 없는 휴지통 항목 {count}개는 건너뛰었습니다.': 'Skipped {count} unreadable trash item(s).',
  '읽을 수 없는 버전 기록은 건너뛰었습니다.': 'Skipped unreadable version history.',
  '완료되지 않은 저장 기록을 읽지 못했습니다: {error}': 'Could not read the unfinished saves: {error}',
  '충돌 기록을 읽지 못했습니다: {error}': 'Could not read the conflict records: {error}',
  '휴지통을 읽지 못했습니다: {error}': 'Could not read the trash: {error}',
  '버전 기록을 읽지 못했습니다: {error}': 'Could not read the version history: {error}',
}
