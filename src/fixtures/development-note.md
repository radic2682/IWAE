# IWAE Markdown 테스트

이 문서는 웹 개발 환경에서 Markdown 뷰어의 제목, 본문, 목록, 코드 블록을 확인하기 위한 읽기 전용 샘플입니다.

## 확인 항목

- 문서 계층과 간격
- 긴 문장의 줄바꿈
- 인라인 코드와 링크 표현
- 코드 블록의 가독성

### PDF와 노트를 함께 쓰는 흐름

왼쪽 PDF에서 근거를 확인하고 오른쪽 캔버스에 발췌 블록을 배치합니다. Markdown 문서는 별도 편집 없이 참고 자료로 읽습니다.

```ts
type Source = {
  document: string
  page: number
  quote: string
}
```

> 중요한 근거는 출처와 함께 유지되어야 합니다.

[MDN Web Docs](https://developer.mozilla.org/)처럼 링크가 포함된 문장도 확인할 수 있습니다.
