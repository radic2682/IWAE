# TODO (논의 후 진행)

- [ ] 라이브러리 펼치기: 왼쪽 바 모양·펼치기 단추 자리를 유지한 채 넓어지게
- [ ] 노트 펼치기(메모만 보기) 재설계: 다른 화면과 같은 모양으로
- [x] PDF 화면 나누기: 노트에서 먼 칸(사이에 다른 칸)의 형광펜 연결선 → 이웃 칸 규칙(DOM 위치로 이웃 판단) + 「→ 문서 이름」 칩으로 해결(`docs/design/workspace-tmux.md`)

## PDF 편집 기능 (Stirling-PDF 도구 목록 대비, 2026-11-09 → 2026-11-10 대부분 완료)

완료: 두 버전 글자 비교, 합치기·쪽 뽑기·목차 단위 나누기, 내 표시 굽기, 가리기, 암호 PDF 열기, 압축, 빈 쪽 빼기, 스캔 쪽 방향 바로잡기, 쪽 번호·워터마크, 쪽 자르기·모아찍기, 이미지·Markdown 내보내기, 그 자리 OCR.

- [ ] IWAE 목차·책갈피를 PDF 목차로 쓰기(editTableOfContents): PDFium 에 책갈피를 만드는 API 가 없어 보류. 다른 라이브러리(lopdf 등)로 목차 객체를 직접 쓰는 방법을 따로 검토해야 함.

하지 않음(앱 성격과 다름): 서버·자동화 파이프라인, 인증서 서명·검증, 양식 자동 감지, PDF 본문 글자 직접 고치기, JavaScript 보기

## 나중에 할 것 (사용자 요청, 2026-11-11)

- [x] 메모 블록을 끌어 다른 노트로 옮기기·복사하기(완료 11-13, Alt = 링크·복사, `docs/design/workspace-tmux.md` 단계 8 손질 6차): 노트 탭이나 왼쪽 바의 노트 위로 끌어 놓으면 그 노트에 들어간다(쪽 편집의 쪽 끌기와 같은 동작). 같은 형광펜을 가리키는 카드로 넣는다.
- [ ] 메모에 댓글·대댓글: 노트를 여러 개(A·B·C) 돌려 쓰는 대신 노트 하나 안에서 메모마다 댓글 줄기를 달 수 있게. 일반 PDF 뷰어의 주석 답글처럼. (친구 피드백, 2026-11-11)
- [ ] 다른 노트·메모 참조 링크: Notion 의 페이지 링크처럼 노트 글 안에 다른 노트(또는 그 안의 메모, 메모 ID 활용)를 가리키는 링크를 넣고, 누르면 그곳으로 간다. (친구 피드백, 2026-11-11)

## 공개 준비 (2026-11-11 점검)

저장소(radic2682/IWAE)를 비공개에서 공개로 바꾸기 전에 할 일. 로드맵은 `docs/ROADMAP.md`, 서명은 `docs/CODE_SIGNING.md`.

### 점검 결과: 회사·개인 정보

- [x] 작업 트리: `node scripts/release-scan.mjs` 통과(금지어 목록 28개, 개인 폴더 경로, 이메일). 키·토큰 패턴, 개인 키, `.env`, 사설 IP·호스트 없음(시험용 가짜 값만). 이미지·GIF 전부 눈으로 확인: 예시 Vault 화면뿐이고 개인 정보 없음.
- [x] 이력 전체: 109 커밋·모든 파일 내용 1,454 종·커밋 글·작성자/커미터·태그(v0.1.6~v0.1.10)에서 금지어 0건. 작성자는 `radic2682 <…@users.noreply.github.com>` 하나뿐. 새 검사 `node scripts/release-scan.mjs --history` 로 언제든 다시 돌릴 수 있음.
- [ ] (소유자) 로컬 브랜치 `backup/before-msg-rewrite-20261107` 지우기. 지난번 메시지 정리 전의 이력(4 커밋)이며 이번 검사에서도 걸린 것은 없지만, 공개 전에 `git push --all`·`--mirror` 로 실수로 올라가면 안 됨: `git branch -D backup/before-msg-rewrite-20261107`, 그다음 `git reflog expire --expire=now --all && git gc --prune=now`. (원격에는 `main` 과 태그뿐.)
- [ ] (소유자) 공개 직전: `npm run release:scan` 과 `node scripts/release-scan.mjs --history` 를 한 번 더 돌리고, 금지어 목록이 최신인지 확인. 저장소 설정의 이슈·PR·위키·Actions 로그에 사내 정보가 없는지도 본다.
- [ ] `.claude/launch.json`(git 무시, 이 PC 경로 포함)은 저장소에 없음. 그대로 둘 것.
- 이력에 금지어가 나오면 정리 방법(지금은 해당 없음): `git filter-repo --replace-text <표현식 파일>`(내용), `--message-callback`(커밋 글), `--mailmap <파일>`(작성자), 정리 뒤 새 clone 에서 `--history` 검사 → `git push --force --all`/`--tags` 는 소유자가 직접.

### 점검 결과: 보안 (로컬로 열리는 곳)

양호: MCP 서버는 `127.0.0.1` 한정·무작위 64자 토큰(상수 시간 비교)·`Origin` 거절·1MB 상한·기본 꺼짐. CSP 에 원격 스크립트·인라인 스크립트·프레임 없음. Markdown 은 DOMPurify, 메모 HTML 은 자체 소독, 바깥 링크는 `http(s)`/`mailto` 만 확인 창을 거쳐 시스템 브라우저로. 백업 복원은 `..`·절대 경로 거름. 업데이트는 minisign 서명. 번역 주소는 로컬 한정(Ollama)·외부는 https. 딥링크 없음.

- [x] (낮음) 저장된 캔버스의 Markdown 발췌 스냅샷을 그릴 때 다시 소독하도록 고침(`src/app/documents/MarkdownExcerptNode.tsx`, 시험 추가). 공유·동기화된 Vault 의 손댄 파일 방어.
- [x] (중간) Rust 커맨드가 Tauri fs 범위(scope)를 우회함: `atomic_write_text`(`src-tauri/src/storage.rs:498`), `pdf_open`(`pdf/mod.rs:31`), `copy_file_to_clipboard`(`clipboard_files.rs:28`), `office_to_pdf` 의 target(`office.rs:71`), `markdown_to_pdf`·`vault_move_dir`·`github_*`·`vault_backup_*` 가 받은 경로를 그대로 씀. 웹뷰가 뚫리면 PC 의 임의 파일을 읽고 쓸 수 있는 통로. CSP 가 막아 주고 있어 지금은 이론상 위험. 제안: 공통 `ensure_allowed(app, path)`(`app.fs_scope().is_allowed`)를 만들어 위 커맨드 진입점에서 검사. → 완료(11-11): `src-tauri/src/fs_scope.rs` 의 `ensure_allowed(app, path)` 를 경로를 받는 커맨드 진입점마다 부름(`..`·상대 경로 거절 + 앱 fs 범위 검사). 시험 `tests/fs_scope.rs`.
- [x] (중간) 릴리스 무결성: PDFium 을 `releases/latest` 에서 내려받아 검증 없이 번들(`scripts/fetch-pdfium.mjs:13`, `.github/workflows/ci.yml:64`, `release.yml:32`). 제안: 태그(`chromium/NNNN`)와 SHA-256 을 고정하고 받은 뒤 해시 확인. PDFium 의 LICENSE·third-party 고지(tgz 안)도 설치 파일에 같이 넣기. → 완료(11-11): `chromium/8086`(157.0.8086.0, 지금 번들한 dll 과 SHA-256 일치)에 고정하고 묶음마다 SHA-256 확인(`scripts/fetch-pdfium.mjs`), CI·릴리스 워크플로가 이 스크립트를 부름. PDFium 라이선스 묶음 `src-tauri/licenses/pdfium-licenses.txt` 를 resources 에 넣음(`--licenses` 로 다시 만듦).
- [x] (낮음) `src-tauri/src/office.rs:21` PowerPoint 를 COM 으로 열 때 `$app.AutomationSecurity = 3`(매크로 끔)을 설정. 출처가 불분명한 `.ppt` 의 매크로 방지. → 완료(11-11): 열기 전에 `AutomationSecurity = 3`, 끝나면 사용자 값으로 되돌림. (Word 변환 코드는 없음)
- [x] (낮음) `src-tauri/src/markdown_pdf.rs:120` Edge 인쇄에 `--allow-file-access-from-files` 가 켜져 있음. 지금은 DOMPurify 를 거친 HTML 만 넣어서 안전하지만, 불필요한 권한이라 끄고 `<base>` 상대 그림이 되는지 확인. 원격 그림(`https://`)은 PDF 를 만들 때 불러와져 추적 픽셀이 됨: 인쇄용에서는 원격 `<img>` 를 빼는 것을 검토. → 완료(11-11): `--allow-file-access-from-files` 제거(상대 그림은 <base>+file: 로 그대로 읽힘, 시험으로 확인), 인쇄 HTML 에 CSP(원격 로드 차단)를 넣고 원격 <img> 는 alt 글로 바꿈.
- [x] (낮음) `src-tauri/src/fs_move.rs:9` `starts_with(vault_root)` 가 글자 비교라 `Vault/../다른폴더` 가 통과. `..` 가 든 경로를 거르거나 `canonicalize` 후 비교. → 완료(11-11): `..` 가 든 경로 거절 + 실제 경로(canonicalize)로 다시 비교. 시험 `refuses_parent_dir_components_that_escape_the_vault`.
- [ ] (낮음) MCP(`mcp/http.rs:33`): `Host` 헤더가 `127.0.0.1:<port>`·`localhost:<port>` 인지 확인(DNS 리바인딩 이중 방어). 토큰이 앱 데이터 `ai-settings.json` 에 평문(`ai/settings.rs`): 번역 키처럼 OS 자격 증명 저장소로 옮기는 것을 검토. → Host 검사는 완료(11-11, `Host` 가 `127.0.0.1:<port>`·`localhost:<port>` 아니면 403, 시험 추가). 토큰의 OS 자격 증명 저장소 이동은 보류: 설정을 동기로 읽고 쓰는 곳이 많고 시험이 파일에 기대며 헤드리스 Linux 에는 저장소가 없어 따로 설계해야 함.
- [x] (낮음) CSP(`tauri.conf.json:27`): `style-src 'unsafe-inline'` 은 리액트 인라인 스타일 때문에 필요. `form-action 'none'` 을 더하고, 가능하면 `connect-src` 의 Ollama 를 설정한 주소에만 열기. → `form-action 'none'` 추가(11-11). Ollama 주소 한정은 그대로.
- [x] (낮음) 가운데 클릭·새 창 요청으로 웹뷰가 외부 페이지로 가지 않는지 확인하고, `on_navigation`/새 창 가드로 막기. 지금 링크 클릭은 `preventDefault` 로 처리하지만 `auxclick` 은 확인 못 함. → 완료(11-11): 새 창 요청은 wry 가 핸들러가 없으면 거절(CDP 로 `window.open`·가운데 클릭 확인), 주소 이동은 `src-tauri/src/nav_guard.rs` 플러그인이 앱 주소·`iwae:` 밖이면 막음(`location.href`·링크 클릭을 CDP 로 확인).
- [x] (낮음) `fs` 범위가 파일 하나씩(`open_files.rs:76`) 영구 저장(persisted-scope)되어 쌓임: 오래된 항목 정리 방법 검토. → 완료(11-11): 연 파일을 `open-files-scope.json` 에 날짜와 적어 두고, 켤 때 30일 지났거나 100개를 넘거나 없어진 파일의 항목을 `.persisted-scope` 에서 덜어 냄(`open_files::scope_log`).
- [ ] (낮음) GitHub Actions 를 태그(`@v4`)가 아니라 커밋 SHA 로 고정, CI 에 `cargo audit`·`npm audit --omit=dev` 추가.

### 점검 결과: 라이선스

- [x] `LICENSE` 는 MIT(Copyright 2026 IWAE contributors), `Cargo.toml` 도 `license = "MIT"`. 번들: LICENSE·THIRD_PARTY_NOTICES.md 가 설치 파일 resources 에 들어감.
- [x] 운영 의존성(npm 약 60개·Rust 크레이트 343개)에 GPL·LGPL·AGPL 없음. `THIRD_PARTY_NOTICES.md` 에 빠졌던 것을 채움: Pretendard 글꼴(OFL, 전문 부록), 매뉴얼 PDF 안의 Noto Sans KR·Cascadia Mono(OFL), GSAP(GreenSock 라이선스), clipper-lib(BSL-1.0)·opencv-js·protobufjs 등 OCR 의존성, DOMPurify(MPL-2.0 OR Apache-2.0), 라이선스 종류 목록(CDLA-Permissive-2.0·CC0·0BSD 등), 빠졌던 Tauri 플러그인, PDFium 고지.
- [x] (낮음) 예시 PDF(`public/sample-vault/iwae-manual*.pdf`)에 Windows 시스템 글꼴 Cambria Math 일부가 들어 있음(⌘·⌄ 기호가 대체 글꼴로 그려진 것으로 추정). Microsoft 글꼴이라 공개 저장소에 두기 전에 기호를 Noto 글꼴이 가진 것으로 바꾸거나 이미지로 넣고 다시 빌드(`node scripts/build-sample-manual.mjs`). → 완료(11-11): ⌘·⌄ 를 인라인 SVG 로 바꾸고 다시 빌드. 글꼴 목록에 Noto Sans KR·Cascadia Mono 만 남음.
- [ ] (낮음) `src/ui/pretendard/LICENSE.txt` 는 앱 설치 파일에 들어가지 않음. THIRD_PARTY_NOTICES.md 부록에 전문을 넣어 해결했지만, `tauri.conf.json` resources 에도 넣으면 더 확실.
- [ ] 의존성이 바뀔 때마다 고지를 다시 맞추기: `cargo metadata`·`npm ls --omit=dev` 로 목록을 뽑아 비교(자동화는 `cargo about`/`license-checker` 도입 검토).

### 문서

- [x] `docs/FAQ.md`·`docs/FAQ.ko.md`, `docs/ROADMAP.md`, `docs/CODE_SIGNING.md`, 이슈 양식(버그·기능 제안·`config.yml` 로 질문은 Discussions), PR 양식, `SECURITY.md`(키 보관 설명 정정)를 새로 쓰거나 고침.
- [ ] 버그 양식의 「Problem report text」 칸을 앱의 「문제 보고」가 만드는 글 모양에 맞추기(구현이 끝나면 양식 문구와 FAQ 의 설명을 확인).
- [ ] README 의 옛 스크린샷(`docs/images/*.png`·GIF 는 이전 화면)과 `hero.gif` 자리(README 의 HERO MEDIA TODO)를 새 화면으로 교체.
- [ ] README 의 macOS 설치 안내(「not notarized」)와 FAQ 의 SmartScreen·Gatekeeper 항목은 서명이 되면 고치기.

### 소유자가 할 일 (내가 할 수 없는 것)

- [ ] **코드 서명** — Windows(Azure Trusted Signing 가능 여부 확인 → SignPath Foundation → OV 인증서)와 macOS(Apple Developer Program, Developer ID, 공증). 자세한 방법·비용·연결 위치는 `docs/CODE_SIGNING.md`.
- [ ] **Mac 빌드** — 소유자의 Mac 에서 `tauri build --target universal-apple-darwin`, `libpdfium.dylib` 서명·공증 시험, `release-local.mjs --mac-dir` 로 합치기.
- [ ] **공개 후 업데이트 확인** — 업데이트 주소(`https://github.com/radic2682/IWAE/releases/latest/download/latest.json`)는 저장소가 공개여야 인증 없이 받아집니다. 공개 뒤 이전 버전 설치본이 새 릴리스를 실제로 받는지, 서명 검증이 되는지 확인. 업데이트용 minisign 키·비밀번호 백업 위치도 확인.
- [ ] **GitHub 설정** — Discussions 켜기(카테고리 Q&A·Ideas, 이슈 양식 `config.yml` 이 가리킴), Private vulnerability reporting 켜기, 라벨 `bug`·`enhancement` 만들기, 기본 브랜치 보호, Actions 권한을 읽기 전용으로.
- [ ] **저장소 공개 전환** — 위 이력 정리를 마친 뒤.

### 구현 완료 (v0.1.11 에 들어감)

- [x] 주석 가져오기(annotation import)
- [x] Markdown 내보내기
- [x] Zotero 가져오기
- [x] 번역 설정·DeepL
- [x] 문제 보고
- [x] 큰 PDF 성능
- [x] 단축키 바꾸기
- [x] 키보드 접근
- [x] i18n 완전성 시험(한국어 문구에 영어 짝이 있는지)
