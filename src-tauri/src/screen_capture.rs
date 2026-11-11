//! 문제 보고에 붙일 화면 캡처. 창의 웹 화면을 WebView2 `CapturePreview` 로 PNG 로 받아
//! 클립보드에 그림으로 올린다(사용자가 GitHub 이슈 본문에 Ctrl+V 로 붙인다). 아무것도 자동으로 보내지 않는다.
//!
//! 클립보드에는 두 가지 모양으로 올린다: 등록 형식 "PNG"(브라우저·메신저가 투명도까지 받는다)와
//! CF_DIB(그림판 등 오래된 프로그램). 마지막 캡처는 여기 메모리에 두고, 「클립보드에 복사」는 그것을 다시 올린다.

use std::sync::Mutex;

use tauri::WebviewWindow;

static LAST_CAPTURE: Mutex<Option<Vec<u8>>> = Mutex::new(None);

/// 창 화면을 PNG 로 찍어 돌려준다(원본 바이트). 이 창에 떠 있는 내용 그대로이므로,
/// 보고 창 자신을 빼는 일은 화면(프런트엔드)이 찍기 직전에 숨겨서 한다.
#[tauri::command]
pub async fn capture_window_png(window: WebviewWindow) -> Result<tauri::ipc::Response, String> {
    let png = capture(&window).await?;
    *LAST_CAPTURE.lock().map_err(|_| "capture state poisoned".to_string())? = Some(png.clone());
    Ok(tauri::ipc::Response::new(png))
}

/// 마지막 캡처를 클립보드에 그림으로 올린다
#[tauri::command]
pub fn copy_capture_to_clipboard() -> Result<(), String> {
    let png = LAST_CAPTURE
        .lock()
        .map_err(|_| "capture state poisoned".to_string())?
        .clone()
        .ok_or_else(|| tr!("복사할 화면 캡처가 없습니다.", "There is no screen capture to copy."))?;
    put_on_clipboard(&png)
}

/// PNG → 위아래가 뒤집힌 32비트 BGRA DIB(헤더 40바이트 + 픽셀)
#[cfg_attr(not(windows), allow(dead_code))]
fn png_to_dib(png: &[u8]) -> Result<Vec<u8>, String> {
    let image = image::load_from_memory_with_format(png, image::ImageFormat::Png)
        .map_err(|err| tr!("캡처 그림을 읽지 못했습니다: {err}", "Could not read the capture image: {err}"))?
        .to_rgba8();
    let (width, height) = image.dimensions();
    let pixels = (width as usize) * (height as usize) * 4;
    let mut dib = Vec::with_capacity(40 + pixels);
    dib.extend_from_slice(&40u32.to_le_bytes()); // biSize
    dib.extend_from_slice(&(width as i32).to_le_bytes());
    dib.extend_from_slice(&(height as i32).to_le_bytes()); // 양수 = 아래에서 위로
    dib.extend_from_slice(&1u16.to_le_bytes()); // planes
    dib.extend_from_slice(&32u16.to_le_bytes()); // bit count
    dib.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB
    dib.extend_from_slice(&(pixels as u32).to_le_bytes());
    dib.extend_from_slice(&[0u8; 16]); // 해상도·팔레트
    for row in (0..height).rev() {
        for column in 0..width {
            let [r, g, b, a] = image.get_pixel(column, row).0;
            dib.extend_from_slice(&[b, g, r, a]);
        }
    }
    Ok(dib)
}

#[cfg(windows)]
async fn capture(window: &WebviewWindow) -> Result<Vec<u8>, String> {
    use std::sync::mpsc::channel;
    use std::time::Duration;

    let (done, wait) = channel::<Result<Vec<u8>, String>>();
    let sender = done.clone();
    window
        .with_webview(move |webview| {
            if let Err(message) = unsafe { start_capture(&webview, done) } {
                let _ = sender.send(Err(message));
            }
        })
        .map_err(|err| tr!("웹뷰에 닿지 못했습니다: {err}", "Could not reach the WebView2: {err}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        wait.recv_timeout(Duration::from_secs(15))
            .map_err(|_| tr!("화면을 찍는 데 너무 오래 걸렸습니다.", "Capturing the screen took too long."))?
    })
    .await
    .map_err(|err| err.to_string())?
}

#[cfg(windows)]
unsafe fn start_capture(
    webview: &tauri::webview::PlatformWebview,
    done: std::sync::mpsc::Sender<Result<Vec<u8>, String>>,
) -> Result<(), String> {
    use std::ffi::c_void;
    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
    use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
    use windows::Win32::System::Com::{IStream, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};

    let fail = |err: windows_core::Error| tr!("화면을 찍지 못했습니다: {err}", "Could not capture the screen: {err}");
    let core = webview.controller().CoreWebView2().map_err(fail)?;
    let stream: IStream = CreateStreamOnHGlobal(Default::default(), true).map_err(fail)?;
    let reader = stream.clone();
    let handler = CapturePreviewCompletedHandler::create(Box::new(move |result| {
        let bytes = result.map_err(fail).and_then(|()| {
            let mut stat = STATSTG::default();
            reader.Seek(0, STREAM_SEEK_SET, None).map_err(fail)?;
            reader.Stat(&mut stat, STATFLAG_NONAME).map_err(fail)?;
            let mut buffer = vec![0u8; stat.cbSize as usize];
            let mut read = 0u32;
            reader
                .Read(buffer.as_mut_ptr() as *mut c_void, buffer.len() as u32, Some(&mut read))
                .ok()
                .map_err(fail)?;
            buffer.truncate(read as usize);
            Ok(buffer)
        });
        let _ = done.send(bytes);
        Ok(())
    }));
    core.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stream, &handler).map_err(fail)
}

#[cfg(not(windows))]
async fn capture(_window: &WebviewWindow) -> Result<Vec<u8>, String> {
    Err(tr!("화면 캡처는 Windows 에서만 됩니다.", "Screen capture is only supported on Windows."))
}

#[cfg(windows)]
fn put_on_clipboard(png: &[u8]) -> Result<(), String> {
    use windows::core::w;
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    const CF_DIB: u32 = 8;
    let dib = png_to_dib(png)?;
    let fail = |err: windows_core::Error| tr!("클립보드에 넣지 못했습니다: {err}", "Could not copy to the clipboard: {err}");

    // 전역 메모리에 복사해 둔다(성공하면 소유권은 클립보드로 넘어간다)
    let make = |bytes: &[u8]| -> Result<HGLOBAL, String> {
        unsafe {
            let handle = GlobalAlloc(GMEM_MOVEABLE, bytes.len()).map_err(fail)?;
            let target = GlobalLock(handle) as *mut u8;
            if target.is_null() {
                let _ = GlobalFree(Some(handle));
                return Err(tr!("클립보드에 넣지 못했습니다: 메모리", "Could not copy to the clipboard: memory"));
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), target, bytes.len());
            let _ = GlobalUnlock(handle);
            Ok(handle)
        }
    };

    unsafe {
        // 다른 프로그램이 클립보드를 잡고 있으면 잠깐 기다렸다 다시 해 본다
        let mut opened = false;
        for _ in 0..10 {
            if OpenClipboard(None).is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        if !opened {
            return Err(tr!("클립보드가 다른 프로그램에서 쓰이는 중입니다.", "The clipboard is in use by another program."));
        }
        let result = (|| {
            EmptyClipboard().map_err(fail)?;
            let png_format = RegisterClipboardFormatW(w!("PNG"));
            let png_handle = make(png)?;
            if SetClipboardData(png_format, Some(HANDLE(png_handle.0))).is_err() {
                let _ = GlobalFree(Some(png_handle));
            }
            let dib_handle = make(&dib)?;
            if let Err(err) = SetClipboardData(CF_DIB, Some(HANDLE(dib_handle.0))) {
                let _ = GlobalFree(Some(dib_handle));
                return Err(fail(err));
            }
            Ok(())
        })();
        let _ = CloseClipboard();
        result
    }
}

#[cfg(not(windows))]
fn put_on_clipboard(_png: &[u8]) -> Result<(), String> {
    Err(tr!("화면 캡처는 Windows 에서만 됩니다.", "Screen capture is only supported on Windows."))
}

#[cfg(test)]
mod tests {
    use super::png_to_dib;

    #[test]
    fn dib_is_bottom_up_bgra() {
        let mut png = Vec::new();
        let mut img = image::RgbaImage::new(2, 2);
        img.put_pixel(0, 0, image::Rgba([1, 2, 3, 255])); // 위 왼쪽
        img.put_pixel(0, 1, image::Rgba([9, 8, 7, 255])); // 아래 왼쪽
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let dib = png_to_dib(&png).unwrap();
        assert_eq!(dib.len(), 40 + 16);
        assert_eq!(&dib[4..8], &2i32.to_le_bytes());
        // 첫 픽셀은 맨 아래 줄의 왼쪽: B G R A
        assert_eq!(&dib[40..44], &[7, 8, 9, 255]);
        assert_eq!(&dib[48..52], &[3, 2, 1, 255]);
    }
}
