//! WebView2 의 브라우저 단축키(Ctrl+P 인쇄 창·F5/Ctrl+R 새로고침·Ctrl+F 찾기 줄·개발자 도구·소스 보기 …)를 끈다.
//! 앱 단축키는 프런트엔드가 받으므로 이 기본 동작은 필요 없고, 사용자가 단축키를 바꿔 비게 되면
//! 인쇄 창이 화면을 얼리는 등 상태를 잃을 수 있다. 프런트엔드의 키 막이(core/nativeKeyGuard.ts)와 함께 쓰는 이중 방어.
//! 개발 빌드(debug_assertions)에서는 개발자 도구 때문에 켜 둔다.

#[cfg(windows)]
pub fn lock_browser_keys(window: &tauri::WebviewWindow) {
    if cfg!(debug_assertions) {
        return;
    }
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows_core::Interface;
    let _ = window.with_webview(|webview| unsafe {
        if let Ok(core) = webview.controller().CoreWebView2() {
            if let Ok(settings) = core.Settings() {
                if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
                    let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
                }
            }
        }
    });
}

#[cfg(not(windows))]
pub fn lock_browser_keys(_window: &tauri::WebviewWindow) {}
