# 서식 줄(FormatBar)

글 서식 단추는 한 부품이다. 노트 메모, 캔버스 글 블록, PDF·Markdown 글 상자, 박스 메모가 같은 코드로 같은 모양을 그린다.

- 부품: `src/ui/format/FormatBar.tsx` (글자 크기 칸은 `FormatSizeField.tsx`)
- 모양: `src/ui/format-bar.css` (theme.css 가 불러온다. 자리마다 다른 것은 그 자리 파일이 덮는다)
- 시험: `src/ui/format/FormatBar.test.tsx`

## 무엇을 그리나

서식 줄은 단추만 그린다. 무엇을 할지는 주인(host)이 넘긴다. 주인이 넘기지 않은 묶음은 그리지 않는다.

묶음은 늘 이 순서이고, 묶음 사이에 1px 구분선이 있다.

| 묶음 | 들어가는 것 | 넘기는 값 |
| --- | --- | --- |
| 문단 | 문단 모양(본문 · 제목 · 인용 …), 글꼴, 글자 크기 | `block`, `fontFamily`, `fontSize` |
| 글자 모양 | 굵게 · 기울임 · 밑줄 · 취소선 · 인라인 코드 | `marks` |
| 정렬 | 왼쪽 · 가운데 · 오른쪽 | `align` |
| 목록 | 글머리 · 번호 · 할 일 (+ `slots.lists`) | `lists` |
| 색 | 글자색 · 글자 배경색 · 서식 지우기 (+ `slots.color`) | `textColor`, `highlight`, `clear` |
| 덧붙인 묶음 | 주인만의 것(블록 배경색, 테두리, 서식 가져오기 …) | `extras` |

어디서나 같은 것:

- 단추 28px, 아이콘 16px(Phosphor). 눌림은 상단바 도구 단추와 같은 바탕(`--selected-bg`), 꺼짐은 흐리게.
- 드롭다운은 앱 `Select`(문단 모양 · 글꼴), 메뉴는 앱 `PopupMenu`(노트의 표 메뉴). 운영체제 기본 select 는 쓰지 않는다.
- 색은 단추 + 팔레트(body 에 뜬다). 한 번에 팔레트 하나만 열린다. 바깥을 누르거나 Esc 면 닫힌다.
- 이름(aria-label)은 짧은 이름(「굵게」), 풍선 도움말은 「이름 (단축)」. 단축은 주인마다 되는 것이 달라 `shortcuts` 로 넘긴다.
- 모든 단추 · 고르개 · 색 칸은 누를 때 초점을 가져오지 않는다(pointerdown preventDefault, `Select keepFocus`, `PopupMenu autoFocus={false}`). 글 쓰는 칸의 고른 글 · 커서 · 한글 조합이 그대로 남아, 노트에서 고른 글에 바로 서식이 걸린다.
- 접는 자리(`.note-format-dock` 또는 `data-format-fold-host`) 안에서 폭이 모자라면 뒤쪽 묶음부터 「⋯」 메뉴로 옮긴다. 첫 묶음과 「⋯」 은 늘 줄에 있다. 메뉴는 body 에 뜬다.

## 주인이 붙이는 법

```tsx
<FormatBar
  label={t('메모 서식')}
  disabled={editor === null}
  block={{ value, options, onChange }}
  marks={{ bold: { active, onToggle }, italic: { active, onToggle } }}
  lists={{ bullet: { active, onToggle } }}
  textColor={{ colors, onChange, clear: { label, onClear } }}
  shortcuts={{ bold: 'Ctrl+B' }}
  extras={[{ key: 'border', node: <FormatButton label={t('테두리')} active={on} onPress={toggle}>…</FormatButton> }]}
  onCommand={refresh}
/>
```

- `active` 를 모르면 넘기지 않는다(눌림 표시를 하지 않는다).
- 덧붙인 묶음 안의 단추도 `FormatButton` · `FormatColorButton` · `FormatMenuButton` 을 쓰면 같은 모양 · 같은 초점 규칙이 된다.
- `onCommand` 는 명령 하나를 실행한 뒤에 불린다(노트는 빈 칸 안내와 눌림 상태를 다시 본다).

## 어디에서 무엇을 쓰나

| 주인 | 자리 | 묶음 |
| --- | --- | --- |
| 노트 메모 (`MemoFormatBar`, MemoEditor.tsx) | 상단바 도구줄(노트 칸이 만지는 칸일 때). 상단바가 없으면 노트 맨 위 | 문단(+ 구분선) · 글자 모양 · 목록(+ 표 메뉴) · 색(글자색 · 글자 배경색 · 서식 지우기). 정렬 · 크기 없음 |
| 박스 메모 (PDF · Markdown) | 박스 메모 띠(`.pdf-box-format-slot`) | 노트 메모와 같다(같은 `MemoFormatBar`) |
| 캔버스 메모 카드 | 캔버스 위 가운데(`.canvas-memo-format-slot`) | 노트 메모와 같다 |
| 캔버스 글 블록 (`NoteToolbar`) | 캔버스 도구줄 첫 줄(접는 자리) | 문단 모양 · 크기(px 8–96) · 글자 모양 · 정렬 · 목록(글머리 · 번호) · 색 · 덧붙인 블록 배경색 |
| PDF · Markdown 글 상자 (`PdfOverlayPalette`) | 문서 위 서식 띠(`DocFormatStrip`) | 글꼴 · 크기(pt 4–144, 0.5) · 굵게 · 글자색(+ 직접 고르기) · 바탕색(흰 · 노랑 · 직접, 「바탕 없음」) · 덧붙인 테두리 · 서식 가져오기 |

명령은 주인마다 다르다. 노트는 지금 쓰는 칸(`.pdf-memo-editor`)에 `execCommand` 를 건다(되돌리기는 브라우저 편집 기록). 캔버스는 고른 블록 전체에 `BlockFormatCommand` 를 건다(캔버스 되돌리기 기록에 남는다). 글 상자는 고른 상자를 고치거나, 고른 것이 없으면 새로 만들 상자의 도구 서식을 바꾼다.

## 같이 쓰지 않는 것

- 선 · 도형 · 펜의 서식(색 일곱 · 굵기 · 선 모양 · 화살촉 · 칠하기)과 형광펜 띠는 그리기에만 있는 것이라 띠 고유의 단추(`Strip*`)로 둔다.
- 고른 덮개 옆의 작은 막대(`.pdf-overlay-mini`)는 서식 줄이 아니라 한 번 눌러 바꾸는 빠른 단추라 그대로 둔다.
- 글 상자 띠는 이미 스스로 옆으로 밀리므로(잘린 끝을 흐리게) 「⋯」 로 접지 않는다.
