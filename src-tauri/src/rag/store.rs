//! SQLite 검색 색인. `.iwae/index/rag.sqlite` 한 파일이다.

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde::Serialize;

use super::chunk::chunk_page;
use super::embed::Embedder;
use super::fuse::{cosine, decode_vector, encode_vector, fts_query, normalize, rrf, snippet};
use super::markdown::{render_ai_markdown, AiDocMeta};
use super::source::{iwae_dir, SourceDoc};

/// 한 목록(키워드·의미)에서 합치기 전에 가져오는 후보 수.
const CANDIDATES: usize = 50;
const RRF_K: f64 = 60.0;
pub const DEFAULT_LIMIT: usize = 8;
pub const MAX_LIMIT: usize = 25;
const SNIPPET_CHARS: usize = 280;
/// 임베딩을 한 번에 몇 조각씩 보낼지.
const EMBED_BATCH: usize = 16;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub doc_id: String,
    pub title: String,
    pub kind: String,
    /// 1-기반 쪽
    pub page: usize,
    pub char_start: usize,
    pub char_end: usize,
    pub snippet: String,
    pub score: f64,
    pub matched_by: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInfo {
    pub doc_id: String,
    pub title: String,
    pub kind: String,
    pub pages: usize,
    pub complete: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreStatus {
    pub documents: usize,
    pub chunks: usize,
    pub embedded: usize,
    pub last_indexed_at: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SyncReport {
    pub reindexed: usize,
    pub removed: usize,
    pub embedded: usize,
}

pub struct Store {
    conn: Connection,
    root: PathBuf,
}

fn sql_error(err: rusqlite::Error) -> String {
    tr!("검색 색인 오류: {err}", "Search index error: {err}")
}

/// 문서 id 를 파일 이름으로 쓸 수 있게 다듬는다(16진수·UUID 라 보통 그대로다).
fn file_stem(id: &str) -> String {
    id.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS documents(
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, path TEXT NOT NULL,
  content_hash TEXT, pages INTEGER NOT NULL, complete INTEGER NOT NULL, indexed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pages(doc_id TEXT NOT NULL, page INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY(doc_id, page));
CREATE TABLE IF NOT EXISTS chunks(
  id INTEGER PRIMARY KEY, doc_id TEXT NOT NULL, page INTEGER NOT NULL,
  char_start INTEGER NOT NULL, char_end INTEGER NOT NULL, text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(doc_id);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, tokenize='trigram');
CREATE TABLE IF NOT EXISTS embeddings(chunk_id INTEGER PRIMARY KEY, model TEXT NOT NULL, dim INTEGER NOT NULL, vector BLOB NOT NULL);
";

fn now_millis() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis().to_string())
        .unwrap_or_default()
}

fn delete_document(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE doc_id = ?1)",
        params![id],
    )?;
    conn.execute(
        "DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE doc_id = ?1)",
        params![id],
    )?;
    conn.execute("DELETE FROM chunks WHERE doc_id = ?1", params![id])?;
    conn.execute("DELETE FROM pages WHERE doc_id = ?1", params![id])?;
    conn.execute("DELETE FROM documents WHERE id = ?1", params![id])?;
    Ok(())
}

impl Store {
    pub fn open(root: &Path) -> Result<Self, String> {
        let dir = iwae_dir(root).join("index");
        std::fs::create_dir_all(&dir)
            .map_err(|err| tr!("색인 폴더를 만들지 못했습니다: {err}", "Couldn't create the index folder: {err}"))?;
        let conn = Connection::open(dir.join("rag.sqlite")).map_err(sql_error)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
            .map_err(sql_error)?;
        conn.execute_batch(SCHEMA).map_err(sql_error)?;
        conn.execute(
            "INSERT OR IGNORE INTO meta(key, value) VALUES ('schema', '1')",
            [],
        )
        .map_err(sql_error)?;
        Ok(Self {
            conn,
            root: root.to_path_buf(),
        })
    }

    fn ai_markdown_path(&self, id: &str) -> PathBuf {
        iwae_dir(&self.root)
            .join("ai")
            .join(format!("{}.md", file_stem(id)))
    }

    fn write_ai_markdown(&self, source: &SourceDoc) {
        let path = self.ai_markdown_path(&source.id);
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let meta = AiDocMeta {
            id: &source.id,
            title: &source.title,
            kind: &source.kind,
            source: &source.path,
            complete: source.complete,
        };
        // AI 용 사본은 다시 만들 수 있는 파생물이라 쓰기 실패가 색인 전체를 멈추게 하지 않는다.
        let _ = std::fs::write(path, render_ai_markdown(&meta, &source.pages));
    }

    /// 원본 목록에 맞춰 색인을 고친다. 바뀐 문서만 다시 자르고, 사라진 문서는 지운다.
    /// 임베딩은 그 뒤에 빠진 조각만 채운다 — 실패하면 그 조각은 키워드로만 찾힌다.
    pub fn sync(
        &mut self,
        sources: &[SourceDoc],
        embedder: Option<&dyn Embedder>,
        progress: &mut dyn FnMut(usize, usize),
    ) -> Result<SyncReport, String> {
        let mut report = SyncReport::default();
        let existing: Vec<(String, Option<String>, usize, bool, String)> = {
            let mut statement = self
                .conn
                .prepare("SELECT id, content_hash, pages, complete, title FROM documents")
                .map_err(sql_error)?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get::<_, i64>(2)? as usize,
                        row.get::<_, i64>(3)? != 0,
                        row.get(4)?,
                    ))
                })
                .map_err(sql_error)?;
            rows.collect::<Result<_, _>>().map_err(sql_error)?
        };

        let indexed_at = now_millis();
        let tx = self.conn.transaction().map_err(sql_error)?;
        let mut changed = Vec::new();
        for (position, source) in sources.iter().enumerate() {
            let unchanged = existing.iter().any(|(id, hash, pages, complete, title)| {
                id == &source.id
                    && hash == &source.content_hash
                    && *pages == source.pages.len()
                    && *complete == source.complete
                    && title == &source.title
            });
            if !unchanged {
                delete_document(&tx, &source.id).map_err(sql_error)?;
                tx.execute(
                    "INSERT INTO documents(id, kind, title, path, content_hash, pages, complete, indexed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![source.id, source.kind, source.title, source.path, source.content_hash, source.pages.len() as i64, source.complete as i64, indexed_at],
                )
                .map_err(sql_error)?;
                for (page, text) in source.pages.iter().enumerate() {
                    tx.execute(
                        "INSERT INTO pages(doc_id, page, text) VALUES (?1, ?2, ?3)",
                        params![source.id, page as i64, text],
                    )
                    .map_err(sql_error)?;
                    for chunk in chunk_page(text) {
                        tx.execute(
                            "INSERT INTO chunks(doc_id, page, char_start, char_end, text) VALUES (?1, ?2, ?3, ?4, ?5)",
                            params![source.id, page as i64, chunk.start as i64, chunk.end as i64, chunk.text],
                        )
                        .map_err(sql_error)?;
                        let chunk_id = tx.last_insert_rowid();
                        tx.execute(
                            "INSERT INTO chunks_fts(rowid, text) VALUES (?1, ?2)",
                            params![chunk_id, chunk.text],
                        )
                        .map_err(sql_error)?;
                    }
                }
                report.reindexed += 1;
                changed.push(source);
            }
            progress(position + 1, sources.len());
        }
        let mut removed_ids = Vec::new();
        for (id, ..) in &existing {
            if !sources.iter().any(|source| &source.id == id) {
                delete_document(&tx, id).map_err(sql_error)?;
                removed_ids.push(id.clone());
                report.removed += 1;
            }
        }
        tx.execute(
            "INSERT INTO meta(key, value) VALUES ('last_indexed_at', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![indexed_at],
        )
        .map_err(sql_error)?;
        tx.commit().map_err(sql_error)?;
        for id in &removed_ids {
            let _ = std::fs::remove_file(self.ai_markdown_path(id));
        }

        for source in changed {
            self.write_ai_markdown(source);
        }
        for source in sources {
            if !self.ai_markdown_path(&source.id).exists() {
                self.write_ai_markdown(source);
            }
        }

        if let Some(embedder) = embedder {
            report.embedded = self.embed_missing(embedder)?;
        }
        Ok(report)
    }

    fn embed_missing(&mut self, embedder: &dyn Embedder) -> Result<usize, String> {
        let model = embedder.model().to_string();
        self.conn
            .execute(
                "INSERT INTO meta(key, value) VALUES ('embed_model', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![model],
            )
            .map_err(sql_error)?;
        // 모델이 바뀌면 이전 벡터는 다른 공간이라 섞을 수 없다.
        self.conn
            .execute("DELETE FROM embeddings WHERE model <> ?1", params![model])
            .map_err(sql_error)?;
        let missing: Vec<(i64, String)> = {
            let mut statement = self
                .conn
                .prepare("SELECT c.id, c.text FROM chunks c LEFT JOIN embeddings e ON e.chunk_id = c.id WHERE e.chunk_id IS NULL ORDER BY c.id")
                .map_err(sql_error)?;
            let rows = statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(sql_error)?;
            rows.collect::<Result<_, _>>().map_err(sql_error)?
        };
        let mut embedded = 0usize;
        for batch in missing.chunks(EMBED_BATCH) {
            let inputs: Vec<String> = batch.iter().map(|(_, text)| text.clone()).collect();
            let Ok(vectors) = embedder.embed(&inputs) else {
                break;
            };
            if vectors.len() != batch.len() {
                break;
            }
            for ((chunk_id, _), mut vector) in batch.iter().zip(vectors) {
                normalize(&mut vector);
                self.conn
                    .execute(
                        "INSERT OR REPLACE INTO embeddings(chunk_id, model, dim, vector) VALUES (?1, ?2, ?3, ?4)",
                        params![chunk_id, model, vector.len() as i64, encode_vector(&vector)],
                    )
                    .map_err(sql_error)?;
                embedded += 1;
            }
        }
        Ok(embedded)
    }

    fn keyword_ids(&self, query: &str, kind: Option<&str>) -> Result<Vec<i64>, String> {
        let plan = fts_query(query);
        let lowered: Vec<String> = plan
            .short_tokens
            .iter()
            .map(|token| token.to_lowercase())
            .collect();
        let contains_short = |text: &str| {
            let lower = text.to_lowercase();
            lowered.iter().all(|token| lower.contains(token.as_str()))
        };

        if let Some(phrase) = plan.phrase {
            let mut statement = self
                .conn
                .prepare(
                    "SELECT f.rowid, c.text FROM chunks_fts f JOIN chunks c ON c.id = f.rowid JOIN documents d ON d.id = c.doc_id
                     WHERE chunks_fts MATCH ?1 AND (?2 IS NULL OR d.kind = ?2) ORDER BY bm25(chunks_fts) LIMIT 200",
                )
                .map_err(sql_error)?;
            let rows = statement
                .query_map(params![phrase, kind], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(sql_error)?;
            let mut ids = Vec::new();
            for row in rows {
                let (id, text) = row.map_err(sql_error)?;
                if contains_short(&text) {
                    ids.push(id);
                }
                if ids.len() >= CANDIDATES {
                    break;
                }
            }
            return Ok(ids);
        }

        let Some(first) = lowered.first() else {
            return Ok(Vec::new());
        };
        let mut statement = self
            .conn
            .prepare(
                "SELECT c.id, c.text FROM chunks c JOIN documents d ON d.id = c.doc_id
                 WHERE instr(lower(c.text), ?1) > 0 AND (?2 IS NULL OR d.kind = ?2) ORDER BY d.title, c.page, c.id",
            )
            .map_err(sql_error)?;
        let rows = statement
            .query_map(params![first, kind], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(sql_error)?;
        let mut ids = Vec::new();
        for row in rows {
            let (id, text) = row.map_err(sql_error)?;
            if contains_short(&text) {
                ids.push(id);
            }
            if ids.len() >= CANDIDATES {
                break;
            }
        }
        Ok(ids)
    }

    fn semantic_ids(
        &self,
        query: &str,
        kind: Option<&str>,
        embedder: &dyn Embedder,
    ) -> Result<Vec<i64>, String> {
        let Ok(mut vectors) = embedder.embed(&[query.to_string()]) else {
            return Ok(Vec::new());
        };
        let Some(mut target) = vectors.pop() else {
            return Ok(Vec::new());
        };
        normalize(&mut target);
        let mut statement = self
            .conn
            .prepare(
                "SELECT e.chunk_id, e.vector FROM embeddings e JOIN chunks c ON c.id = e.chunk_id JOIN documents d ON d.id = c.doc_id
                 WHERE e.model = ?1 AND (?2 IS NULL OR d.kind = ?2)",
            )
            .map_err(sql_error)?;
        let rows = statement
            .query_map(params![embedder.model(), kind], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?))
            })
            .map_err(sql_error)?;
        let mut scored = Vec::new();
        for row in rows {
            let (id, bytes) = row.map_err(sql_error)?;
            let similarity = cosine(&target, &decode_vector(&bytes));
            if similarity > 0.0 {
                scored.push((id, similarity));
            }
        }
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        Ok(scored
            .into_iter()
            .take(CANDIDATES)
            .map(|(id, _)| id)
            .collect())
    }

    /// 키워드(FTS5 + 짧은 낱말 부분 검색)와 의미(임베딩) 결과를 순위로 합친다.
    pub fn search(
        &self,
        query: &str,
        limit: usize,
        kind: Option<&str>,
        embedder: Option<&dyn Embedder>,
    ) -> Result<Vec<SearchHit>, String> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let limit = limit.clamp(1, MAX_LIMIT);
        let keyword = self.keyword_ids(query, kind)?;
        let semantic = match embedder {
            Some(embedder) => self.semantic_ids(query, kind, embedder)?,
            None => Vec::new(),
        };
        let fused = rrf(&[keyword.clone(), semantic.clone()], RRF_K);

        let mut hits = Vec::new();
        for (chunk_id, score) in fused.into_iter().take(limit) {
            let hit = self
                .conn
                .query_row(
                    "SELECT c.doc_id, c.page, c.char_start, c.char_end, c.text, d.title, d.kind FROM chunks c JOIN documents d ON d.id = c.doc_id WHERE c.id = ?1",
                    params![chunk_id],
                    |row| {
                        let text: String = row.get(4)?;
                        Ok(SearchHit {
                            doc_id: row.get(0)?,
                            page: row.get::<_, i64>(1)? as usize + 1,
                            char_start: row.get::<_, i64>(2)? as usize,
                            char_end: row.get::<_, i64>(3)? as usize,
                            snippet: snippet(&text, query, SNIPPET_CHARS),
                            title: row.get(5)?,
                            kind: row.get(6)?,
                            score,
                            matched_by: Vec::new(),
                        })
                    },
                )
                .map_err(sql_error)?;
            let mut hit = hit;
            if keyword.contains(&chunk_id) {
                hit.matched_by.push("keyword".into());
            }
            if semantic.contains(&chunk_id) {
                hit.matched_by.push("semantic".into());
            }
            hits.push(hit);
        }
        Ok(hits)
    }

    pub fn status(&self) -> Result<StoreStatus, String> {
        let count = |sql: &str| -> Result<usize, String> {
            self.conn
                .query_row(sql, [], |row| row.get::<_, i64>(0))
                .map(|n| n as usize)
                .map_err(sql_error)
        };
        let last_indexed_at = self
            .conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'last_indexed_at'",
                [],
                |row| row.get(0),
            )
            .ok();
        Ok(StoreStatus {
            documents: count("SELECT COUNT(*) FROM documents")?,
            chunks: count("SELECT COUNT(*) FROM chunks")?,
            embedded: count("SELECT COUNT(*) FROM embeddings WHERE model = (SELECT value FROM meta WHERE key = 'embed_model')")?,
            last_indexed_at,
        })
    }

    pub fn documents(&self, kind: Option<&str>) -> Result<Vec<DocumentInfo>, String> {
        let mut statement = self
            .conn
            .prepare("SELECT id, title, kind, pages, complete FROM documents WHERE (?1 IS NULL OR kind = ?1) ORDER BY title")
            .map_err(sql_error)?;
        let rows = statement
            .query_map(params![kind], |row| {
                Ok(DocumentInfo {
                    doc_id: row.get(0)?,
                    title: row.get(1)?,
                    kind: row.get(2)?,
                    pages: row.get::<_, i64>(3)? as usize,
                    complete: row.get::<_, i64>(4)? != 0,
                })
            })
            .map_err(sql_error)?;
        rows.collect::<Result<_, _>>().map_err(sql_error)
    }

    /// 한 쪽의 원문(1-기반 쪽). (본문, 전체 쪽 수, 제목). 없으면 None.
    pub fn page_text(
        &self,
        doc_id: &str,
        page: usize,
    ) -> Result<Option<(String, usize, String)>, String> {
        if page == 0 {
            return Ok(None);
        }
        let row = self.conn.query_row(
            "SELECT p.text, d.pages, d.title FROM pages p JOIN documents d ON d.id = p.doc_id WHERE p.doc_id = ?1 AND p.page = ?2",
            params![doc_id, (page - 1) as i64],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize, row.get::<_, String>(2)?)),
        );
        match row {
            Ok(found) => Ok(Some(found)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(err) => Err(sql_error(err)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn temp_root() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "iwae-rag-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn doc(id: &str, kind: &str, hash: &str, pages: &[&str]) -> SourceDoc {
        SourceDoc {
            id: id.into(),
            kind: kind.into(),
            title: format!("{id} 제목"),
            path: format!("{id}.{kind}"),
            content_hash: Some(hash.into()),
            pages: pages.iter().map(|page| page.to_string()).collect(),
            complete: true,
        }
    }

    #[test]
    fn indexes_documents_and_finds_long_and_short_queries() {
        let root = temp_root();
        let mut store = Store::open(&root).unwrap();
        let sources = vec![
            doc(
                "pdf1",
                "pdf",
                "h1",
                &[
                    "Introduction text.",
                    "Dynamic address assignment begins after bus initialization.",
                ],
            ),
            doc(
                "md1",
                "markdown",
                "h2",
                &["# 메모\n버스 초기화 순서를 정리한다."],
            ),
        ];
        let report = store.sync(&sources, None, &mut |_, _| {}).unwrap();
        assert_eq!(report.reindexed, 2);

        let hits = store.search("address assignment", 8, None, None).unwrap();
        assert_eq!(hits[0].doc_id, "pdf1");
        assert_eq!(hits[0].page, 2);
        assert!(hits[0].snippet.contains("address"));
        assert_eq!(hits[0].matched_by, vec!["keyword".to_string()]);
        let page_text = "Dynamic address assignment begins after bus initialization.";
        assert_eq!(&page_text[hits[0].char_start..hits[0].char_end], page_text);

        // 두 글자 한국어 낱말도 찾는다(trigram 으로는 못 찾는 길이).
        let korean = store.search("버스", 8, None, None).unwrap();
        assert_eq!(korean[0].doc_id, "md1");

        // 종류로 거른다.
        assert!(store
            .search("버스", 8, Some("pdf"), None)
            .unwrap()
            .is_empty());

        let status = store.status().unwrap();
        assert_eq!((status.documents, status.embedded), (2, 0));
        assert!(status.chunks >= 3);
        assert_eq!(store.documents(Some("markdown")).unwrap()[0].doc_id, "md1");
        assert_eq!(store.page_text("pdf1", 2).unwrap().unwrap().0, page_text);
        assert!(store.page_text("pdf1", 9).unwrap().is_none());
    }

    #[test]
    fn writes_ai_markdown_and_cleans_up_removed_documents() {
        let root = temp_root();
        let mut store = Store::open(&root).unwrap();
        store
            .sync(
                &[
                    doc("pdf1", "pdf", "h1", &["page one"]),
                    doc("pdf2", "pdf", "h2", &["other"]),
                ],
                None,
                &mut |_, _| {},
            )
            .unwrap();
        let ai = root.join(".iwae").join("ai");
        assert!(std::fs::read_to_string(ai.join("pdf1.md"))
            .unwrap()
            .contains("<!-- page:1 -->\npage one"));

        let report = store
            .sync(
                &[doc("pdf1", "pdf", "h1", &["page one"])],
                None,
                &mut |_, _| {},
            )
            .unwrap();
        assert_eq!((report.reindexed, report.removed), (0, 1));
        assert!(!ai.join("pdf2.md").exists());
        assert!(store.search("other", 8, None, None).unwrap().is_empty());
    }

    #[test]
    fn reindexes_only_changed_documents() {
        let root = temp_root();
        let mut store = Store::open(&root).unwrap();
        store
            .sync(
                &[doc("pdf1", "pdf", "h1", &["old words here"])],
                None,
                &mut |_, _| {},
            )
            .unwrap();
        let report = store
            .sync(
                &[doc("pdf1", "pdf", "h2", &["new phrase here"])],
                None,
                &mut |_, _| {},
            )
            .unwrap();
        assert_eq!(report.reindexed, 1);
        assert!(store.search("old words", 8, None, None).unwrap().is_empty());
        assert_eq!(store.search("new phrase", 8, None, None).unwrap().len(), 1);
    }

    struct FakeEmbedder;
    impl Embedder for FakeEmbedder {
        fn model(&self) -> &str {
            "fake"
        }
        // "자동차" 와 "car" 를 같은 방향으로 보내는 장난감 모델.
        fn embed(&self, inputs: &[String]) -> Result<Vec<Vec<f32>>, String> {
            Ok(inputs
                .iter()
                .map(|text| {
                    let lower = text.to_lowercase();
                    vec![
                        if lower.contains("car") || lower.contains("자동차") {
                            1.0
                        } else {
                            0.0
                        },
                        if lower.contains("bus") { 1.0 } else { 0.0 },
                        0.1,
                    ]
                })
                .collect())
        }
    }

    struct BrokenEmbedder;
    impl Embedder for BrokenEmbedder {
        fn model(&self) -> &str {
            "broken"
        }
        fn embed(&self, _inputs: &[String]) -> Result<Vec<Vec<f32>>, String> {
            Err("Ollama 에 연결하지 못했습니다".into())
        }
    }

    #[test]
    fn semantic_search_finds_paraphrases_when_embeddings_exist() {
        let root = temp_root();
        let mut store = Store::open(&root).unwrap();
        let report = store
            .sync(
                &[
                    doc("a", "pdf", "h", &["The car drives fast."]),
                    doc("b", "pdf", "h", &["The bus is slow."]),
                ],
                Some(&FakeEmbedder),
                &mut |_, _| {},
            )
            .unwrap();
        assert_eq!(report.embedded, 2);
        let hits = store
            .search("자동차", 8, None, Some(&FakeEmbedder))
            .unwrap();
        assert_eq!(hits[0].doc_id, "a");
        assert!(hits[0].matched_by.contains(&"semantic".to_string()));
        assert_eq!(store.status().unwrap().embedded, 2);
    }

    #[test]
    fn a_failing_embedder_leaves_keyword_search_working() {
        let root = temp_root();
        let mut store = Store::open(&root).unwrap();
        let report = store
            .sync(
                &[doc("a", "pdf", "h", &["The car drives fast."])],
                Some(&BrokenEmbedder),
                &mut |_, _| {},
            )
            .unwrap();
        assert_eq!(report.embedded, 0);
        assert_eq!(store.status().unwrap().embedded, 0);
        assert_eq!(
            store
                .search("drives", 8, None, Some(&BrokenEmbedder))
                .unwrap()
                .len(),
            1
        );
    }
}
