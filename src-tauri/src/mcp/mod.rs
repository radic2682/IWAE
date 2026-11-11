//! 바깥 AI(Claude Code 등)가 붙는 로컬 MCP 서버.
//!
//! `127.0.0.1` 에서만 받고, 앱이 켜져 있을 때만 돈다. 요청 하나하나는 [`http::check_request`]
//! 를 지나야 [`rpc::handle`] 에 닿는다.

pub mod app_tools;
pub mod canvas_tools;
pub mod guide;
pub mod limits;
pub mod memo_tools;
pub mod page_tools;
pub mod http;
pub mod rpc;
pub mod webview_call;

use std::io::Read;
use std::sync::Arc;
use std::thread::JoinHandle;

use rpc::{Outcome, ToolContext};

pub struct ServerHandle {
    server: Arc<tiny_http::Server>,
    thread: Option<JoinHandle<()>>,
    pub port: u16,
}

impl ServerHandle {
    pub fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        self.server.unblock();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for ServerHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn json_header() -> tiny_http::Header {
    tiny_http::Header::from_bytes(
        &b"Content-Type"[..],
        &b"application/json; charset=utf-8"[..],
    )
    .expect("고정 헤더")
}

/// 요청 본문을 글자로. JSON 은 UTF-8 이어야 하지만, Windows PowerShell 5.1 의
/// `Invoke-RestMethod -Body "<문자열>"` 처럼 시스템 코드 페이지(한국어 Windows 는 CP949)로
/// 보내는 클라이언트가 흔하다. 그대로 UTF-8 로 읽으면 한글이 �� 로 깨져 화면에 남는다.
/// UTF-8 로 읽히지 않으면 CP949 로 한 번 더 읽어 본다.
fn decode_body(body: &[u8]) -> std::borrow::Cow<'_, str> {
    if let Ok(text) = std::str::from_utf8(body) {
        return std::borrow::Cow::Borrowed(text);
    }
    let (text, _, had_errors) = encoding_rs::EUC_KR.decode(body);
    if had_errors {
        String::from_utf8_lossy(body)
    } else {
        text
    }
}

fn respond(request: tiny_http::Request, status: u16, body: String) {
    let response = tiny_http::Response::from_string(body)
        .with_status_code(status)
        .with_header(json_header());
    let _ = request.respond(response);
}

fn serve_one(mut request: tiny_http::Request, token: &str, ctx: &dyn ToolContext, version: &str, port: u16) {
    let headers: Vec<(String, String)> = request
        .headers()
        .iter()
        .map(|header| {
            (
                header.field.as_str().to_string(),
                header.value.as_str().to_string(),
            )
        })
        .collect();
    let method = request.method().as_str().to_uppercase();
    let url = request.url().to_string();
    let declared = request.body_length().unwrap_or(0);
    if let Err(rejection) = http::check_request(&method, &url, &headers, token, declared, port) {
        let body = serde_json::json!({ "error": rejection.reason }).to_string();
        respond(request, rejection.status, body);
        return;
    }
    // 길이를 밝히지 않은 본문도 상한까지만 읽는다.
    let mut body = Vec::new();
    let limit = (http::MAX_BODY_BYTES + 1) as u64;
    if request
        .as_reader()
        .take(limit)
        .read_to_end(&mut body)
        .is_err()
        || body.len() > http::MAX_BODY_BYTES
    {
        respond(
            request,
            413,
            serde_json::json!({ "error": "요청이 너무 큽니다." }).to_string(),
        );
        return;
    }
    let text = decode_body(&body);
    match rpc::handle(&text, ctx, version) {
        Outcome::Json(response) => respond(request, 200, response),
        Outcome::Accepted => {
            let _ = request.respond(tiny_http::Response::empty(202));
        }
    }
}

/// 서버를 띄운다. `port` 가 0 이면 운영체제가 빈 포트를 고른다(테스트용).
pub fn start(
    port: u16,
    token: String,
    ctx: Arc<dyn ToolContext + Send + Sync>,
    version: String,
) -> Result<ServerHandle, String> {
    let server = tiny_http::Server::http(("127.0.0.1", port)).map_err(|err| {
        tr!("{port} 포트를 열지 못했습니다(다른 프로그램이 쓰고 있을 수 있습니다): {err}", "Couldn't open port {port} (another program may be using it): {err}")
    })?;
    let bound = server
        .server_addr()
        .to_ip()
        .map(|addr| addr.port())
        .unwrap_or(port);
    let server = Arc::new(server);
    let worker = server.clone();
    let thread = std::thread::Builder::new()
        .name("iwae-mcp".into())
        .spawn(move || {
            for request in worker.incoming_requests() {
                serve_one(request, &token, ctx.as_ref(), &version, bound);
            }
        })
        .map_err(|err| tr!("MCP 서버 스레드를 만들지 못했습니다: {err}", "Couldn't start the MCP server thread: {err}"))?;
    Ok(ServerHandle {
        server,
        thread: Some(thread),
        port: bound,
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_cp949_body_is_read_as_korean() {
        let (bytes, _, _) = encoding_rs::EUC_KR.encode("{\"note\":\"동적 주소\"}");
        assert_eq!(super::decode_body(&bytes), "{\"note\":\"동적 주소\"}");
        assert_eq!(super::decode_body("한글".as_bytes()), "한글");
    }

    use super::*;
    use crate::rag::store::{DocumentInfo, SearchHit};
    use rpc::{Annotation, LocationRequest};
    use std::io::Write;
    use std::net::TcpStream;
    use std::sync::Mutex;

    #[derive(Default)]
    struct Fake {
        shown: Mutex<Vec<LocationRequest>>,
    }

    impl ToolContext for Fake {
        fn search(
            &self,
            _q: &str,
            _l: Option<usize>,
            _k: Option<&str>,
        ) -> Result<Vec<SearchHit>, String> {
            Ok(vec![])
        }
        fn documents(&self, _k: Option<&str>) -> Result<Vec<DocumentInfo>, String> {
            Ok(vec![])
        }
        fn page_text(
            &self,
            doc_id: &str,
            page: usize,
        ) -> Result<Option<(String, usize, String)>, String> {
            Ok((doc_id == "d1" && page == 1).then(|| ("text".into(), 1, "논문".into())))
        }
        fn annotations(&self, _d: Option<&str>) -> Result<Vec<Annotation>, String> {
            Ok(vec![])
        }
        fn show_location(&self, location: LocationRequest) -> Result<(), String> {
            self.shown.lock().unwrap().push(location);
            Ok(())
        }
    }

    fn post(port: u16, headers: &str, body: &str) -> (u16, String) {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(
            stream,
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}",
            body.len()
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        let status = response.split_whitespace().nth(1).unwrap().parse().unwrap();
        let body = response.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
        (status, body)
    }

    #[test]
    fn serves_json_rpc_over_http_with_auth_and_origin_checks() {
        let fake = Arc::new(Fake::default());
        let token = "f".repeat(64);
        let server = start(0, token.clone(), fake.clone(), "test".into()).unwrap();
        let auth = format!("Authorization: Bearer {token}\r\n");

        let (status, body) = post(
            server.port,
            &auth,
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}"#,
        );
        assert_eq!(status, 200);
        assert!(
            body.contains("\"protocolVersion\":\"2025-06-18\""),
            "{body}"
        );

        let (status, _) = post(
            server.port,
            &auth,
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
        );
        assert_eq!(status, 202);

        let call = r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"show_location","arguments":{"doc_id":"d1","page":1}}}"#;
        assert_eq!(post(server.port, "", call).0, 401);
        assert_eq!(
            post(
                server.port,
                &format!("{auth}Origin: https://evil.example\r\n"),
                call
            )
            .0,
            403
        );
        // DNS 리바인딩: 올바른 토큰이어도 이 서버 주소가 아닌 Host 는 거절한다
        let mut stream = TcpStream::connect(("127.0.0.1", server.port)).unwrap();
        write!(
            stream,
            "POST /mcp HTTP/1.1\r\nHost: evil.example:{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{auth}\r\n{call}",
            server.port,
            call.len()
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 403"), "{response}");
        assert!(
            fake.shown.lock().unwrap().is_empty(),
            "거절된 요청은 도구를 부르지 않는다"
        );

        let (status, body) = post(server.port, &auth, call);
        assert_eq!(status, 200, "{body}");
        assert_eq!(fake.shown.lock().unwrap().len(), 1);
        server.stop();
    }

    #[test]
    fn a_busy_port_is_reported_not_panicked() {
        let first = start(0, "a".repeat(64), Arc::new(Fake::default()), "t".into()).unwrap();
        let error = start(
            first.port,
            "a".repeat(64),
            Arc::new(Fake::default()),
            "t".into(),
        )
        .err()
        .unwrap();
        assert!(error.contains("포트"), "{error}");
    }
}
