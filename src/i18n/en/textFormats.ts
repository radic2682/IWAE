/** 영어 사전: 텍스트·HTML·XML 문서 열기·목록·검색·MCP 화면 */
export const TEXT_FORMATS: Readonly<Record<string, string>> = {
  '「{name}」 파일을 복사했습니다. 붙여 넣으면 문서가 추가됩니다': 'Copied “{name}”. Paste it to add the document',
  // 「텍스트」(형식 이름)와 겹치지 않게 Markdown 과 텍스트 문서를 한데 부르는 이름
  '글 문서': 'Markdown & text',
  '글 문서만 보기': 'Markdown and text documents only',
  '문서 열기': 'Open document',
  '라이브러리 열기': 'Open library',
  '라이브러리 닫기': 'Close library',
  '문서를 열면 여기서 검색할 수 있습니다': 'Open a document to search it here',
  '문서 파일을 끌어 넣으세요': 'Drag document files here',
  '{pane} · {format} 도구': '{pane} · {format} tools',
  '「{name}」을 가져오지 못했습니다: {error}': 'Could not import “{name}”: {error}',
  '처음 실패: 「{name}」 {error}': 'First failure: “{name}” {error}',
  '이미 Vault 폴더 안에 있는 파일입니다. 목록을 새로고침한 뒤 왼쪽 바에서 여세요.': 'This file is already inside the vault folder. Refresh the list, then open it from the sidebar.',
}
