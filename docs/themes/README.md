# IWAE 테마 파일 · IWAE theme files

IWAE 의 색 테마를 파일 하나로 만들고 나눌 수 있습니다.
You can make an IWAE colour theme as a single file and share it.

- 확장자 · Extension: `.iwtheme` (안은 JSON · plain JSON inside). `.json` 도 읽습니다 · `.json` is accepted too.
- 형식 이름과 버전 · Format and version: `"format": "iwae-theme"`, `"version": 1`.
- 이 폴더의 파일 · Files in this folder
  - [`template.iwtheme`](template.iwtheme): 고쳐 쓰는 빈 틀 · a starting point to edit
  - [`숲.iwtheme`](숲.iwtheme) (forest), [`모래.iwtheme`](모래.iwtheme) (sand), [`자정.iwtheme`](자정.iwtheme) (midnight): 예시 · examples. 세 예시는 라이트·다크 모두 앱의 대비 검사를 통과합니다 · all pass the app's contrast checks in both light and dark.

## 테마 파일 넣는 법 · How to add a theme

1. **끌어 놓기 · Drag and drop.** `.iwtheme` 파일을 IWAE 창 아무 데나 끌어 놓으면 「「숲」 테마를 추가할까요?」 하고 묻습니다. **[추가]** 는 목록에만 넣고, **[추가하고 적용]** 은 바로 씁니다. (`.json` 은 설정 › 화면 테마 안에 놓았을 때만 테마로 봅니다.)
   Drop an `.iwtheme` anywhere on the IWAE window and it asks "Add 「숲」?" with **Add** and **Add and apply**. (A `.json` file is only treated as a theme when dropped inside Settings › Theme.)
2. **불러오기 단추 · Import button.** 설정 › 화면 테마 › 색 구성 아래 **테마 파일 불러오기**.
   Settings › Theme › under the palette cards: **Import theme file**.
3. **테마 폴더 · Themes folder.** Vault 안의 `.iwae/themes/` 폴더에 파일을 넣으면 목록에 저절로 나타나고, 지우면 사라집니다(앱을 열어 둔 채로도). 설정의 **테마 폴더 열기** 단추가 폴더를 열어 줍니다. Vault 폴더를 함께 쓰는 사람과 테마도 나뉩니다.
   Put files in the vault's `.iwae/themes/` folder: they appear in the list automatically and disappear when removed, even while the app is open. **Open themes folder** in Settings opens it. People who share the vault share the themes.
   - 폴더 테마 카드에는 폴더 표시가 붙습니다. 파일이 원본이므로 앱에서 고치거나 지우지 않습니다. 메뉴의 **복사해서 고치기** 는 내 테마로 복사해 편집합니다.
     Folder themes show a folder badge. The file is the source of truth, so the app never edits or deletes it; **Edit a copy** makes your own copy to edit.
   - 읽지 못한 파일은 설정 화면에 파일 이름과 이유가 나옵니다.
     Files that cannot be read are listed in Settings with the reason.
4. **템플릿 저장 · Save template.** 설정의 **템플릿 저장** 은 지금 쓰는 색으로 채운 테마 파일을 저장합니다. 고쳐서 위 방법으로 다시 넣으세요.
   **Save template** writes a theme file pre-filled with the colours you use now. Edit it and add it back with any method above.

## 파일 모양 · File shape

JSON 에는 주석을 쓸 수 없어서 설명은 `description` 과 `seedGuide` 에 적어 둡니다. 앱은 이 둘을 읽지 않으니 지워도 됩니다.
JSON has no comments, so notes live in `description` and `seedGuide`. The app ignores both; delete them freely.

```json
{
  "format": "iwae-theme",
  "version": 1,
  "description": "아무 설명 · any note",
  "theme": {
    "name": "숲",
    "base": "default",
    "light": { "workspace": "#dfe8dc", "panel": "#edf3ea", "tabstrip": "#d5e1d1", "field": "#f9fcf7",
               "text": "#1f2d22", "divider": "#b8c9b3", "accent": "#2e7d4f", "memoCard": "#f6f6f6" },
    "dark":  { "workspace": "#121a15", "panel": "#1c2a21", "tabstrip": "#0f1612", "field": "#16211a",
               "text": "#e2eee5", "divider": "#34493a", "accent": "#6fcf97", "memoCard": "#f6f6f6" }
  },
  "highlightColors": [
    { "id": "yellow", "name": "노랑", "fill": "#ffd60a" }
  ]
}
```

| 항목 · Field | 필수 · Required | 설명 · Meaning |
| --- | --- | --- |
| `format` | 예 · yes | 꼭 `"iwae-theme"`. Must be `"iwae-theme"`. |
| `version` | 예 · yes | 파일 모양의 버전. 지금은 `1` 만 읽습니다. File-shape version; only `1` is read today. |
| `description`, `seedGuide` | 아니오 · no | 사람이 읽는 설명. 앱은 무시합니다. Human notes; ignored by the app. |
| `theme.name` | 예 · yes | 목록에 보이는 이름, 30자까지. 같은 이름이 있으면 「숲 (2)」 처럼 번호가 붙습니다. Display name, up to 30 characters. Duplicates become "숲 (2)". |
| `theme.base` | 예 · yes | 시드로 정하지 않은 색(위험·성공 색 등)을 이어받을 내장 구성: `whale` · `default` · `paper` · `navy`. Built-in palette that supplies colours the seeds do not cover (danger, success…). |
| `theme.light`, `theme.dark` | 예 · yes | 밝기별 시드 8개(아래). Eight seeds per brightness (below). |
| `highlightColors` | 아니오 · no | 형광펜 색 목록(최대 8개). 있으면 가져올 때 「형광펜 색 N개도 함께 바꾸기」를 물어봅니다(기본은 안 바꿈). Optional list (max 8). Importing asks "Also replace the highlight colours?" (default: no). |

색은 모두 `#rrggbb`(또는 `#rgb`). 시드 8개만 정하면 호버·선택·테두리 단계·글자 단계·그림자는 앱이 계산합니다.
Every colour is `#rrggbb` (or `#rgb`). You choose eight seeds; hover, selection, border steps, text steps and shadows are derived by the app.

### 시드 8개: 무엇을 칠하나 · The eight seeds

| 시드 · Seed | 칠하는 곳 | What it colours |
| --- | --- | --- |
| `workspace` | 작업 공간 바탕: 문서 뒤, 칸 사이 | Workspace background: behind documents, between panes |
| `panel` | 패널: 왼쪽 바, 노트 바, 대화상자 | Panels: left bar, note bar, dialogs |
| `tabstrip` | 탭 줄: 맨 위 줄 | Tab strip: the top row |
| `field` | 입력칸: 검색칸, 선택칸 | Fields: search box, selects |
| `text` | 기본 글자색(패널·작업 공간 위에서 읽혀야 함) | Main text colour (must read on panel and workspace) |
| `divider` | 구분선: 칸·목록 사이 선 | Divider lines between panes and rows |
| `accent` | 강조색: 선택·버튼·링크 | Accent: selection, buttons, links |
| `memoCard` | 메모 카드: 노트 바 카드 바탕 (늘 밝은 종이 느낌을 권장) | Memo card: note-bar card background (a light paper tone is recommended) |

### 형광펜 색 항목 · Highlight colour entries

| 항목 · Field | 설명 · Meaning |
| --- | --- |
| `name` | 색 이름, 20자까지 · colour name, up to 20 characters |
| `fill` | 대표 색 `#rrggbb`. 카드 탭·테두리·연결선은 이 색에서 계산합니다 · main colour; tab, edge and connector colours are derived from it |
| `id` | 고르기. `yellow` `green` `blue` `pink` 를 그대로 쓰면 이미 칠한 형광펜이 그 색으로 이어집니다. 없으면 새로 만듭니다 · optional; reuse `yellow` `green` `blue` `pink` so existing highlights keep their colour, otherwise a new id is made |

## 읽을 수 있는 색 고르기 · Choosing readable colours

설정의 테마 편집기와 같은 검사를 씁니다. 예시 3개는 이 값을 모두 넘깁니다.
The theme editor's checks apply. The three examples pass all of them.

| 검사 · Check | 기준 · Minimum contrast |
| --- | --- |
| `text` / `panel` | 4.5 |
| `text` / `workspace` | 4.5 |
| `divider` / `panel` | 1.2 |
| `accent` / `panel` | 3.0 |

기준에 못 미쳐도 테마는 쓸 수 있지만, 편집기에서 경고가 보입니다.
A theme that misses a minimum still works, but the editor shows a warning.

## 잘못된 파일 · Bad files

파일이 올바르지 않으면 앱은 멈추지 않고 이유를 한국어로 알려 줍니다. 예:

- `JSON 모양이 아닙니다. 따옴표·쉼표·괄호가 맞는지 확인해 주세요.`
- `IWAE 테마 파일이 아닙니다. "format": "iwae-theme" 이 있어야 합니다.`
- `지원하지 않는 테마 파일 버전입니다(버전 2). 이 앱은 버전 1 파일을 읽습니다.`
- `다크 색 「패널」(panel)이 빠져 있습니다.`
- `라이트 「강조색」(accent) 값 "red" 은 #rrggbb 색이 아닙니다.`

If a file is invalid the app does not crash; it explains the problem in Korean (examples above). Invalid optional highlight colours are skipped with a note; the theme itself is still added.
