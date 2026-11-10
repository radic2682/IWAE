//! 웹뷰가 앱 화면 밖으로 가지 못하게 막는 문지기.
//!
//! 앱 화면은 앱 안의 주소(`tauri://localhost`·`http(s)://tauri.localhost`·개발 중의 Vite 주소)와 쪽 그림용
//! `iwae:` 프로토콜만 쓴다. 가운데 클릭·`location.href`·끌어 놓은 링크가 웹뷰를 외부 페이지로 보내면 그
//! 페이지는 앱의 IPC 를 만질 수 있는 창 안에서 돌게 되므로, 그 밖의 주소로 가는 이동은 여기서 끊는다.
//! (새 창 요청은 `on_new_window` 핸들러를 달지 않아 wry 가 이미 거절한다.) 바깥 링크는 앱이 확인 창을 거쳐
//! 시스템 브라우저로 연다.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::Manager;
use tauri::{Runtime, Url};

/// `dev_url` 은 개발 중(`tauri dev`)에만 Some
pub fn navigation_allowed(url: &Url, dev_url: Option<&Url>) -> bool {
    match url.scheme() {
        // 앱 자체·쪽 그림 프로토콜·빈 문서·페이지 안에서 만든 주소
        "tauri" | "iwae" | "about" | "blob" | "data" => true,
        "http" | "https" => {
            let host = url.host_str().unwrap_or("");
            if matches!(host, "tauri.localhost" | "iwae.localhost" | "ipc.localhost") {
                return true;
            }
            dev_url.is_some_and(|dev| {
                dev.scheme() == url.scheme()
                    && dev.host_str() == url.host_str()
                    && dev.port_or_known_default() == url.port_or_known_default()
            })
        }
        _ => false,
    }
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("iwae-nav-guard")
        .on_navigation(|webview, url| {
            let dev = if tauri::is_dev() {
                webview.app_handle().config().build.dev_url.clone()
            } else {
                None
            };
            let allowed = navigation_allowed(url, dev.as_ref());
            if !allowed {
                log::warn!("blocked webview navigation to {}://", url.scheme());
            }
            allowed
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn app_origins_and_custom_protocols_are_allowed() {
        let dev = url("http://localhost:5174/");
        for ok in [
            "tauri://localhost/index.html",
            "http://tauri.localhost/index.html?x=1",
            "https://tauri.localhost/",
            "http://iwae.localhost/page/abc/1",
            "iwae://localhost/page/abc/1",
            "about:blank",
            "http://localhost:5174/index.html?kind=detached",
        ] {
            assert!(navigation_allowed(&url(ok), Some(&dev)), "{ok}");
        }
        // 개발 주소는 개발 중에만
        assert!(!navigation_allowed(&url("http://localhost:5174/"), None));
    }

    #[test]
    fn everything_else_is_blocked() {
        let dev = url("http://localhost:5174/");
        for bad in [
            "https://example.com/",
            "http://evil.example/tauri.localhost",
            "http://tauri.localhost.evil.example/",
            "http://localhost:9999/",
            "http://127.0.0.1:5174/",
            "file:///C:/Windows/win.ini",
            "ftp://example.com/",
            "javascript:alert(1)",
        ] {
            assert!(!navigation_allowed(&url(bad), Some(&dev)), "{bad}");
        }
    }
}
