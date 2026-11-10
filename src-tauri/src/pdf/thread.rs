//! PDFium 을 독점하는 스레드.
//!
//! PDFium 은 스레드 안전하지 않다. Mutex 로 감싸려면 엔진이 `Send` 여야 하는데, 그건 우리가
//! 기대고 싶지 않은 크레이트의 성질이다. 대신 엔진을 이 스레드 안에서만 만들고 밖으로는
//! 채널만 내보낸다 — 그러면 `Send` 인지 따질 일 자체가 없어진다.

use std::any::Any;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::OnceLock;

use super::cache::{DocCache, CAPACITY};
use super::engine::{
    self, CropRect, ExportHighlight, ImportedAnnotation, OpenDocument, PageEditOp, PageLayout, PageTextIndex, PdfDocMeta,
    PdfEngine, PdfLink, PdfMetadata, PdfOutlineEntry, PdfRenderError, SearchablePage,
    SearchableReport, RawImage, TileRect,
};
use super::tools::{self, ToolOp, ToolReport};

/// 도구 결과를 어디에 둘까.
pub enum ToolTarget {
    /// 원본을 덮는다. 덮기 전 원본은 backup 으로. 같은 doc_id 로 다시 연다.
    InPlace { path: PathBuf, backup: PathBuf },
    /// 새 파일로 쓴다(원본은 그대로).
    NewFile { path: PathBuf },
}

/// 도구 하나를 돌린 결과.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub path: String,
    /// 원본을 덮었으면 다시 연 문서의 메타
    pub meta: Option<PdfDocMeta>,
    pub report: ToolReport,
}

/// 스레드에 보내는 명령. 답은 요청마다 새로 만든 채널로 돌아온다(oneshot 대용).
enum Command {
    /// 색인용 쪽 배치(글자 크기·굵기, 선·사각형, 그림 자리)
    PageLayout {
        doc_id: String,
        page: i32,
        reply: Sender<Result<PageLayout, PdfRenderError>>,
    },
    /// 쪽 순서·회전·끼워 넣기를 적용해 원본 파일을 덮어쓴다. 덮기 전 원본은 backup 으로 복사한다.
    /// 다시 열 때 같은 doc_id 를 쓴다 — 형광펜·노트 출처가 문서를 놓치지 않게.
    EditPages {
        doc_id: String,
        path: PathBuf,
        backup: PathBuf,
        plan: Vec<PageEditOp>,
        reply: Sender<Result<PdfDocMeta, String>>,
    },
    Open {
        path: PathBuf,
        /// 해시는 부르는 쪽에서 구해 온다 — 아래 [`PdfThread::open_blocking`] 참고.
        identity: engine::FileIdentity,
        /// 암호 PDF 의 암호. 맞으면 이 세션 동안 기억해 다시 열 때 쓴다(디스크에는 쓰지 않는다).
        password: Option<String>,
        reply: Sender<Result<PdfDocMeta, String>>,
    },
    /// PDF 도구 하나([`ToolOp`]).
    Tool {
        doc_id: String,
        op: ToolOp,
        target: ToolTarget,
        reply: Sender<Result<ToolResult, String>>,
    },
    /// 빈 쪽 번호들(0 부터).
    BlankPages {
        doc_id: String,
        reply: Sender<Result<Vec<i32>, String>>,
    },
    /// 쪽마다 PNG 로 폴더에 쓴다.
    ExportImages {
        doc_id: String,
        folder: PathBuf,
        stem: String,
        dpi: f32,
        reply: Sender<Result<usize, String>>,
    },
    /// 화면용 렌더(쪽 전체 또는 타일). PNG 로 묶지 않고 RGBA 로 돌려준다.
    RenderRaw {
        doc_id: String,
        page: i32,
        width: u32,
        tile: Option<TileRect>,
        reply: Sender<Result<RawImage, PdfRenderError>>,
    },
    Render {
        doc_id: String,
        /// 0-기반. PDFium 과 같은 셈법을 쓴다.
        page: i32,
        width: u32,
        reply: Sender<Result<Vec<u8>, PdfRenderError>>,
    },
    Crop {
        doc_id: String,
        page: i32,
        rect: CropRect,
        reply: Sender<Result<Vec<u8>, PdfRenderError>>,
    },
    /// 페이지 하나의 텍스트와 글자 상자. [`Command::Render`] 와 같은 성질의 명령이다 —
    /// 이미 열려 있는 문서만 다루고 경로를 받지 않는다.
    PageText {
        doc_id: String,
        /// 0-기반.
        page: i32,
        reply: Sender<Result<PageTextIndex, PdfRenderError>>,
    },
    Outline {
        doc_id: String,
        reply: Sender<Result<Vec<PdfOutlineEntry>, PdfRenderError>>,
    },
    Links {
        doc_id: String,
        page: i32,
        reply: Sender<Result<Vec<PdfLink>, PdfRenderError>>,
    },
    Metadata {
        doc_id: String,
        reply: Sender<Result<PdfMetadata, PdfRenderError>>,
    },
    Annotations {
        doc_id: String,
        reply: Sender<Result<Vec<ImportedAnnotation>, PdfRenderError>>,
    },
    /// 열린 문서의 사본에 형광펜을 더해 `path` 에 쓴다. 경로는 Rust 쪽 저장 대화상자에서만
    /// 온다 — 웹뷰가 경로를 정할 수 있으면 기계 안 아무 곳에나 파일을 쓸 수 있게 된다.
    ExportAnnotated {
        doc_id: String,
        highlights: Vec<ExportHighlight>,
        path: PathBuf,
        reply: Sender<Result<(), String>>,
    },
    ExportSearchable {
        doc_id: String,
        pages: Vec<SearchablePage>,
        path: PathBuf,
        reply: Sender<Result<SearchableReport, String>>,
    },
    /// 엔진이 실제로 떴는지 묻는다. 답은 [`PdfEngine::new`] 가 돌려준 그 오류 그대로다.
    ///
    /// 이게 있는 이유는 테스트다. dll 이 없으면 렌더 테스트를 건너뛰어야 하는데, 찾아볼
    /// 자리 목록은 빌드 프로파일에 따라 달라서(크레이트 안의 `binaries/` 는
    /// `#[cfg(debug_assertions)]` 뒤에 있다) 경로로 짐작하면 틀린다. 짐작하지 말고 묻는다.
    Status { reply: Sender<Result<(), String>> },
    /// 테스트 전용. 명령 하나가 패닉해도 스레드가 계속 답하는지 보려면 반드시 패닉하는
    /// 명령이 하나 필요하다. `cfg(test)` 뒤에 있으므로 실제 빌드에는 들어가지 않는다 —
    /// 웹뷰가 닿을 수 있는 자리에 패닉을 심는 것이 아니다.
    #[cfg(test)]
    Panic { reply: Sender<Result<(), String>> },
}

/// 명령 하나를 처리하는 동안의 되감기를 잡아 그 요청만 실패시킨다.
///
/// # 왜 여기인가
///
/// 이 스레드는 [`SHARED`] 의 `OnceLock` 뒤에 있어 한 번 죽으면 다시 뜨지 않는다. 패닉이
/// 여기를 빠져나가면 채널의 받는 쪽이 사라지고, 남은 세션 내내 모든 열기와 모든 렌더가
/// "PDF 스레드가 죽었습니다" 가 된다. 문서 하나가 기능 전체를 끄는 셈이다.
///
/// 처음 이 스레드를 만들 때는 `open` 만 지나갔고 그때는 `catch_unwind` 를 미뤘다. 지금은
/// 사용자가 준 임의의 PDF 를 그리는 일이 이 스레드를 지나간다 — PDFium 과 `pdfium-render`
/// 의 패닉이 사는 자리가 바로 거기다(인코더의 `assert_eq!`, `as_rgba_bytes` 의 높이 나누기).
///
/// # 잡고도 계속 써도 되는가
///
/// 된다고 본다. 되감기가 PDFium 의 C 프레임을 가로지르는 구성이 아니기 때문이다.
/// `load_pdf_from_file` 은 안에서 `FPDF_LoadCustomDocument` 를 쓰므로 PDFium 이 우리 쪽으로
/// 되부르는 자리가 하나 있는데(`pdfium-render` 의 `read_block_from_callback`), 그 함수는
/// `seek`/`read` 를 전부 `unwrap_or(0)` 으로 닫아 두어 패닉할 자리가 없다. 그래서 패닉은
/// 언제나 PDFium 호출이 이미 돌아온 뒤의 Rust 프레임에서 나고, 되감기는 `PdfPage` 와
/// `PdfBitmap` 의 `Drop` 을 정상 반환과 똑같이 돌려 `FPDF_ClosePage` / `FPDFBitmap_Destroy`
/// 까지 부른다. 라이브러리가 보는 것은 "실패한 렌더 하나" 이고, 그건 이미 매일 일어나는 일
/// 이다(암호 문서, 깨진 페이지). 문서 핸들도 캐시가 그대로 들고 있으므로 같은 문서의 다른
/// 페이지는 계속 그려진다 — 나쁜 페이지 하나 때문에 문서를 통째로 버릴 이유가 없다.
///
/// 이 판단이 뒤집히는 조건은 분명하다. 우리가 직접 만든 콜백을 PDFium 에 넘기게 되는 날
/// (`load_pdf_from_reader` 에 우리 쪽 reader 를 끼우거나 form-fill 콜백을 다는 날) 되감기가
/// C 프레임을 가로지를 수 있게 되고, 그때는 PDFium 내부 상태를 믿을 수 없다. 그러면 여기서
/// 계속 답하는 대신 스레드를 오염된 것으로 표시하고 이후 요청을 전부 "앱을 다시 시작해
/// 주세요" 로 돌려보내는 쪽이 정직하다.
fn caught<T>(what: &str, body: impl FnOnce() -> T) -> Result<T, String> {
    catch_unwind(AssertUnwindSafe(body)).map_err(|payload| {
        let detail = panic_detail(payload.as_ref());
        // 기본 패닉 훅은 그대로 두었으므로 역추적은 이미 stderr 로 나갔다. 이 줄은 어떤
        // 요청이 그랬는지를 남긴다.
        log::error!("PDFium 스레드에서 패닉을 잡았습니다({what}): {detail}");
        tr!("{what} 중 내부 오류가 발생했습니다: {detail}", "Internal error during {what}: {detail}")
    })
}

/// 패닉 payload 에서 사람이 읽을 문장을 꺼낸다. `panic!("...")` 는 인자에 따라
/// `&'static str` 또는 `String` 으로 온다.
fn panic_detail(payload: &(dyn Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&'static str>() {
        (*message).to_string()
    } else if let Some(message) = payload.downcast_ref::<String>() {
        message.clone()
    } else {
        tr!("알 수 없는 패닉", "unknown panic")
    }
}

/// 모아 둔 화면 렌더 하나.
struct ScreenJob {
    doc_id: String,
    page: i32,
    width: u32,
    tile: Option<TileRect>,
    reply: Sender<Result<RawImage, PdfRenderError>>,
    seq: u64,
}

/// 이 폭 이하의 쪽 전체 렌더는 미리보기로 보고 먼저 그린다(수 ms 라 화면이 비지 않게).
const PREVIEW_MAX_WIDTH: u32 = 720;

/// 다음에 그릴 화면 렌더를 고른다.
///
/// 1. 미리보기(작은 쪽 전체)가 먼저 — 빈 자리를 가장 빨리 채운다.
/// 2. 그다음은 **최근에 온 것부터** — 스크롤하면 지금 보이는 쪽이 마지막에 요청된다. 예전
///    FIFO 에서는 이미 지나간 쪽들이 앞을 막았다.
fn next_screen_job(jobs: &mut Vec<ScreenJob>) -> Option<ScreenJob> {
    let is_preview = |job: &ScreenJob| job.tile.is_none() && job.width <= PREVIEW_MAX_WIDTH;
    let index = jobs
        .iter()
        .enumerate()
        .max_by_key(|(_, job)| (is_preview(job), job.seq))
        .map(|(index, _)| index)?;
    Some(jobs.swap_remove(index))
}

/// 프로세스에 하나뿐인 PDFium 스레드.
///
/// [`PdfThread::spawn`] 은 부를 때마다 `Pdfium` 을 하나씩 누설시키고 `FPDF_InitLibrary` 를
/// 다시 돌린다. 앱은 한 번만 부르지만 테스트는 함수마다 부르기 쉽고, 그러면 cargo 의 병렬
/// 러너 아래에서 앱이 절대 쓰지 않는 "동시에 초기화된 PDFium 여러 개" 라는 구성이 생긴다.
/// 아예 부를 수 없게 만들어서 그 구성을 없앤다.
static SHARED: OnceLock<PdfThread> = OnceLock::new();

/// 스레드로 가는 유일한 통로. Tauri 관리 상태로 들고 다닌다.
#[derive(Clone)]
pub struct PdfThread {
    tx: Sender<Command>,
}

impl PdfThread {
    /// 프로세스에 하나뿐인 스레드를 얻는다. 처음 부를 때만 실제로 띄운다.
    pub fn shared() -> Self {
        SHARED.get_or_init(Self::spawn).clone()
    }

    /// 스레드를 띄운다. dll 을 못 찾아도 여기서 실패하지 않는다 — 앱이 시작조차 못 하면
    /// 사용자는 무엇이 없는지 알 수 없으므로, 오류는 요청이 왔을 때 답으로 돌려준다.
    fn spawn() -> Self {
        let (tx, rx) = channel::<Command>();

        std::thread::Builder::new()
            .name("iwae-pdfium".into())
            .spawn(move || {
                // 엔진과 캐시는 이 클로저 밖으로 나가지 않는다.
                let engine = PdfEngine::new();
                let mut cache: DocCache<OpenDocument> = DocCache::new(CAPACITY);
                // 맞았던 암호(경로·doc_id 별). 메모리에만 둔다.
                let mut passwords: HashMap<String, String> = HashMap::new();
                let mut next_seq: u64 = 0;

                // 화면 렌더는 바로 그리지 않고 모아 두었다가 순서를 골라 그린다(아래 next_screen_job).
                // 다른 명령은 들어온 순서대로 바로 처리한다.
                let mut screen: Vec<ScreenJob> = Vec::new();
                // 글자 읽기·색인 같은 다른 명령이 줄지어 들어와도 화면 렌더가 굶지 않게, 다른 명령을
                // 하나 처리할 때마다 모아 둔 화면 렌더를 하나 먼저 그린다(600쪽 색인 중에 첫 쪽이 몇 초 늦던 문제)
                let mut ran_other = false;
                loop {
                    let command = if screen.is_empty() {
                        ran_other = false;
                        match rx.recv() {
                            Ok(command) => command,
                            Err(_) => break,
                        }
                    } else {
                        match if ran_other { Err(std::sync::mpsc::TryRecvError::Empty) } else { rx.try_recv() } {
                            Ok(command) => command,
                            Err(_) => {
                                ran_other = false;
                                // 줄 선 명령이 없을 때만 화면 렌더 하나를 그린다. 그사이 새 요청이
                                // 오면 다음 바퀴에 먼저 모아서 다시 고른다.
                                if let Some(job) = next_screen_job(&mut screen) {
                                    let result = caught(&tr!("페이지 렌더", "page render"),|| match cache.get(&job.doc_id) {
                                        Some(document) => document.render_raw(job.page, job.width, job.tile),
                                        None => Err(PdfRenderError::UnknownDocument),
                                    })
                                    .unwrap_or_else(|message| Err(PdfRenderError::Failed(message)));
                                    let _ = job.reply.send(result);
                                }
                                continue;
                            }
                        }
                    };
                    if !matches!(command, Command::RenderRaw { .. }) {
                        ran_other = true;
                    }
                    match command {
                        Command::RenderRaw { doc_id, page, width, tile, reply } => {
                            screen.push(ScreenJob { doc_id, page, width, tile, reply, seq: next_seq });
                            next_seq += 1;
                        }
                        Command::PageLayout { doc_id, page, reply } => {
                            let result = caught(&tr!("쪽 배치 읽기", "page layout read"),|| match cache.get(&doc_id) {
                                Some(document) => document.page_layout(page),
                                None => Err(PdfRenderError::UnknownDocument),
                            })
                            .unwrap_or_else(|message| Err(PdfRenderError::Failed(message)));
                            let _ = reply.send(result);
                        }
                        Command::EditPages {
                            doc_id,
                            path,
                            backup,
                            plan,
                            reply,
                        } => {
                            let result = caught(&tr!("PDF 쪽 편집", "PDF page edit"),|| {
                                let engine = engine.as_ref().map_err(Clone::clone)?;
                                let bytes = match cache.get(&doc_id) {
                                    Some(document) => engine.rebuild_pages(document.document(), &plan)?,
                                    None => return Err(PdfRenderError::UnknownDocument.to_string()),
                                };
                                replace_in_place(engine, &mut cache, &passwords, &doc_id, path, &backup, &bytes)
                            })
                            .unwrap_or_else(Err);
                            let _ = reply.send(result);
                        }
                        Command::Open {
                            path,
                            identity,
                            password,
                            reply,
                        } => {
                            let result = caught(&tr!("PDF 열기", "opening PDF"),|| match &engine {
                                Ok(engine) => {
                                    let key = path_key(&path);
                                    let password = password.or_else(|| passwords.get(&key).cloned());
                                    let doc_id = identity.doc_id.clone();
                                    let meta = open_with_password(engine, &mut cache, path, identity, password.as_deref())?;
                                    if let Some(password) = password {
                                        passwords.insert(key, password.clone());
                                        passwords.insert(doc_id, password);
                                    }
                                    Ok(meta)
                                }
                                Err(message) => Err(message.clone()),
                            })
                            // 잡은 패닉은 호출자가 이미 그릴 줄 아는 모양으로 바꾼다 —
                            // `invoke` 쪽에는 읽을 수 있는 `Err` 가 된다.
                            .unwrap_or_else(Err);
                            // 받는 쪽이 사라졌으면(창이 닫혔다든지) 답을 버리면 그만이다.
                            let _ = reply.send(result);
                        }
                        Command::Render {
                            doc_id,
                            page,
                            width,
                            reply,
                        } => {
                            // 엔진을 보지 않는다. 렌더는 이미 열린 문서 핸들만 있으면 되고,
                            // 캐시에 없으면 그걸로 끝이다 — 여기서 파일을 열 수 있게 하면
                            // 웹뷰가 기계 안의 아무 PDF 나 읽어 낼 수 있게 된다.
                            let result = caught(&tr!("페이지 렌더", "page render"),|| match cache.get(&doc_id) {
                                Some(document) => document.render_png(page, width),
                                None => Err(PdfRenderError::UnknownDocument),
                            })
                            // `Failed` 는 프로토콜이 이미 500 으로 옮길 줄 안다. 잡은 패닉이
                            // 다른 길로 새지 않고 나쁜 페이지 하나와 같은 답이 된다.
                            .unwrap_or_else(|message| Err(PdfRenderError::Failed(message)));
                            let _ = reply.send(result);
                        }
                        Command::Crop {
                            doc_id,
                            page,
                            rect,
                            reply,
                        } => {
                            let result =
                                caught(&tr!("페이지 영역 캡처", "page region capture"),|| match cache.get(&doc_id) {
                                    Some(document) => document.crop_png(page, rect),
                                    None => Err(PdfRenderError::UnknownDocument),
                                })
                                .unwrap_or_else(|message| Err(PdfRenderError::Failed(message)));
                            let _ = reply.send(result);
                        }
                        Command::PageText {
                            doc_id,
                            page,
                            reply,
                        } => {
                            // 렌더와 같은 자리, 같은 규칙이다. 캐시에 없으면 그걸로 끝 —
                            // 여기서 파일을 열 수 있게 하면 웹뷰가 기계 안의 아무 PDF 에서나
                            // 글자를 긁어 갈 수 있게 된다.
                            //
                            // `caught` 안에 있으므로 이 명령도 패닉 봉쇄를 그대로 받는다.
                            let result =
                                caught(&tr!("페이지 텍스트 읽기", "page text read"),|| match cache.get(&doc_id) {
                                    Some(document) => document.page_text_index(page),
                                    None => Err(PdfRenderError::UnknownDocument),
                                })
                                .unwrap_or_else(|message| Err(PdfRenderError::Failed(message)));
                            let _ = reply.send(result);
                        }
                        Command::Outline { doc_id, reply } => {
                            let result = caught(&tr!("PDF 목차 읽기", "PDF outline read"),|| match cache.get(&doc_id) {
                                Some(document) => Ok(document.outline()),
                                None => Err(PdfRenderError::UnknownDocument),
                            })
                            .unwrap_or_else(|message| Err(PdfRenderError::Failed(message)));
                            let _ = reply.send(result);
                        }
                        Command::Links {
                            doc_id,
                            page,
                            reply,
                        } => {
                            let result = caught(&tr!("PDF 링크 읽기", "PDF link read"),|| match cache.get(&doc_id) {
                                Some(document) => document.links(page),
                                None => Err(PdfRenderError::UnknownDocument),
                            })
                            .unwrap_or_else(|message| Err(PdfRenderError::Failed(message)));
                            let _ = reply.send(result);
                        }
                        Command::Metadata { doc_id, reply } => {
                            let result = caught(&tr!("PDF 정보 읽기", "PDF info read"),|| match cache.get(&doc_id) {
                                Some(document) => Ok(document.metadata()),
                                None => Err(PdfRenderError::UnknownDocument),
                            })
                            .unwrap_or_else(|message| Err(PdfRenderError::Failed(message)));
                            let _ = reply.send(result);
                        }
                        Command::Annotations { doc_id, reply } => {
                            let result = caught(&tr!("PDF 주석 읽기", "PDF annotation read"),|| match cache.get(&doc_id) {
                                Some(document) => document.annotations(),
                                None => Err(PdfRenderError::UnknownDocument),
                            })
                            .unwrap_or_else(|message| Err(PdfRenderError::Failed(message)));
                            let _ = reply.send(result);
                        }
                        Command::ExportAnnotated {
                            doc_id,
                            highlights,
                            path,
                            reply,
                        } => {
                            let result = caught(&tr!("주석 포함 PDF 내보내기", "annotated PDF export"),|| {
                                let engine = engine.as_ref().map_err(Clone::clone)?;
                                let source = match cache.get(&doc_id) {
                                    Some(document) => {
                                        document.to_bytes().map_err(|err| err.to_string())?
                                    }
                                    None => return Err(PdfRenderError::UnknownDocument.to_string()),
                                };
                                engine.export_annotated(source, &highlights, &path)
                            })
                            .unwrap_or_else(Err);
                            let _ = reply.send(result);
                        }
                        Command::ExportSearchable {
                            doc_id,
                            pages,
                            path,
                            reply,
                        } => {
                            let result = caught(&tr!("검색 가능한 PDF 만들기", "searchable PDF creation"),|| {
                                let engine = engine.as_ref().map_err(Clone::clone)?;
                                let source = match cache.get(&doc_id) {
                                    Some(document) => {
                                        document.to_bytes().map_err(|err| err.to_string())?
                                    }
                                    None => return Err(PdfRenderError::UnknownDocument.to_string()),
                                };
                                engine.export_searchable(source, &pages, &path)
                            })
                            .unwrap_or_else(Err);
                            let _ = reply.send(result);
                        }
                        Command::Tool { doc_id, op, target, reply } => {
                            let result = caught(&tr!("PDF 도구", "PDF tool"), || {
                                let engine = engine.as_ref().map_err(Clone::clone)?;
                                let password = passwords.get(&doc_id).cloned();
                                let (bytes, report) = match cache.get(&doc_id) {
                                    Some(document) => engine.run_tool(
                                        document.document(),
                                        || document.to_bytes().map_err(|err| err.to_string()),
                                        password.as_deref(),
                                        &op,
                                    )?,
                                    None => return Err(PdfRenderError::UnknownDocument.to_string()),
                                };
                                match target {
                                    ToolTarget::InPlace { path, backup } => {
                                        let shown = path.display().to_string();
                                        let meta = replace_in_place(engine, &mut cache, &passwords, &doc_id, path, &backup, &bytes)?;
                                        Ok(ToolResult { path: shown, meta: Some(meta), report })
                                    }
                                    ToolTarget::NewFile { path } => {
                                        if let Some(parent) = path.parent() {
                                            std::fs::create_dir_all(parent)
                                                .map_err(|err| tr!("폴더를 만들지 못했습니다: {err}", "Could not create the folder: {err}"))?;
                                        }
                                        std::fs::write(&path, &bytes)
                                            .map_err(|err| tr!("새 PDF 를 쓰지 못했습니다: {err}", "Could not write the new PDF: {err}"))?;
                                        Ok(ToolResult { path: path.display().to_string(), meta: None, report })
                                    }
                                }
                            })
                            .unwrap_or_else(Err);
                            let _ = reply.send(result);
                        }
                        Command::BlankPages { doc_id, reply } => {
                            let result = caught(&tr!("빈 쪽 찾기", "blank page scan"), || match cache.get(&doc_id) {
                                Some(document) => tools::blank_pages(document.document()),
                                None => Err(PdfRenderError::UnknownDocument.to_string()),
                            })
                            .unwrap_or_else(Err);
                            let _ = reply.send(result);
                        }
                        Command::ExportImages { doc_id, folder, stem, dpi, reply } => {
                            let result = caught(&tr!("그림으로 내보내기", "image export"), || match cache.get(&doc_id) {
                                Some(document) => tools::export_page_images(document.document(), &folder, &stem, dpi),
                                None => Err(PdfRenderError::UnknownDocument.to_string()),
                            })
                            .unwrap_or_else(Err);
                            let _ = reply.send(result);
                        }
                        Command::Status { reply } => {
                            let _ = reply.send(match &engine {
                                Ok(_) => Ok(()),
                                Err(message) => Err(message.clone()),
                            });
                        }
                        #[cfg(test)]
                        Command::Panic { reply } => {
                            let result =
                                caught("테스트 패닉", || panic!("의도된 테스트 패닉"));
                            let _ = reply.send(result);
                        }
                    }
                }
            })
            .expect("PDFium 스레드를 만들지 못했습니다");

        Self { tx }
    }

    /// 문서를 열고 메타를 받는다. 스레드가 답할 때까지 호출자를 막으므로 비동기 런타임에서
    /// 부를 때는 블로킹 풀에서 불러야 한다.
    pub fn open_blocking(&self, path: PathBuf) -> Result<PdfDocMeta, String> {
        self.open_with_id_blocking(path, None)
    }

    /// [`Self::open_blocking`] 과 같되, 등록된 doc_id 가 있으면 내용 해시 대신 그것을 쓴다.
    pub fn open_with_id_blocking(&self, path: PathBuf, doc_id: Option<String>) -> Result<PdfDocMeta, String> {
        self.open_with_password_blocking(path, doc_id, None)
    }

    /// [`Self::open_with_id_blocking`] 에 암호를 더한 것. 암호 PDF 를 처음 열 때 쓴다.
    pub fn open_with_password_blocking(&self, path: PathBuf, doc_id: Option<String>, password: Option<String>) -> Result<PdfDocMeta, String> {
        // 해시는 PDFium 을 전혀 쓰지 않는데, 전용 스레드 안에서 돌리면 수백 MB 짜리 문서를
        // 읽는 수십 ms 동안 뒤에 줄 선 페이지 렌더가 전부 막힌다. 그래서 부르는 쪽에서 먼저
        // 구하고 결과만 실어 보낸다.
        let mut identity = engine::file_identity(&path)?;
        // Vault 에 등록된 문서는 등록할 때의 doc_id 를 그대로 쓴다. 쪽 편집으로 내용(해시)이
        // 바뀌어도 형광펜·책갈피·노트 출처가 같은 문서를 가리키게 하려는 것이다.
        if let Some(doc_id) = doc_id.filter(|id| !id.is_empty()) {
            identity.doc_id = doc_id;
        }
        let (reply, answer) = channel();

        self.tx
            .send(Command::Open {
                path,
                identity,
                password,
                reply,
            })
            .map_err(|_| tr!("PDF 스레드가 죽었습니다. 앱을 다시 시작해 주세요.", "The PDF thread has stopped. Please restart the app."))?;

        answer
            .recv()
            .map_err(|_| tr!("PDF 스레드가 답하지 못했습니다. 앱을 다시 시작해 주세요.", "The PDF thread did not respond. Please restart the app."))?
    }

    /// 열린 문서의 색인용 쪽 배치. `page` 는 0-기반.
    pub fn page_layout_blocking(&self, doc_id: String, page: i32) -> Result<PageLayout, PdfRenderError> {
        let (reply, answer) = channel();
        self.tx
            .send(Command::PageLayout { doc_id, page, reply })
            .map_err(|_| PdfRenderError::Failed(tr!("PDF 스레드가 죽었습니다.", "The PDF thread has stopped.")))?;
        answer
            .recv()
            .map_err(|_| PdfRenderError::Failed(tr!("PDF 스레드가 답하지 못했습니다.", "The PDF thread did not respond.")))?
    }

    /// 쪽 편집을 적용해 원본을 덮어쓰고 같은 doc_id 로 다시 연다.
    pub fn edit_pages_blocking(
        &self,
        doc_id: String,
        path: PathBuf,
        backup: PathBuf,
        plan: Vec<PageEditOp>,
    ) -> Result<PdfDocMeta, String> {
        let (reply, answer) = channel();
        self.tx
            .send(Command::EditPages { doc_id, path, backup, plan, reply })
            .map_err(|_| tr!("PDF 스레드가 죽었습니다. 앱을 다시 시작해 주세요.", "The PDF thread has stopped. Please restart the app."))?;
        answer
            .recv()
            .map_err(|_| tr!("PDF 스레드가 답하지 못했습니다. 앱을 다시 시작해 주세요.", "The PDF thread did not respond. Please restart the app."))?
    }

    /// 열려 있는 문서의 페이지 하나를 PNG 로 받는다. `page` 는 0-기반.
    ///
    /// 열지 않은 문서는 [`PdfRenderError::UnknownDocument`] 다. 이 함수는 경로를 받지
    /// 않으므로 애초에 파일을 열 방법이 없다.
    pub fn render_blocking(
        &self,
        doc_id: String,
        page: i32,
        width: u32,
    ) -> Result<Vec<u8>, PdfRenderError> {
        let (reply, answer) = channel();

        self.tx
            .send(Command::Render {
                doc_id,
                page,
                width,
                reply,
            })
            .map_err(|_| PdfRenderError::Failed(tr!("PDF 스레드가 죽었습니다.", "The PDF thread has stopped.")))?;

        answer
            .recv()
            .map_err(|_| PdfRenderError::Failed(tr!("PDF 스레드가 답하지 못했습니다.", "The PDF thread did not respond.")))?
    }

    /// 화면용 렌더. 다른 렌더보다 순서를 골라 그린다([`next_screen_job`]).
    pub fn render_raw_blocking(
        &self,
        doc_id: String,
        page: i32,
        width: u32,
        tile: Option<TileRect>,
    ) -> Result<RawImage, PdfRenderError> {
        let (reply, answer) = channel();
        self.tx
            .send(Command::RenderRaw { doc_id, page, width, tile, reply })
            .map_err(|_| PdfRenderError::Failed(tr!("PDF 스레드가 죽었습니다.", "The PDF thread has stopped.")))?;
        answer
            .recv()
            .map_err(|_| PdfRenderError::Failed(tr!("PDF 스레드가 답하지 못했습니다.", "The PDF thread did not respond.")))?
    }

    /// 열려 있는 문서의 페이지 영역을 144dpi PNG 로 받는다.
    pub fn crop_blocking(
        &self,
        doc_id: String,
        page: i32,
        rect: CropRect,
    ) -> Result<Vec<u8>, PdfRenderError> {
        let (reply, answer) = channel();

        self.tx
            .send(Command::Crop {
                doc_id,
                page,
                rect,
                reply,
            })
            .map_err(|_| PdfRenderError::Failed(tr!("PDF 스레드가 죽었습니다.", "The PDF thread has stopped.")))?;

        answer
            .recv()
            .map_err(|_| PdfRenderError::Failed(tr!("PDF 스레드가 답하지 못했습니다.", "The PDF thread did not respond.")))?
    }

    /// 열려 있는 문서의 페이지 하나에서 텍스트와 글자 상자를 받는다. `page` 는 0-기반.
    ///
    /// [`Self::render_blocking`] 과 마찬가지로 경로를 받지 않는다 — 열지 않은 문서는
    /// [`PdfRenderError::UnknownDocument`] 다.
    pub fn page_text_blocking(
        &self,
        doc_id: String,
        page: i32,
    ) -> Result<PageTextIndex, PdfRenderError> {
        let (reply, answer) = channel();

        self.tx
            .send(Command::PageText {
                doc_id,
                page,
                reply,
            })
            .map_err(|_| PdfRenderError::Failed(tr!("PDF 스레드가 죽었습니다.", "The PDF thread has stopped.")))?;

        answer
            .recv()
            .map_err(|_| PdfRenderError::Failed(tr!("PDF 스레드가 답하지 못했습니다.", "The PDF thread did not respond.")))?
    }

    pub fn outline_blocking(&self, doc_id: String) -> Result<Vec<PdfOutlineEntry>, PdfRenderError> {
        let (reply, answer) = channel();

        self.tx
            .send(Command::Outline { doc_id, reply })
            .map_err(|_| PdfRenderError::Failed(tr!("PDF 스레드가 죽었습니다.", "The PDF thread has stopped.")))?;

        answer
            .recv()
            .map_err(|_| PdfRenderError::Failed(tr!("PDF 스레드가 답하지 못했습니다.", "The PDF thread did not respond.")))?
    }

    pub fn links_blocking(
        &self,
        doc_id: String,
        page: i32,
    ) -> Result<Vec<PdfLink>, PdfRenderError> {
        let (reply, answer) = channel();
        self.tx
            .send(Command::Links {
                doc_id,
                page,
                reply,
            })
            .map_err(|_| PdfRenderError::Failed(tr!("PDF 스레드가 죽었습니다.", "The PDF thread has stopped.")))?;
        answer
            .recv()
            .map_err(|_| PdfRenderError::Failed(tr!("PDF 스레드가 답하지 못했습니다.", "The PDF thread did not respond.")))?
    }

    pub fn metadata_blocking(&self, doc_id: String) -> Result<PdfMetadata, PdfRenderError> {
        let (reply, answer) = channel();
        self.tx
            .send(Command::Metadata { doc_id, reply })
            .map_err(|_| PdfRenderError::Failed(tr!("PDF 스레드가 죽었습니다.", "The PDF thread has stopped.")))?;
        answer
            .recv()
            .map_err(|_| PdfRenderError::Failed(tr!("PDF 스레드가 답하지 못했습니다.", "The PDF thread did not respond.")))?
    }

    pub fn annotations_blocking(
        &self,
        doc_id: String,
    ) -> Result<Vec<ImportedAnnotation>, PdfRenderError> {
        let (reply, answer) = channel();
        self.tx
            .send(Command::Annotations { doc_id, reply })
            .map_err(|_| PdfRenderError::Failed(tr!("PDF 스레드가 죽었습니다.", "The PDF thread has stopped.")))?;
        answer
            .recv()
            .map_err(|_| PdfRenderError::Failed(tr!("PDF 스레드가 답하지 못했습니다.", "The PDF thread did not respond.")))?
    }

    pub fn export_annotated_blocking(
        &self,
        doc_id: String,
        highlights: Vec<ExportHighlight>,
        path: PathBuf,
    ) -> Result<(), String> {
        let (reply, answer) = channel();
        self.tx
            .send(Command::ExportAnnotated {
                doc_id,
                highlights,
                path,
                reply,
            })
            .map_err(|_| tr!("PDF 스레드가 죽었습니다.", "The PDF thread has stopped."))?;
        answer
            .recv()
            .map_err(|_| tr!("PDF 스레드가 답하지 못했습니다.", "The PDF thread did not respond."))?
    }

    pub fn export_searchable_blocking(
        &self,
        doc_id: String,
        pages: Vec<SearchablePage>,
        path: PathBuf,
    ) -> Result<SearchableReport, String> {
        let (reply, answer) = channel();
        self.tx
            .send(Command::ExportSearchable {
                doc_id,
                pages,
                path,
                reply,
            })
            .map_err(|_| tr!("PDF 스레드가 죽었습니다.", "The PDF thread has stopped."))?;
        answer
            .recv()
            .map_err(|_| tr!("PDF 스레드가 답하지 못했습니다.", "The PDF thread did not respond."))?
    }

    /// PDF 도구 하나를 돌린다.
    pub fn tool_blocking(&self, doc_id: String, op: ToolOp, target: ToolTarget) -> Result<ToolResult, String> {
        let (reply, answer) = channel();
        self.tx
            .send(Command::Tool { doc_id, op, target, reply })
            .map_err(|_| tr!("PDF 스레드가 죽었습니다.", "The PDF thread has stopped."))?;
        answer.recv().map_err(|_| tr!("PDF 스레드가 답하지 못했습니다.", "The PDF thread did not respond."))?
    }

    /// 빈 쪽 번호들(0 부터).
    pub fn blank_pages_blocking(&self, doc_id: String) -> Result<Vec<i32>, String> {
        let (reply, answer) = channel();
        self.tx
            .send(Command::BlankPages { doc_id, reply })
            .map_err(|_| tr!("PDF 스레드가 죽었습니다.", "The PDF thread has stopped."))?;
        answer.recv().map_err(|_| tr!("PDF 스레드가 답하지 못했습니다.", "The PDF thread did not respond."))?
    }

    /// 쪽마다 PNG 를 폴더에 쓴다. 쓴 파일 수.
    pub fn export_images_blocking(&self, doc_id: String, folder: PathBuf, stem: String, dpi: f32) -> Result<usize, String> {
        let (reply, answer) = channel();
        self.tx
            .send(Command::ExportImages { doc_id, folder, stem, dpi, reply })
            .map_err(|_| tr!("PDF 스레드가 죽었습니다.", "The PDF thread has stopped."))?;
        answer.recv().map_err(|_| tr!("PDF 스레드가 답하지 못했습니다.", "The PDF thread did not respond."))?
    }

    /// PDFium 바인딩이 실제로 떴는지 묻는다. 못 떴으면 그 이유가 그대로 담긴다.
    ///
    /// 테스트가 "dll 이 있나" 를 경로로 짐작하지 않게 하려고 연다. 짐작은 빌드 프로파일마다
    /// 틀리고, 틀리면 건너뛰어야 할 테스트가 엉뚱한 단언 실패로 무너진다.
    pub fn engine_status(&self) -> Result<(), String> {
        let (reply, answer) = channel();

        self.tx
            .send(Command::Status { reply })
            .map_err(|_| tr!("PDF 스레드가 죽었습니다. 앱을 다시 시작해 주세요.", "The PDF thread has stopped. Please restart the app."))?;

        answer
            .recv()
            .map_err(|_| tr!("PDF 스레드가 답하지 못했습니다. 앱을 다시 시작해 주세요.", "The PDF thread did not respond. Please restart the app."))?
    }

    /// 스레드 안에서 일부러 패닉을 일으킨다. 테스트가 [`caught`] 의 봉쇄를 확인하는 통로다.
    #[cfg(test)]
    fn panic_blocking(&self) -> Result<(), String> {
        let (reply, answer) = channel();

        self.tx
            .send(Command::Panic { reply })
            .map_err(|_| tr!("PDF 스레드가 죽었습니다.", "The PDF thread has stopped."))?;

        answer
            .recv()
            .map_err(|_| tr!("PDF 스레드가 답하지 못했습니다.", "The PDF thread did not respond."))?
    }
}

fn path_key(path: &Path) -> String {
    path.display().to_string().to_lowercase()
}

/// 새 바이트로 원본을 덮고(덮기 전 원본은 backup 으로) 같은 doc_id 로 다시 연다.
fn replace_in_place(
    engine: &PdfEngine,
    cache: &mut DocCache<OpenDocument>,
    passwords: &HashMap<String, String>,
    doc_id: &str,
    path: PathBuf,
    backup: &Path,
    bytes: &[u8],
) -> Result<PdfDocMeta, String> {
    // 원본 핸들을 놓아야 Windows 에서 파일을 바꿀 수 있다.
    drop(cache.remove(doc_id));
    if let Some(parent) = backup.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| tr!("백업 폴더를 만들지 못했습니다: {err}", "Could not create the backup folder: {err}"))?;
    }
    std::fs::copy(&path, backup).map_err(|err| tr!("원본을 백업하지 못했습니다: {err}", "Could not back up the original: {err}"))?;
    let temporary = path.with_extension("pdf.iwae-edit");
    std::fs::write(&temporary, bytes).map_err(|err| tr!("편집본을 쓰지 못했습니다: {err}", "Could not write the edited copy: {err}"))?;
    std::fs::rename(&temporary, &path).map_err(|err| tr!("원본을 바꾸지 못했습니다: {err}", "Could not replace the original: {err}"))?;
    let mut identity = engine::file_identity(&path)?;
    identity.doc_id = doc_id.to_string();
    let password = passwords.get(doc_id).cloned();
    open_with_password(engine, cache, path, identity, password.as_deref())
}

/// 이미 열어 둔 문서면 PDFium 을 다시 파싱시키지 않는다.
fn open_with_password(
    engine: &PdfEngine,
    cache: &mut DocCache<OpenDocument>,
    path: PathBuf,
    identity: engine::FileIdentity,
    password: Option<&str>,
) -> Result<PdfDocMeta, String> {
    // 문서는 내용으로 식별하지만 제목은 방금 연 파일의 것이어야 한다 — 같은 스펙을 다른
    // 이름으로 복사해 열었는데 탭에 옛 이름이 뜨면 거짓말이 된다. 캐시는 제목을 담지 않고
    // 이 경계에서만 붙이므로, 캐시 적중이든 아니든 답은 같은 자리에서 나온다.
    let title = engine::title_for_file(&path);

    if let Some(cached) = cache.get(&identity.doc_id) {
        return Ok(cached.meta(title));
    }

    let doc_id = identity.doc_id.clone();
    let opened = engine.open(&path, identity, password)?;

    Ok(cache.put(doc_id, opened).meta(title))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 명령 하나가 패닉해도 그 요청만 실패하고 스레드는 계속 답해야 한다.
    ///
    /// 이 테스트가 지키는 것은 폭발 반경이다. 스레드가 `OnceLock` 뒤에 있어 다시 뜨지
    /// 않으므로, 봉쇄가 없으면 패닉 한 번이 남은 세션의 모든 PDF 기능을 끈다.
    ///
    /// dll 없이도 돈다 — 패닉 명령도, 열지 않은 문서를 그려 달라는 요청도 PDFium 을 거치지
    /// 않기 때문이다.
    #[test]
    fn a_panicking_command_fails_only_that_request() {
        let pdf = PdfThread::shared();

        let failed = pdf
            .panic_blocking()
            .expect_err("패닉은 오류로 돌아와야 한다");
        assert!(
            failed.contains("의도된 테스트 패닉"),
            "패닉 내용이 답에 실려야 한다: {failed}"
        );

        // 스레드가 살아 있다는 증거. 이 답이 오지 않으면 채널이 끊긴 것이다.
        assert_eq!(
            pdf.render_blocking("ffffffffffff".to_string(), 0, 800),
            Err(PdfRenderError::UnknownDocument)
        );
        // 한 번 더. 봉쇄가 "처음 한 번만" 이 아니라 명령마다인지 본다.
        assert!(pdf.panic_blocking().is_err());
        assert_eq!(
            pdf.render_blocking("ffffffffffff".to_string(), 0, 800),
            Err(PdfRenderError::UnknownDocument)
        );
    }
}
