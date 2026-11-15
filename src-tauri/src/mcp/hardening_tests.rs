//! 로컬 MCP 서버를 일부러 괴롭히는 회귀 시험: 거대한 Content-Length, 멈춘 클라이언트, 비 ASCII 헤더.
use super::*;
use crate::rag::store::{DocumentInfo, SearchHit};
use rpc::{Annotation, LocationRequest};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

struct Fake;

impl ToolContext for Fake {
    fn search(&self, _q: &str, _l: Option<usize>, _k: Option<&str>) -> Result<Vec<SearchHit>, String> {
        Ok(vec![])
    }
    fn documents(&self, _k: Option<&str>) -> Result<Vec<DocumentInfo>, String> {
        Ok(vec![])
    }
    fn page_text(&self, _d: &str, _p: usize) -> Result<Option<(String, usize, String)>, String> {
        Ok(None)
    }
    fn annotations(&self, _d: Option<&str>) -> Result<Vec<Annotation>, String> {
        Ok(vec![])
    }
    fn show_location(&self, _l: LocationRequest) -> Result<(), String> {
        Ok(())
    }
}

fn token() -> String {
    "e".repeat(64)
}

fn send(port: u16, raw: &[u8], timeout: Duration) -> Result<String, String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(timeout)).unwrap();
    stream.write_all(raw).map_err(|e| e.to_string())?;
    let mut response = Vec::new();
    match stream.read_to_end(&mut response) {
        Ok(_) => Ok(String::from_utf8_lossy(&response).into_owned()),
        Err(e) if !response.is_empty() => Ok(String::from_utf8_lossy(&response).into_owned() + &format!("<<{e}>>")),
        Err(e) => Err(format!("read error: {e}")),
    }
}

fn ping_request(port: u16) -> Vec<u8> {
    let body = br#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
    let mut raw = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nAuthorization: Bearer {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        token(),
        body.len()
    )
    .into_bytes();
    raw.extend_from_slice(body);
    raw
}

fn assert_serving(port: u16) {
    let started = Instant::now();
    let answer = send(port, &ping_request(port), Duration::from_secs(5)).expect("server answered");
    assert!(answer.starts_with("HTTP/1.1 200"), "server stopped serving: {answer}");
    assert!(started.elapsed() < Duration::from_secs(2), "answer was slow: {:?}", started.elapsed());
}

#[test]
fn a_huge_declared_length_without_a_token_is_rejected_and_the_server_keeps_serving() {
    let server = start(0, token(), Arc::new(Fake), "t".into()).unwrap();
    let port = server.port;
    for declared in ["1000000000000", "9223372036854775807", "18446744073709551615"] {
        let raw = format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: {declared}\r\n\r\nxx");
        let answer = send(port, raw.as_bytes(), Duration::from_secs(5));
        if let Ok(answer) = answer {
            assert!(answer.starts_with("HTTP/1.1 401") || answer.starts_with("HTTP/1.1 400") || answer.is_empty(), "{answer}");
        }
        assert_serving(port);
    }
}

#[test]
fn a_huge_declared_length_with_a_token_is_413_and_the_server_keeps_serving() {
    let server = start(0, token(), Arc::new(Fake), "t".into()).unwrap();
    let port = server.port;
    let raw = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {}\r\nContent-Length: 1000000000000\r\n\r\n{{",
        token()
    );
    let answer = send(port, raw.as_bytes(), Duration::from_secs(5)).unwrap();
    assert!(answer.starts_with("HTTP/1.1 413"), "{answer}");
    assert_serving(port);
}

#[test]
fn a_client_that_stalls_mid_body_does_not_block_other_clients() {
    let server = start(0, token(), Arc::new(Fake), "t".into()).unwrap();
    let port = server.port;
    let mut unauthenticated = TcpStream::connect(("127.0.0.1", port)).unwrap();
    write!(unauthenticated, "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 100000\r\n\r\n").unwrap();
    let mut authenticated = TcpStream::connect(("127.0.0.1", port)).unwrap();
    write!(
        authenticated,
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {}\r\nContent-Length: 100000\r\n\r\n{{",
        token()
    )
    .unwrap();
    std::thread::sleep(Duration::from_millis(300));
    assert_serving(port);
    assert_serving(port);
    drop(unauthenticated);
    drop(authenticated);
}

#[test]
fn a_non_ascii_header_gets_a_400_instead_of_a_silent_close() {
    let server = start(0, token(), Arc::new(Fake), "t".into()).unwrap();
    let port = server.port;
    let raw = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {}\r\nX-Kor: 한글\r\nContent-Length: 2\r\n\r\n{{}}",
        token()
    );
    let answer = send(port, raw.as_bytes(), Duration::from_secs(5)).unwrap();
    assert!(answer.starts_with("HTTP/1.1 400"), "{answer}");
    assert_serving(port);
}
