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
    /// `pdf` 또는 `markdown`
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

pub fn iwae_dir(root: &Path) -> PathBuf {
    root.join(".iwae")
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Vault 색인에 있는 PDF·Markdown 을 읽는다. 읽을 수 없는 항목(사라진 파일, 아직 본문이
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
        match entry.kind.as_str() {
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
                let count = document
                    .pages
                    .iter()
                    .map(|page| page.page + 1)
                    .max()
                    .unwrap_or(0);
                let mut pages = vec![String::new(); count];
                for page in &document.pages {
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
            "markdown" => {
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
                    kind: "markdown".into(),
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
}
