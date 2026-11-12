/** Markdown 문서의 경로(이름)인가: 확장자가 `.md` 나 `.markdown` 이다(대소문자 무시). `notes/cmd` 처럼 점 없이 md 로 끝나는 이름은 아니다 */
export function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown)$/iu.test(path)
}
