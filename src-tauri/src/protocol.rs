//! `iwae://` 커스텀 프로토콜 — 렌더된 페이지를 웹뷰로 실어 나른다.
//!
//! URL 모양은 하나뿐이다:
//!
//! ```text
//! iwae://page/<doc_id>/<page>?w=<px>
//! ```
//!
//! * `doc_id` — [`crate::pdf::pdf_open`] 이 돌려준 12자리 16진수. **이미 열려 있는 문서만**
//!   그릴 수 있다. 캐시에 없으면 404 이고, 프로토콜은 파일을 열지 않는다. 여는 것은
//!   `pdf_open` 의 일이고 거기에 경로 검사가 붙는다 — 프로토콜이 파일을 열 수 있으면
//!   웹뷰에서 도는 무엇이든 기계 안의 아무 PDF 나 읽어 낼 수 있게 된다.
//! * `page` — **0-기반**. PDFium 과 `pageSizes` 배열이 모두 0-기반이라 어느 쪽으로도 +1 이
//!   생기지 않는 셈법을 골랐다. 마지막 페이지는 `pageCount - 1` 이다.
//! * `w` — 렌더 폭(px). [`MIN_RENDER_WIDTH`]..=[`MAX_RENDER_WIDTH`] 밖이거나 없으면 400.
//!
//! 웹뷰가 실제로 부를 때의 모양은 플랫폼마다 다르다(Tauri 가 그렇게 만든다):
//! Windows·Android 는 `http://iwae.localhost/page/...`, macOS·Linux 는
//! `iwae://localhost/page/...`. [`parse_page_uri`] 가 세 모양을 모두 같은 것으로 읽는다.
//!
//! 그래서 `<img src>` 를 만드는 쪽(Task 4)은 이렇게 직접 조립해야 한다:
//!
//! ```js
//! const base = navigator.userAgent.includes("Windows")
//!   ? "http://iwae.localhost"
//!   : "iwae://localhost";
//! img.src = `${base}/page/${docId}/${page}?w=${width}`;
//! ```
//!
//! `@tauri-apps/api` 의 `convertFileSrc` 를 쓰면 안 된다. 그쪽은 인자 전체를
//! `encodeURIComponent` 로 감싸서 `/` 까지 `%2F` 로 바꾸고 질의 문자열을 붙일 자리도 없다 —
//! 결과는 조각 하나짜리 경로가 되어 여기서 400 이 된다.

use std::fmt;

use tauri::http::{header, HeaderValue, Method, Request, Response, StatusCode, Uri};
use tauri::UriSchemeResponder;

use crate::pdf::{PdfRenderError, PdfThread, TileRect, MAX_RENDER_WIDTH, MAX_TILE_PAGE_WIDTH, MAX_TILE_SIDE, MIN_RENDER_WIDTH};

/// 등록할 스킴 이름.
pub const SCHEME: &str = "iwae";

/// `doc_id` 는 SHA-256 앞 12자(스펙 §4.2). 길이와 글자를 여기서 못 박으면 경로 조각으로
/// 장난칠 여지가 사라진다.
const DOC_ID_LEN: usize = 12;

/// 문서는 열려 있는 동안 바뀌지 않는다. 그래서 같은 페이지를 다시 스크롤해 지나갈 때
/// 브라우저 캐시가 받아 주면 Rust 까지 오지도 않는다 — Task 4 가 폭을 반올림해 요청하는
/// 이유도 이 캐시를 맞히기 위해서다.
const PAGE_CACHE_CONTROL: &str = "public, max-age=31536000, immutable";

/// 오류는 캐시하지 않는다. 아직 열리지 않은 문서를 먼저 요청했다가 404 가 굳어 버리면
/// 문서를 연 뒤에도 페이지가 영영 뜨지 않는다.
const ERROR_CACHE_CONTROL: &str = "no-store";

/// URL 에서 뽑아낸 요청. 문서 없이도 검사할 수 있는 것만 담는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageRequest {
    pub doc_id: String,
    /// 0-기반.
    pub page: i32,
    pub width: u32,
    /// `x`·`y`·`tw`·`th` 가 모두 있으면 쪽을 `width` 폭으로 그렸을 때의 그 사각형만 그린다.
    pub tile: Option<TileRect>,
}

/// URL 이 틀린 방식. 전부 400 이다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BadRequest {
    NotAPagePath,
    BadDocId,
    BadPage,
    MissingWidth,
    BadWidth,
}

impl fmt::Display for BadRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            Self::NotAPagePath => tr!(
                "iwae://page/<doc_id>/<page>?w=<px> 형식이 아닙니다.",
                "Not in the form iwae://page/<doc_id>/<page>?w=<px>."
            ),
            Self::BadDocId => tr!(
                "doc_id 는 소문자 16진수 {DOC_ID_LEN}자리여야 합니다.",
                "doc_id must be {DOC_ID_LEN} lowercase hex digits."
            ),
            Self::BadPage => tr!("page 는 0 이상의 정수여야 합니다.", "page must be an integer of 0 or more."),
            Self::MissingWidth => tr!("w 질의 문자열이 없습니다.", "The w query parameter is missing."),
            Self::BadWidth => tr!(
                "w 는 {MIN_RENDER_WIDTH}..={MAX_RENDER_WIDTH} 범위의 정수여야 합니다.",
                "w must be an integer in {MIN_RENDER_WIDTH}..={MAX_RENDER_WIDTH}."
            ),
        };
        f.write_str(&text)
    }
}

/// 프로토콜 핸들러. [`tauri::Builder::register_asynchronous_uri_scheme_protocol`] 에 건다.
///
/// 비동기 쪽을 쓰는 이유는 하나다. 렌더가 13–29ms 인데 동기 핸들러는 그 시간만큼 웹뷰를
/// 통째로 멈춰 세운다 — 페이지 열 장을 스크롤하면 0.3초가 그대로 끊김으로 보인다.
pub fn serve(pdf: PdfThread, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    if request.method() != Method::GET {
        responder.respond(error_response(
            StatusCode::METHOD_NOT_ALLOWED,
            &tr!("GET 만 받습니다.", "Only GET is accepted."),
        ));
        return;
    }

    let page = match parse_page_uri(request.uri()) {
        Ok(page) => page,
        Err(bad) => {
            responder.respond(error_response(StatusCode::BAD_REQUEST, &bad.to_string()));
            return;
        }
    };

    // 여기부터는 기다림이다. 핸들러가 불린 스레드를 붙잡고 있지 않도록 블로킹 풀로 넘긴다.
    let rendering = tauri::async_runtime::spawn_blocking(move || {
        // PDFium 스레드는 그리기만 하고, PNG 인코딩은 이 블로킹 풀 스레드에서 한다 — 여러 쪽의
        // 인코딩이 서로, 그리고 다음 쪽 그리기와 겹쳐 돈다.
        let response = match pdf
            .render_raw_blocking(page.doc_id, page.page, page.width, page.tile)
            .and_then(|image| image.encode_png_fast())
        {
            Ok(png) => png_response(png),
            Err(err) => error_response(status_for(&err), &err.to_string()),
        };

        responder.respond(response);
    });

    // 핸들을 떨어뜨려도 블로킹 작업은 취소되지 않고 끝까지 돈다. 답은 `responder` 로 가므로
    // 여기서 기다릴 것이 없다.
    drop(rendering);
}

/// URL 하나를 요청으로 옮긴다. 문서도 PDFium 도 필요 없는 순수 함수다 — 경계에서 틀릴 수
/// 있는 것(0-기반, 폭 상한, 조각 수)이 전부 여기 모여 있으므로 여기만 단위 테스트하면 된다.
pub fn parse_page_uri(uri: &Uri) -> Result<PageRequest, BadRequest> {
    let segments = path_segments(uri);

    let [kind, doc_id, page] = segments.as_slice() else {
        return Err(BadRequest::NotAPagePath);
    };

    if *kind != "page" {
        return Err(BadRequest::NotAPagePath);
    }

    // 소문자만 받는다. `doc_id` 를 만드는 쪽(`engine::hex12` 의 `{byte:02x}`)은 소문자만
    // 내놓으므로 대문자 id 는 어느 문서도 가리키지 않는다. `is_ascii_hexdigit` 으로 느슨하게
    // 받아 주면 그 요청이 검사를 통과해 캐시까지 갔다가 404 가 되는데, "그런 문서는 없다"
    // 보다 "그건 id 모양이 아니다" 가 참이다. 검사하는 쪽이 만드는 쪽보다 넓으면 그 틈은
    // 언제나 엉뚱한 오류로 새어 나온다.
    if doc_id.len() != DOC_ID_LEN
        || !doc_id
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    {
        return Err(BadRequest::BadDocId);
    }

    // 0-기반이므로 음수는 곧 형식 오류다. 범위의 위쪽 끝은 문서를 봐야 알 수 있어서 여기서
    // 보지 않고 렌더 쪽이 404 로 답한다.
    let page: i32 = page.parse().map_err(|_| BadRequest::BadPage)?;
    if page < 0 {
        return Err(BadRequest::BadPage);
    }

    let tile = parse_tile(uri.query())?;
    let width = parse_width(uri.query(), if tile.is_some() { MAX_TILE_PAGE_WIDTH } else { MAX_RENDER_WIDTH })?;
    Ok(PageRequest {
        doc_id: (*doc_id).to_string(),
        page,
        width,
        tile,
    })
}

/// 타일 질의(`x`·`y`·`tw`·`th`). 넷 중 하나도 없으면 쪽 전체이고, 일부만 있으면 형식 오류다.
fn parse_tile(query: Option<&str>) -> Result<Option<TileRect>, BadRequest> {
    let value = |key: &str| {
        query.and_then(|query| {
            query
                .split('&')
                .find_map(|pair| pair.strip_prefix(key).and_then(|rest| rest.strip_prefix('=')))
        })
    };
    let parts = [value("x"), value("y"), value("tw"), value("th")];
    if parts.iter().all(Option::is_none) {
        return Ok(None);
    }
    let mut numbers = [0u32; 4];
    for (slot, part) in numbers.iter_mut().zip(parts) {
        *slot = part.ok_or(BadRequest::BadWidth)?.parse().map_err(|_| BadRequest::BadWidth)?;
    }
    let [x, y, width, height] = numbers;
    if width == 0 || height == 0 || width > MAX_TILE_SIDE || height > MAX_TILE_SIDE {
        return Err(BadRequest::BadWidth);
    }
    Ok(Some(TileRect { x, y, width, height }))
}

/// `w` 를 읽고 상한 안인지 본다.
///
/// 상한이 없으면 `w=2000000` 하나로 프로세스를 메모리 부족으로 죽일 수 있다. 다만 이 검사는
/// 절반이다 — 출력 높이는 페이지 비율에서 나오므로 폭이 범위 안이어도 결과가 클 수 있고,
/// 그쪽은 페이지 크기를 아는 엔진(`MAX_RENDER_PIXELS`)이 본다. 여기서 못 거른 요청은
/// [`PdfRenderError::OutputTooLarge`] 로 돌아와 역시 400 이 된다.
fn parse_width(query: Option<&str>, max: u32) -> Result<u32, BadRequest> {
    let raw = query
        .and_then(|query| query.split('&').find_map(|pair| pair.strip_prefix("w=")))
        .ok_or(BadRequest::MissingWidth)?;

    let width: u32 = raw.parse().map_err(|_| BadRequest::BadWidth)?;

    if !(MIN_RENDER_WIDTH..=max).contains(&width) {
        return Err(BadRequest::BadWidth);
    }

    Ok(width)
}

/// 같은 URL 이 플랫폼마다 다른 모양으로 도착한다.
///
/// ```text
/// http://iwae.localhost/page/<doc_id>/<page>   Windows·Android
/// iwae://localhost/page/<doc_id>/<page>        macOS·Linux
/// iwae://page/<doc_id>/<page>                  호스트 자리에 첫 조각이 들어간 모양
/// ```
///
/// 셋을 같게 읽으려고, `localhost` 가 아닌 호스트는 경로의 첫 조각으로 친다.
fn path_segments(uri: &Uri) -> Vec<&str> {
    let mut segments = Vec::with_capacity(4);

    if let Some(host) = uri.host() {
        if host != "localhost" && !host.ends_with(".localhost") {
            segments.push(host);
        }
    }

    segments.extend(uri.path().split('/').filter(|segment| !segment.is_empty()));
    segments
}

/// 렌더 오류를 상태 코드로 옮긴다.
fn status_for(err: &PdfRenderError) -> StatusCode {
    match err {
        // 열려 있지 않은 문서도, 없는 페이지도 "그런 자원이 없다" 이다. 둘을 구분해 주면
        // 웹뷰가 어떤 doc_id 가 열려 있는지 캐묻는 도구가 된다.
        PdfRenderError::UnknownDocument | PdfRenderError::PageOutOfRange { .. } => {
            StatusCode::NOT_FOUND
        }
        // 둘 다 "요청한 폭이 이 페이지에는 과하다" 이므로 400 이다. 문서가 깨진 것이 아니라
        // 더 작은 `w` 로 다시 부르면 되는 일이라 500 이 아니다.
        PdfRenderError::WidthOutOfRange(_)
        | PdfRenderError::OutputTooLarge { .. }
        | PdfRenderError::CropOutOfRange => StatusCode::BAD_REQUEST,
        PdfRenderError::Failed(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

fn png_response(png: Vec<u8>) -> Response<Vec<u8>> {
    build_response(StatusCode::OK, "image/png", PAGE_CACHE_CONTROL, png)
}

fn error_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    build_response(
        status,
        "text/plain; charset=utf-8",
        ERROR_CACHE_CONTROL,
        message.as_bytes().to_vec(),
    )
}

/// `Response::builder()` 를 쓰지 않는 이유: 그쪽은 `Result` 를 돌려주고, 여기서 풀면 웹뷰
/// 요청이 닿는 자리에 `unwrap` 이 생긴다. 직접 조립하면 실패할 자리가 없다.
fn build_response(
    status: StatusCode,
    content_type: &'static str,
    cache_control: &'static str,
    body: Vec<u8>,
) -> Response<Vec<u8>> {
    let mut response = Response::new(body);
    *response.status_mut() = status;

    let headers = response.headers_mut();
    // 둘 다 이 파일 안의 상수 문자열이라 헤더 값으로 항상 유효하다.
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(cache_control),
    );
    // 앱 화면과 출처가 달라 fetch 로 읽으려면 필요하다. 이 프로토콜은 앱 웹뷰 안에서만 닿는다.
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );

    response
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(url: &str) -> Result<PageRequest, BadRequest> {
        let uri: Uri = url.parse().expect("테스트 URL 은 파싱되어야 한다");
        parse_page_uri(&uri)
    }

    const ID: &str = "0123456789ab";

    #[test]
    fn a_well_formed_url_yields_the_request() {
        assert_eq!(
            parse("iwae://page/0123456789ab/7?w=1400"),
            Ok(PageRequest {
                doc_id: ID.to_string(),
                page: 7,
                width: 1400,
                tile: None,
            })
        );
    }

    /// 타일은 넷이 다 있어야 하고, 타일일 때만 쪽 폭이 쪽 전체 상한을 넘을 수 있다.
    #[test]
    fn a_tile_url_yields_a_tile_request() {
        assert_eq!(
            parse("iwae://page/0123456789ab/3?w=12000&x=2048&y=1024&tw=1024&th=1024").map(|r| (r.width, r.tile)),
            Ok((12000, Some(TileRect { x: 2048, y: 1024, width: 1024, height: 1024 })))
        );
        assert_eq!(parse("iwae://page/0123456789ab/3?w=12000"), Err(BadRequest::BadWidth));
        assert_eq!(parse("iwae://page/0123456789ab/3?w=1200&x=0&y=0&tw=1024"), Err(BadRequest::BadWidth));
        assert_eq!(parse("iwae://page/0123456789ab/3?w=1200&x=0&y=0&tw=4096&th=10"), Err(BadRequest::BadWidth));
    }

    /// 플랫폼마다 다른 세 모양이 같은 요청으로 읽혀야 한다. 하나라도 빠지면 그 OS 에서만
    /// 페이지가 통째로 안 뜬다.
    #[test]
    fn all_three_platform_shapes_read_the_same() {
        let expected = Ok(PageRequest {
            doc_id: ID.to_string(),
            page: 7,
            width: 1400,
            tile: None,
        });

        assert_eq!(parse("iwae://page/0123456789ab/7?w=1400"), expected);
        assert_eq!(
            parse("iwae://localhost/page/0123456789ab/7?w=1400"),
            expected
        );
        assert_eq!(
            parse("http://iwae.localhost/page/0123456789ab/7?w=1400"),
            expected
        );
    }

    /// 0-기반이다. 첫 페이지는 0 이고, 1 은 두 번째 페이지다 — 여기가 어긋나면 문서 전체가
    /// 한 장씩 밀린 채로 보인다.
    #[test]
    fn pages_are_zero_based_at_both_ends() {
        assert_eq!(
            parse("iwae://page/0123456789ab/0?w=800").map(|r| r.page),
            Ok(0)
        );
        assert_eq!(
            parse("iwae://page/0123456789ab/4999?w=800").map(|r| r.page),
            Ok(4999)
        );
        // 음수는 0-기반에서 존재할 수 없는 자리라 형식 오류로 자른다.
        assert_eq!(
            parse("iwae://page/0123456789ab/-1?w=800"),
            Err(BadRequest::BadPage)
        );
    }

    #[test]
    fn a_non_numeric_page_is_rejected() {
        assert_eq!(
            parse("iwae://page/0123456789ab/seven?w=800"),
            Err(BadRequest::BadPage)
        );
        // i32 를 넘기면 페이지 번호가 아니다.
        assert_eq!(
            parse("iwae://page/0123456789ab/99999999999?w=800"),
            Err(BadRequest::BadPage)
        );
    }

    #[test]
    fn width_must_be_present_and_inside_the_bounds() {
        assert_eq!(
            parse("iwae://page/0123456789ab/0"),
            Err(BadRequest::MissingWidth)
        );
        assert_eq!(
            parse("iwae://page/0123456789ab/0?h=800"),
            Err(BadRequest::MissingWidth)
        );
        assert_eq!(
            parse("iwae://page/0123456789ab/0?w=abc"),
            Err(BadRequest::BadWidth)
        );
        assert_eq!(
            parse("iwae://page/0123456789ab/0?w=0"),
            Err(BadRequest::BadWidth)
        );

        // 이 하나가 이 파일이 있는 이유다. 상한이 없으면 PDFium 이 2,000,000px 짜리
        // 비트맵을 할당하려다 프로세스를 태운다.
        assert_eq!(
            parse("iwae://page/0123456789ab/0?w=2000000"),
            Err(BadRequest::BadWidth)
        );
        // u32 조차 넘는 값도 패닉이 아니라 400 이어야 한다.
        assert_eq!(
            parse("iwae://page/0123456789ab/0?w=99999999999999999999"),
            Err(BadRequest::BadWidth)
        );

        // 경계는 통과한다.
        assert_eq!(
            parse(&format!("iwae://page/{ID}/0?w={MIN_RENDER_WIDTH}")).map(|r| r.width),
            Ok(MIN_RENDER_WIDTH)
        );
        assert_eq!(
            parse(&format!("iwae://page/{ID}/0?w={MAX_RENDER_WIDTH}")).map(|r| r.width),
            Ok(MAX_RENDER_WIDTH)
        );
    }

    #[test]
    fn a_width_among_other_query_parameters_is_found() {
        assert_eq!(
            parse("iwae://page/0123456789ab/0?v=2&w=1200").map(|r| r.width),
            Ok(1200)
        );
    }

    #[test]
    fn a_malformed_doc_id_is_rejected() {
        // 짧다
        assert_eq!(parse("iwae://page/abc/0?w=800"), Err(BadRequest::BadDocId));
        // 16진수가 아니다
        assert_eq!(
            parse("iwae://page/zzzzzzzzzzzz/0?w=800"),
            Err(BadRequest::BadDocId)
        );
        // 길다
        assert_eq!(
            parse("iwae://page/0123456789abcd/0?w=800"),
            Err(BadRequest::BadDocId)
        );
        // 대문자는 만드는 쪽이 내놓지 않는 모양이다. 받아 주면 캐시를 빗나가 404 가 되는데,
        // 없는 문서가 아니라 틀린 id 이므로 400 이어야 한다.
        assert_eq!(
            parse("iwae://page/0123456789AB/0?w=800"),
            Err(BadRequest::BadDocId)
        );
        assert_eq!(
            parse("iwae://page/ABCDEF012345/0?w=800"),
            Err(BadRequest::BadDocId)
        );
    }

    /// 검사기가 받는 모양과 만드는 쪽이 내놓는 모양이 같아야 한다. 이 둘이 어긋나면
    /// 어긋난 만큼이 오답으로 샌다.
    #[test]
    fn every_id_the_generator_can_emit_is_accepted() {
        // `engine::hex12` 는 `{byte:02x}` 로 6바이트를 찍는다 — 0-9a-f 뿐이다.
        for byte in 0u8..=255 {
            let id = format!("{byte:02x}").repeat(6);
            assert!(
                parse(&format!("iwae://page/{id}/0?w=800")).is_ok(),
                "생성기가 낼 수 있는 id 는 통과해야 한다: {id}"
            );
        }
    }

    #[test]
    fn anything_that_is_not_a_three_segment_page_path_is_rejected() {
        assert_eq!(
            parse("iwae://page/0123456789ab?w=800"),
            Err(BadRequest::NotAPagePath)
        );
        assert_eq!(
            parse("iwae://page/0123456789ab/0/extra?w=800"),
            Err(BadRequest::NotAPagePath)
        );
        assert_eq!(
            parse("iwae://thumb/0123456789ab/0?w=800"),
            Err(BadRequest::NotAPagePath)
        );
        assert_eq!(
            parse("iwae://localhost/?w=800"),
            Err(BadRequest::NotAPagePath)
        );
    }

    /// 경로 조각으로 캐시 밖의 무언가를 가리키려는 시도는 doc_id 검사에서 먼저 죽는다.
    #[test]
    fn path_traversal_never_reaches_the_renderer() {
        assert!(parse("iwae://page/..%2f..%2fetc/0?w=800").is_err());
        assert!(parse("iwae://page/../../../secret.pdf/0?w=800").is_err());
        assert!(parse("iwae://page/C:%5Cwindows%5Cx.pdf/0?w=800").is_err());
    }

    /// 열려 있지 않은 문서는 404 다. 이것이 이 프로토콜의 보안 경계 전부다 — 여기가 404 가
    /// 아니라 "열어 준다" 가 되는 순간 웹뷰가 임의 경로의 PDF 를 읽을 수 있게 된다.
    #[test]
    fn an_unknown_document_is_a_404() {
        assert_eq!(
            status_for(&PdfRenderError::UnknownDocument),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            status_for(&PdfRenderError::PageOutOfRange {
                page: 9,
                page_count: 2
            }),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            status_for(&PdfRenderError::WidthOutOfRange(999_999)),
            StatusCode::BAD_REQUEST
        );
        // 폭은 범위 안이지만 페이지가 너무 길어 출력이 상한을 넘는 경우도 400 이다 —
        // 더 작은 w 로 다시 부르면 되는 일이지 문서가 깨진 것이 아니다.
        assert_eq!(
            status_for(&PdfRenderError::OutputTooLarge {
                width: 3000,
                height: 30_000
            }),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            status_for(&PdfRenderError::Failed("깨졌다".into())),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn a_page_response_carries_png_headers_and_a_long_cache() {
        let response = png_response(vec![0x89, b'P', b'N', b'G']);

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "image/png");
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            PAGE_CACHE_CONTROL
        );
    }

    /// 앱 화면(tauri.localhost)과 출처가 달라서, 이 헤더가 없으면 fetch 로 쪽 그림을 읽을 수 없다.
    /// 근거 묶음 내보내기가 그림을 캔버스에 그리려면 fetch 가 필요하다.
    #[test]
    fn a_page_response_can_be_fetched_from_the_app_origin() {
        let response = png_response(vec![0x89, b'P', b'N', b'G']);

        assert_eq!(response.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
    }

    /// 404 가 브라우저 캐시에 굳으면 문서를 연 뒤에도 페이지가 뜨지 않는다.
    #[test]
    fn an_error_response_is_never_cached() {
        let response = error_response(StatusCode::NOT_FOUND, "없다");

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    }
}
