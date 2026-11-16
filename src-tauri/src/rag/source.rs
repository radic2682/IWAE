//! 색인할 문서를 Vault 파일에서 읽는다.
//!
//! PDF 본문은 웹뷰가 이미 만들어 둔 검색 캐시(`.iwae/cache/search-text.json`)에서 가져온다 —
//! 거기에는 글자 층이 없는 스캔본의 OCR 결과까지 들어 있고, OCR 은 웹뷰에서만 돈다.
//! Markdown 은 파일을 직접 읽는다.

use std::path::{Path, PathBuf};

use serde::Deserialize;

#[derive(Debug, Clone, PartialEq)]
pub struct SourceDoc {
    pub id: String,
    /// `pdf`, `markdown`, `text`(txt·html·xml: 색인의 'other' 항목을 경로로 가려 부르는 이름표)
    pub kind: String,
    pub title: String,
    /// Vault 기준 상대 경로, 또는 외부 참조의 절대 경로.
    pub path: String,
    pub content_hash: Option<String>,
    /// 쪽마다의 본문. Markdown 은 한 쪽이다.
    pub pages: Vec<String>,
    /// OCR 이 아직 덜 끝났으면 false.
    pub complete: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexEntry {
    id: String,
    kind: String,
    storage: String,
    path: String,
    display_name: String,
    content_hash: Option<String>,
    #[serde(default)]
    missing: bool,
}

#[derive(Deserialize)]
struct IndexFile {
    entries: Vec<IndexEntry>,
}

#[derive(Deserialize)]
struct CachePage {
    page: usize,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheDocument {
    content_hash: Option<String>,
    pages: Vec<CachePage>,
    complete: bool,
}

#[derive(Deserialize)]
struct CacheFile {
    documents: std::collections::HashMap<String, CacheDocument>,
}

/// 검색 캐시에서 받아들이는 가장 큰 쪽 수(이보다 큰 쪽 번호는 깨진 값으로 보고 버린다)
const MAX_PDF_PAGES: usize = 100_000;

pub fn iwae_dir(root: &Path) -> PathBuf {
    root.join(".iwae")
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Vault 색인에 있는 PDF·Markdown·텍스트 문서를 읽는다. 읽을 수 없는 항목(사라진 파일, 아직 본문이
/// 없는 PDF)은 빠진다 — 다음 색인 때 다시 시도된다.
pub fn load_sources(root: &Path) -> Vec<SourceDoc> {
    let Some(index) = read_json::<IndexFile>(&iwae_dir(root).join("index.json")) else {
        return Vec::new();
    };
    let cache = read_json::<CacheFile>(&iwae_dir(root).join("cache").join("search-text.json"));

    let mut sources = Vec::new();
    for entry in index.entries {
        if entry.missing {
            continue;
        }
        // 색인 파일에는 txt·html·xml 이 'other' 로 적혀 있다. 여기서 "text" 로 바꿔 부른다(RAG·MCP 응답용 이름표, 색인에는 적지 않는다)
        let kind = crate::document_format::derived_kind(&entry.kind, Path::new(&entry.path)).to_string();
        match kind.as_str() {
            "pdf" => {
                let Some(document) = cache
                    .as_ref()
                    .and_then(|cache| cache.documents.get(&entry.id))
                else {
                    continue;
                };
                // 캐시가 다른 내용의 것이면(파일이 바뀌었는데 아직 다시 뽑지 않았으면) 쓰지 않는다.
                if entry.content_hash.is_some() && document.content_hash != entry.content_hash {
                    continue;
                }
                // 캐시 파일은 디스크의 글이라 깨졌을 수 있다 — 터무니없이 큰 쪽 번호가 배열을 부풀리지 못하게 거른다
                let valid = || document.pages.iter().filter(|page| page.page < MAX_PDF_PAGES);
                let count = valid().map(|page| page.page + 1).max().unwrap_or(0);
                let mut pages = vec![String::new(); count];
                for page in valid() {
                    pages[page.page] = page.text.clone();
                }
                sources.push(SourceDoc {
                    id: entry.id,
                    kind: "pdf".into(),
                    title: entry.display_name,
                    path: entry.path,
                    content_hash: entry.content_hash,
                    pages,
                    complete: document.complete,
                });
            }
            // 'text' 는 txt·html·xml. 지금은 파일을 글 그대로 읽는다.
            // TODO(task3): html·xml 은 태그를 걷어 낸 본문을 색인한다(그때까지는 태그가 섞여 들어간다)
            "markdown" | "text" => {
                let file = if entry.storage == "vault" {
                    root.join(&entry.path)
                } else {
                    PathBuf::from(&entry.path)
                };
                let Ok(text) = std::fs::read_to_string(&file) else {
                    continue;
                };
                sources.push(SourceDoc {
                    id: entry.id,
                    kind: kind.clone(),
                    title: entry.display_name,
                    path: entry.path,
                    content_hash: entry.content_hash,
                    pages: vec![text],
                    complete: true,
                });
            }
            _ => {}
        }
    }
    sources
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_corrupt_huge_page_index_in_the_cache_is_ignored_not_allocated() {
        let root = std::env::temp_dir().join(format!("iwae-source-huge-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".iwae/cache")).unwrap();
        std::fs::write(
            root.join(".iwae/index.json"),
            r#"{"version":1,"entries":[{"id":"p1","kind":"pdf","storage":"reference","path":"C:/x.pdf","displayName":"x","contentHash":"h1","size":1,"modifiedAt":null,"addedAt":"","missing":false}]}"#,
        )
        .unwrap();
        std::fs::write(
            root.join(".iwae/cache/search-text.json"),
            r#"{"version":2,"documents":{"p1":{"contentHash":"h1","complete":true,"pages":[{"page":0,"text":"ok"},{"page":4000000000,"text":"boom"}]}}}"#,
        )
        .unwrap();
        let sources = load_sources(&root);
        assert_eq!(sources[0].pages, vec!["ok".to_string()]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn reads_pdfs_from_the_search_cache_and_markdown_from_disk() {
        let root = std::env::temp_dir().join(format!("iwae-source-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".iwae/cache")).unwrap();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        std::fs::write(root.join("notes/memo.md"), "# 메모\n본문").unwrap();
        std::fs::write(
            root.join(".iwae/index.json"),
            r#"{"version":1,"entries":[
              {"id":"p1","kind":"pdf","storage":"reference","path":"C:/x.pdf","displayName":"논문","contentHash":"h1","size":1,"modifiedAt":null,"addedAt":"","missing":false},
              {"id":"p2","kind":"pdf","storage":"vault","path":"y.pdf","displayName":"캐시 없음","contentHash":"h2","size":1,"modifiedAt":null,"addedAt":"","missing":false},
              {"id":"p3","kind":"pdf","storage":"vault","path":"z.pdf","displayName":"바뀜","contentHash":"new","size":1,"modifiedAt":null,"addedAt":"","missing":false},
              {"id":"m1","kind":"markdown","storage":"vault","path":"notes/memo.md","displayName":"메모","contentHash":null,"size":1,"modifiedAt":null,"addedAt":"","missing":false},
              {"id":"gone","kind":"markdown","storage":"vault","path":"nope.md","displayName":"없음","contentHash":null,"size":1,"modifiedAt":null,"addedAt":"","missing":true}
            ]}"#,
        )
        .unwrap();
        std::fs::write(
            root.join(".iwae/cache/search-text.json"),
            r#"{"version":2,"documents":{
              "p1":{"contentHash":"h1","complete":false,"pages":[{"page":0,"text":"one"},{"page":2,"text":"three"}]},
              "p3":{"contentHash":"old","complete":true,"pages":[{"page":0,"text":"stale"}]}
            }}"#,
        )
        .unwrap();

        let sources = load_sources(&root);
        assert_eq!(
            sources.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            vec!["p1", "m1"]
        );
        assert_eq!(
            sources[0].pages,
            vec!["one".to_string(), String::new(), "three".to_string()]
        );
        assert!(!sources[0].complete);
        assert_eq!(sources[1].pages, vec!["# 메모\n본문".to_string()]);
    }

    #[test]
    fn text_documents_are_read_from_disk_and_keep_their_kind() {
        let root = std::env::temp_dir().join(format!("iwae-source-text-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".iwae")).unwrap();
        std::fs::write(root.join("run.txt"), "버스 초기화 로그").unwrap();
        std::fs::write(
            root.join(".iwae/index.json"),
            r#"{"version":1,"entries":[
              {"id":"t1","kind":"other","storage":"vault","path":"run.txt","displayName":"run","contentHash":null,"size":1,"modifiedAt":null,"addedAt":"","missing":false},
              {"id":"i1","kind":"other","storage":"vault","path":"pic.png","displayName":"pic","contentHash":null,"size":1,"modifiedAt":null,"addedAt":"","missing":false}
            ]}"#,
        )
        .unwrap();
        std::fs::write(root.join("pic.png"), "x").unwrap();
        // 색인에는 other 로 적혀 있고, txt 만 text 문서로 읽힌다(png 는 건너뛴다)
        let sources = load_sources(&root);
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].kind, "text");
        assert_eq!(sources[0].pages, vec!["버스 초기화 로그".to_string()]);
        let _ = std::fs::remove_dir_all(&root);
    }
}
