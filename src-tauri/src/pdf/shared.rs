//! 쪽 그림을 **압축 없이** 웹뷰에 넘기는 길(Windows WebView2 SharedBuffer).
//!
//! 커스텀 프로토콜(`iwae://page`)은 그림을 PNG 로 압축하고 웹뷰가 다시 풀어야 한다 — 쪽마다
//! 수십 ms. 압축하지 않은 BMP 로 같은 길을 쓰면 16MB 를 넘기는 데만 200ms 가 넘었다.
//! Chrome PDF 뷰어처럼 그린 비트맵을 그대로 쓰려면 복사 없이 넘겨야 하고, WebView2 의 공유
//! 메모리가 그것이다: 여기서 한 번 memcpy 한 버퍼를 스크립트가 ArrayBuffer 로 바로 본다.
//!
//! 순서: 화면이 `pdf_render_shared` 를 부른다 → PDFium 스레드가 RGBA 로 그린다 → 공유 버퍼를
//! 만들어 채우고 `PostSharedBufferToScript` 로 보낸다(곁들인 JSON 에 요청 id·크기) → 스크립트의
//! `sharedbufferreceived` 가 받아 ImageData 로 캔버스에 그린 뒤 버퍼를 놓는다.

use tauri::{State, WebviewWindow};

use super::{PdfThread, TileRect};

/// 쪽(또는 타일) 하나를 그려 공유 메모리로 보낸다. 그림은 `sharedbufferreceived` 로 따로 온다.
/// 공유 메모리를 쓸 수 없는 환경이면 오류를 돌려주고, 화면은 PNG 길로 돌아간다.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn pdf_render_shared(
    window: WebviewWindow,
    state: State<'_, PdfThread>,
    request_id: u64,
    doc_id: String,
    page: i32,
    width: u32,
    tile: Option<[u32; 4]>,
) -> Result<(), String> {
    let pdf = state.inner().clone();
    let tile = tile.map(|[x, y, w, h]| TileRect { x, y, width: w, height: h });
    let image = tauri::async_runtime::spawn_blocking(move || pdf.render_raw_blocking(doc_id, page, width, tile))
        .await
        .map_err(|err| tr!("쪽 그리기 작업이 중단되었습니다: {err}", "Page rendering task was interrupted: {err}"))?
        .map_err(|err| err.to_string())?;
    post(&window, request_id, image.width, image.height, image.rgba)
}

#[cfg(windows)]
fn post(window: &WebviewWindow, request_id: u64, width: u32, height: u32, rgba: Vec<u8>) -> Result<(), String> {
    use std::sync::mpsc::channel;

    let (done, wait) = channel::<Result<(), String>>();
    window
        .with_webview(move |webview| {
            let result = unsafe { post_on_main(&webview, request_id, width, height, &rgba) };
            let _ = done.send(result);
        })
        // 영어 글에도 "WebView2" 를 넣는다: 프런트엔드(sharedPage.ts)가 이 낱말로 PNG 길로 돌린다.
        .map_err(|err| tr!("웹뷰에 닿지 못했습니다: {err}", "Could not reach the WebView2: {err}"))?;
    wait.recv().map_err(|_| tr!("웹뷰가 답하지 않았습니다.", "The WebView2 did not respond."))?
}

#[cfg(windows)]
unsafe fn post_on_main(
    webview: &tauri::webview::PlatformWebview,
    request_id: u64,
    width: u32,
    height: u32,
    rgba: &[u8],
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment12, ICoreWebView2_17, COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY,
    };
    use windows_core::{Interface, HSTRING, PCWSTR};

    let fail = |what: &str, err: windows_core::Error| format!("{what}: {err}");
    let environment: ICoreWebView2Environment12 = webview
        .environment()
        .cast()
        .map_err(|err| fail(&tr!("공유 메모리를 지원하지 않는 WebView2 입니다", "This WebView2 does not support shared memory"), err))?;
    let buffer = environment
        .CreateSharedBuffer(rgba.len() as u64)
        .map_err(|err| fail(&tr!("공유 메모리를 만들지 못했습니다", "Could not create WebView2 shared memory"), err))?;
    let mut target: *mut u8 = std::ptr::null_mut();
    buffer
        .Buffer(&mut target)
        .map_err(|err| fail(&tr!("공유 메모리를 열지 못했습니다", "Could not open WebView2 shared memory"), err))?;
    if target.is_null() {
        return Err(tr!("공유 메모리 주소가 비었습니다.", "WebView2 shared memory address is empty."));
    }
    std::ptr::copy_nonoverlapping(rgba.as_ptr(), target, rgba.len());

    let core: ICoreWebView2_17 = webview
        .controller()
        .CoreWebView2()
        .and_then(|core| core.cast())
        .map_err(|err| fail(&tr!("웹뷰를 찾지 못했습니다", "Could not find the WebView2"), err))?;
    let meta = HSTRING::from(format!(
        "{{\"kind\":\"iwae-page\",\"requestId\":{request_id},\"width\":{width},\"height\":{height}}}"
    ));
    core.PostSharedBufferToScript(&buffer, COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY, PCWSTR(meta.as_ptr()))
        .map_err(|err| fail(&tr!("공유 메모리를 보내지 못했습니다", "Could not send WebView2 shared memory"), err))
    // 여기서 버퍼 참조를 놓아도 스크립트가 releaseBuffer 할 때까지 메모리는 산다.
}

#[cfg(not(windows))]
fn post(_window: &WebviewWindow, _request_id: u64, _width: u32, _height: u32, _rgba: Vec<u8>) -> Result<(), String> {
    Err(tr!("공유 메모리 전달은 Windows 에서만 됩니다.", "WebView2 shared memory transfer only works on Windows."))
}
