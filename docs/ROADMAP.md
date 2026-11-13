# IWAE Roadmap / 로드맵

English first, 한국어는 아래에 있습니다.

This is a direction, not a promise. Order and scope change with feedback, and nothing here has a date. IWAE stays **local-first**: features that need an account or a server of ours will not be added. Want to influence it? Start a [Discussion](https://github.com/radic2682/IWAE/discussions) or comment on an issue.

Status: **Shipped** is already in a release. **Next** is planned and understood. **Idea** is worth exploring but not committed.

## Shipped (v0.1.11)

| Item | What it is |
| --- | --- |
| Annotation import | Bring in highlights and notes that other readers saved in a PDF, so earlier work is not lost. |
| Markdown export | Write a note (memos, sources and page links) out as a Markdown file for other tools. |
| Zotero import | Read a Zotero library's metadata and annotations into the Vault. |
| Translation setup, DeepL | A guided setup for local and cloud translation, including DeepL. |
| Problem report | A "Report a problem" command that gathers version, system information and recent logs, without document content, for you to review and paste into an issue. |
| Large-PDF performance | Faster opening, scrolling and search on PDFs with hundreds or thousands of pages. |
| Shortcut customization | Rebind every shortcut, with conflict warnings. |
| Keyboard access | Reach every control without a mouse, with visible focus and screen-reader labels. |
| i18n completeness test | A test that fails when a Korean string has no English counterpart. |

## Next

- **Public release.** Open the repository, publish the first public release, and make automatic updates work for everyone. Windows code signing and macOS notarization (see [CODE_SIGNING.md](CODE_SIGNING.md)).
- **Tags and filters.** Tag documents, memos and notes; filter the library, search results and the note bar by tag, color and status.
- **Requirements traceability export.** Memos already carry IDs such as `REQ-01` and source links. Export them as a table (CSV or Markdown) showing each requirement, its source document and page, and its status, for review and audit.
- **Reading progress.** Remember how far you have read in each document and show it in the library; mark documents as to-read, reading, done.
- **BibTeX and Zotero round trip.** Import and export BibTeX, keep citation keys stable, and write memos back toward Zotero.

## Ideas

- **Vault Q&A with citations.** Ask a question about your Vault and get an answer that cites the exact pages, using a local LLM (for example through Ollama) and the existing local search index. Every sentence of an answer would link to its source so it can be checked. Runs on your PC; no cloud required.
- **Read aloud.** Text-to-speech for the current page or selection with local voices, following along in the text.
- **Spaced repetition.** Turn highlights and memos into review cards and schedule them, linked back to the source passage.
- **EPUB and web clipper.** Read EPUB files, and save a web page into the Vault as Markdown or PDF with its source address.
- **Mobile read-only.** A companion to browse a synced Vault, read notes and jump to sources on a phone or tablet.
- **Plugin API.** A small, permissioned extension interface (commands, exporters, importers) with a clear security model. Depends on the MCP and import work above settling first.
- **Linux builds.** Depends on contributor interest and testing.

## Not planned

- Accounts, cloud sync run by us, or anything that uploads your documents.
- Editing the body text of PDFs, form designers, digital-signature validation, or running JavaScript inside PDFs.
- A built-in chat assistant. External agents connect through the local MCP server instead.

---

# 로드맵 (한국어)

방향을 적은 것이고 약속이 아닙니다. 의견에 따라 순서와 범위가 바뀌며, 날짜는 없습니다. IWAE 는 **로컬 우선**이라 계정이나 우리 서버가 필요한 기능은 넣지 않습니다. 의견은 [Discussions](https://github.com/radic2682/IWAE/discussions)나 이슈에 남겨 주세요.

**출시됨**은 이미 릴리스에 들어간 것, **다음**은 하기로 정하고 내용도 이해한 것, **아이디어**는 해 볼 만하지만 확정이 아닌 것입니다.

## 출시됨 (v0.1.11)

| 항목 | 내용 |
| --- | --- |
| 주석 가져오기 | 다른 리더가 PDF 에 저장한 형광펜·메모를 가져와 이전 작업이 사라지지 않게 합니다. |
| Markdown 내보내기 | 노트(메모, 출처, 쪽 링크)를 다른 도구에서 쓰도록 Markdown 파일로 내보냅니다. |
| Zotero 가져오기 | Zotero 라이브러리의 서지 정보와 주석을 Vault 로 읽어 옵니다. |
| 번역 설정·DeepL | 로컬·클라우드 번역(DeepL 포함)을 안내에 따라 설정합니다. |
| 문제 보고 | 버전, 시스템 정보, 최근 기록을 문서 내용 없이 모아 보여 주고, 확인한 뒤 이슈에 붙여 넣게 하는 「문제 보고」 명령. |
| 큰 PDF 성능 | 수백~수천 쪽 PDF 의 열기·스크롤·검색을 빠르게 합니다. |
| 단축키 바꾸기 | 모든 단축키를 바꾸고 겹치면 알려 줍니다. |
| 키보드 접근 | 마우스 없이 모든 조작이 닿고, 초점이 보이며, 화면 낭독기용 이름이 붙습니다. |
| 번역 문구 완전성 시험 | 한국어 문구에 영어 짝이 없으면 실패하는 시험. |

## 다음

- **공개 릴리스.** 저장소를 공개하고 첫 공개 릴리스를 내며, 모두에게 자동 업데이트가 되게 합니다. Windows 코드 서명과 macOS 공증([CODE_SIGNING.md](CODE_SIGNING.md)).
- **태그와 필터.** 문서·메모·노트에 태그를 달고, 라이브러리·검색 결과·노트 바를 태그·색·상태로 거릅니다.
- **요구사항 추적 내보내기.** 메모에는 이미 `REQ-01` 같은 ID 와 출처 링크가 있습니다. 요구사항, 출처 문서·쪽, 상태를 표(CSV·Markdown)로 내보내 검토와 감사에 씁니다.
- **읽기 진행도.** 문서마다 어디까지 읽었는지 기억해 라이브러리에 보여 주고, 읽을 것·읽는 중·끝남으로 표시합니다.
- **BibTeX·Zotero 왕복.** BibTeX 를 가져오고 내보내며 인용 키를 안정적으로 유지하고, 메모를 Zotero 쪽으로 되돌려 씁니다.

## 아이디어

- **출처를 다는 Vault 질의응답.** Vault 에 대해 묻고, 정확한 쪽을 인용한 답을 받습니다. 로컬 LLM(예: Ollama)과 이미 있는 로컬 검색 색인을 씁니다. 답의 모든 문장이 출처로 이어져 확인할 수 있게 하고, 클라우드 없이 내 PC 에서 돕니다.
- **소리 내어 읽기.** 지금 쪽이나 선택한 글을 로컬 음성으로 읽어 주며 글에서 따라갑니다.
- **간격 반복.** 형광펜과 메모를 복습 카드로 만들어 일정에 따라 보여 주고, 출처 문장으로 돌아가게 합니다.
- **EPUB·웹 클리퍼.** EPUB 을 읽고, 웹 페이지를 출처 주소와 함께 Markdown 이나 PDF 로 Vault 에 저장합니다.
- **모바일 읽기 전용.** 동기화된 Vault 를 폰·태블릿에서 훑고, 노트를 읽고, 출처로 이동하는 보조 앱.
- **플러그인 API.** 명령·내보내기·가져오기를 위한 작고 권한이 나뉜 확장 인터페이스와 분명한 보안 모델. 위의 MCP·가져오기 작업이 자리를 잡은 뒤에 합니다.
- **Linux 빌드.** 기여자의 관심과 시험에 달려 있습니다.

## 하지 않을 것

- 계정, 우리가 운영하는 클라우드 동기화, 문서를 올리는 모든 것.
- PDF 본문 글자 고치기, 양식 디자이너, 전자서명 검증, PDF 안 JavaScript 실행.
- 내장 채팅 도우미. 외부 에이전트는 로컬 MCP 서버로 연결합니다.
