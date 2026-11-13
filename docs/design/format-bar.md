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

## 손잡이 · 떼기 · 가운데 (자리)

모든 서식 줄 왼쪽 끝에는 점 여섯 개 손잡이(`.format-bar-grip`, 폭 20px, 아이콘 16px)가 있다. 눌러도 글 쓰는 칸의 초점을 가져오지 않는다(pointerdown preventDefault).

- 상단바에 붙어 있을 때(줄이 `.topbar-toolbar-host` 안)는 손잡이가 줄 안이 아니라 도구 묶음의 맨 왼쪽, 주인 칩 앞에 앉는다: `⠿ ● 1 ✎ | 본문 ▾ | B I U … | 🔍 ▯ + ↕`. TopBar 가 비어 있는 `.topbar-grip-slot` 을 묶음 맨 앞에 두고, FormatBar 가 붙어 있는 동안 손잡이를 그 자리로 포털한다(React 이벤트 · ref · 키보드 · 끌기는 그대로). 손잡이와 주인 칩 사이에 구분선은 없고 구분선은 칩 뒤의 하나뿐이다(가운데 붙음에서는 가운데 줄 첫 묶음의 앞 구분선과 왼쪽 여백을 없앤다). 묶음 바탕(`--cluster-w` 의 ::before)이 손잡이까지 덮는다. 떠 있으면 손잡이는 떠 있는 카드 안 왼쪽으로 돌아오고 자리는 비어 폭이 없다. 가운데 붙음에서도 손잡이는 묶음 맨 왼쪽에 남고 줄만 한가운데로 간다. 끌기가 시작되면 카드가 튀지 않게 손잡이가 있던 자리를 기준으로 잡는다. 캔버스 · 글 상자 띠 같은 상단바 밖 자리는 손잡이가 줄 왼쪽 끝 그대로다.

- 코드: 계산 · 저장은 `formatBarPlace.ts`(순수), 끌기 · 키보드는 `useFormatBarPlace.ts`, 그리기는 `FormatBar.tsx`, 모양은 `format-bar.css` 아래쪽. 시험: `formatBarPlace.test.ts`, `FormatBar.place.test.tsx`.
- 자리는 세 가지다: 왼쪽 붙음(원래 자리) · 가운데 붙음 · 떠 있음(창 기준 x, y). 주인 종류(노트 · 캔버스 · 글 상자)별로 `localStorage['iwae:format-bar-place:v1']` 에 저장한다(try/catch). 종류는 `hostKind` 로 넘기거나, 안 넘기면 놓인 자리(`[data-format-fold-host]` · `.canvas-memo-format-slot` = 캔버스, `.doc-format-strip` · `.pdf-box-format-slot` = 글 상자, 그 밖 = 노트)로 알아낸다. 같은 종류의 줄은 저장소를 같이 봐서 한 곳에서 바꾸면 따라온다.
- 끌기: 손잡이를 6px 넘게 끌면 줄이 떠 있는 카드(종이 바탕 · 1px 구분선 · 메뉴 그림자 · `--r-md`)가 되어 포인터를 따라온다. 놓은 곳이 붙는 자리(상단바 `.note-format-dock`, 캔버스 도구줄 첫 줄, 글 상자 띠 …) 위면 붙고, 아니면 그 자리에 뜬다(창 안으로 8px 여유를 두고 가둔다. 창 크기가 바뀌면 그리기만 다시 가둔다). Esc 는 끌기를 취소한다.
- 가운데: 붙는 자리 가로의 가운데 3분의 1 에 놓으면 가운데, 나머지는 왼쪽. 가운데는 `margin-inline: auto` 라 접는 자리의 남는 폭 한가운데다(상단바는 검색 · 펼치기 묶음 앞까지, 띠는 띠 안). 끄는 동안 붙는 자리는 점선 윤곽(`[data-format-drop]`), 놓으면 앉을 자리는 얇은 강조색 윤곽(`.format-bar-snap`)으로 보인다.
- 뜬 줄: 모든 묶음을 보이고(「⋯」 접기 없음) 창보다 넓으면 두 줄까지 줄바꿈한다. 오른쪽 끝의 「붙이기」 단추 한 번으로 붙는다. 떠 있는 동안 붙는 자리에는 점선 28px 칸이 남아 다시 붙일 곳을 보인다. 나타날 때 120ms 불투명도 페이드, 줄어든 움직임 설정이면 없다.
- 키보드: 손잡이는 단추(이름 「서식바 옮기기」 / Move format bar). Enter · Space 는 뗐다 붙였다(떠 있으면 마지막으로 붙어 있던 쪽으로), 떠 있을 때 방향키는 8px 씩, 붙어 있을 때 ←/→ 는 왼쪽 ↔ 가운데. 자리가 바뀌어 손잡이가 다시 그려져도 초점은 새 손잡이로 간다.
- 접기(⋯)는 붙어 있을 때만 하고, 손잡이가 줄 안에 있으면 손잡이 폭(20px)을 덜어 용량을 잰다(상단바에서는 손잡이가 줄 밖이라 덜지 않는다. 대신 접는 자리가 그만큼 좁아져 ResizeObserver 가 다시 잰다).

## 어두운 테마 대비

어두운 테마에서만: 꺼진 줄의 불투명도는 55%(전에 35–45%), 올림은 `--text-strong` 18% 바탕, 눌림은 강조색 30% 바탕 + 강조색 아이콘. 밝은 테마는 그대로다. 단추 글자색은 원래 `--text-strong` 이다(쉴 때 흐려 보이던 것은 쓰는 칸이 없을 때의 꺼짐 때문이었다).
