//! 바깥 AI 연동의 공통 상태와 커맨드.
//!
//! 색인·검색·MCP 가 보는 Vault 위치는 여기 [`AiState`] 하나다. 웹뷰가 Vault 를 열 때
//! `ai_set_vault` 로 한 번 알려 주고, 그 뒤의 어떤 커맨드도 경로를 받지 않는다.

pub mod settings;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{Emitter, State};

use crate::mcp::rpc::{Annotation, LocationRequest, ToolContext};
use crate::mcp::ServerHandle;
use crate::rag::embed::{Embedder, OllamaEmbedder};
use crate::rag::source::load_sources;
use crate::rag::store::{DocumentInfo, SearchHit, Store, StoreStatus, DEFAULT_LIMIT};
use settings::{AiSettings, EmbeddingSettings};

#[derive(Default)]
struct IndexRun {
    running: bool,
    /// 돌고 있는 동안 또 요청이 오면 끝난 뒤 정확히 한 번 더 돈다.
    rerun: bool,
}

struct Inner {
    app_data: PathBuf,
    root: Mutex<Option<PathBuf>>,
    settings: Mutex<AiSettings>,
    index: Mutex<IndexRun>,
    server: Mutex<Option<ServerHandle>>,
    server_error: Mutex<Option<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiServerStatus {
    pub running: bool,
    pub error: Option<String>,
}

/// `show_location` 이 웹뷰로 보내는 알림.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiLocationEvent {
    pub id: String,
    #[serde(flatten)]
    pub location: LocationRequest,
    pub received_at: String,
}

/// `.iwae/highlights.json` 에서 형광펜과 메모를 읽는다. 쪽은 1-기반으로 바꾼다.
pub fn parse_annotations(text: &str, doc_filter: Option<&str>) -> Vec<Annotation> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
        return Vec::new();
    };
    let Some(items) = value.get("highlights").and_then(|items| items.as_array()) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let anchor = item.get("anchor")?;
            let doc_id = anchor.get("docId")?.as_str()?.to_string();
            if doc_filter.is_some_and(|filter| filter != doc_id) {
                return None;
            }
            Some(Annotation {
                doc_id,
                page: anchor.get("page")?.as_u64()? as usize + 1,
                color: item
                    .get("color")
                    .and_then(|color| color.as_str())
                    .unwrap_or("yellow")
                    .to_string(),
                quote: anchor
                    .get("quote")
                    .and_then(|quote| quote.as_str())
                    .unwrap_or("")
                    .to_string(),
                note: item
                    .get("note")
                    .and_then(|note| note.as_str())
                    .map(str::to_string),
            })
        })
        .collect()
}

/// MCP 도구가 보는 앱. 검색·본문은 색인에서, 형광펜은 Vault 파일에서, 위치 알림은 웹뷰로.
struct AiContext {
    state: AiState,
    app: tauri::AppHandle,
}

impl ToolContext for AiContext {
    fn search(
        &self,
        query: &str,
        limit: Option<usize>,
        kind: Option<&str>,
    ) -> Result<Vec<SearchHit>, String> {
        self.state.search(query, limit, kind)
    }

    fn documents(&self, kind: Option<&str>) -> Result<Vec<DocumentInfo>, String> {
        self.state.documents(kind)
    }

    fn page_text(
        &self,
        doc_id: &str,
        page: usize,
    ) -> Result<Option<(String, usize, String)>, String> {
        self.state.page_text(doc_id, page)
    }

    fn annotations(&self, doc_id: Option<&str>) -> Result<Vec<Annotation>, String> {
        let root = self
            .state
            .root()
            .ok_or_else(|| "열린 Vault 가 없습니다.".to_string())?;
        let text =
            std::fs::read_to_string(root.join(".iwae").join("highlights.json")).unwrap_or_default();
        Ok(parse_annotations(&text, doc_id))
    }

    fn version_groups(&self) -> serde_json::Value {
        let Some(root) = self.state.root() else {
            return serde_json::Value::Null;
        };
        std::fs::read_to_string(root.join(".iwae").join("versions.json"))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or(serde_json::Value::Null)
    }

    fn extra_tools(&self) -> Vec<serde_json::Value> {
        let mut tools = Vec::new();
        if crate::mcp::canvas_tools::ENABLED {
            tools.extend(crate::mcp::canvas_tools::tool_schemas());
        }
        tools.extend(crate::mcp::memo_tools::tool_schemas());
        tools.extend(crate::mcp::page_tools::tool_schemas());
        tools
    }

    fn extra_call(&self, name: &str, args: &serde_json::Value) -> Option<Result<serde_json::Value, String>> {
        (if crate::mcp::canvas_tools::ENABLED { crate::mcp::canvas_tools::call(&self.app, name, args) } else { None })
            .or_else(|| crate::mcp::memo_tools::call(&self.app, name, args))
            .or_else(|| crate::mcp::page_tools::call(self.state.root(), name, args))
    }

    fn extra_instructions(&self) -> &'static str {
        static COMBINED: std::sync::OnceLock<String> = std::sync::OnceLock::new();
        COMBINED.get_or_init(|| {
            format!(
                "{} {} {}",
                if crate::mcp::canvas_tools::ENABLED { crate::mcp::canvas_tools::INSTRUCTIONS } else { "" },
                crate::mcp::memo_tools::INSTRUCTIONS,
                crate::mcp::page_tools::INSTRUCTIONS
            )
        })
    }

    fn show_location(&self, location: LocationRequest) -> Result<(), String> {
        if self.state.root().is_none() {
            return Err("IWAE 에 열린 Vault 가 없습니다.".into());
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_millis())
            .unwrap_or_default();
        let event = AiLocationEvent {
            id: format!(
                "{now}-{}",
                crate::ai::settings::new_token().get(..8).unwrap_or("0")
            ),
            location,
            received_at: now.to_string(),
        };
        self.app
            .emit("ai-location", event)
            .map_err(|err| format!("알림을 보내지 못했습니다: {err}"))?;
        // 창이 뒤에 있어도 사용자가 알아차리게 작업 표시줄을 깜빡인다(포커스는 빼앗지 않는다).
        if let Some(window) = tauri::Manager::get_webview_window(&self.app, "main") {
            let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
        }
        Ok(())
    }
}

#[derive(Clone)]
pub struct AiState {
    inner: Arc<Inner>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagProgress {
    pub indexed: usize,
    pub total: usize,
    pub done: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagStatus {
    #[serde(flatten)]
    pub store: StoreStatus,
    pub running: bool,
    pub vault_open: bool,
}

impl AiState {
    pub fn new(app_data: PathBuf) -> Self {
        let settings = settings::load(&app_data);
        Self {
            inner: Arc::new(Inner {
                app_data,
                root: Mutex::new(None),
                settings: Mutex::new(settings),
                index: Mutex::new(IndexRun::default()),
                server: Mutex::new(None),
                server_error: Mutex::new(None),
            }),
        }
    }

    pub fn root(&self) -> Option<PathBuf> {
        self.inner.root.lock().unwrap().clone()
    }

    pub fn set_root(&self, root: Option<PathBuf>) {
        *self.inner.root.lock().unwrap() = root;
    }

    pub fn settings(&self) -> AiSettings {
        self.inner.settings.lock().unwrap().clone()
    }

    pub fn update_settings(
        &self,
        change: impl FnOnce(&mut AiSettings),
    ) -> Result<AiSettings, String> {
        let mut guard = self.inner.settings.lock().unwrap();
        change(&mut guard);
        settings::save(&self.inner.app_data, &guard)?;
        Ok(guard.clone())
    }

    /// 의미 검색이 켜져 있으면 Ollama 임베딩. 꺼져 있거나 만들 수 없으면 None(키워드만).
    pub fn embedder(&self) -> Option<OllamaEmbedder> {
        let embedding = self.settings().embedding;
        if !embedding.enabled {
            return None;
        }
        OllamaEmbedder::new(&embedding.endpoint, &embedding.model).ok()
    }

    fn open_store(&self) -> Result<Store, String> {
        let root = self
            .root()
            .ok_or_else(|| tr!("열린 Vault 가 없습니다.", "No vault is open."))?;
        Store::open(&root)
    }

    pub fn search(
        &self,
        query: &str,
        limit: Option<usize>,
        kind: Option<&str>,
    ) -> Result<Vec<SearchHit>, String> {
        let store = self.open_store()?;
        let embedder = self.embedder();
        store.search(
            query,
            limit.unwrap_or(DEFAULT_LIMIT),
            kind,
            embedder.as_ref().map(|e| e as &dyn Embedder),
        )
    }

    pub fn documents(&self, kind: Option<&str>) -> Result<Vec<DocumentInfo>, String> {
        self.open_store()?.documents(kind)
    }

    pub fn page_text(
        &self,
        doc_id: &str,
        page: usize,
    ) -> Result<Option<(String, usize, String)>, String> {
        self.open_store()?.page_text(doc_id, page)
    }

    pub fn status(&self) -> RagStatus {
        let running = self.inner.index.lock().unwrap().running;
        let vault_open = self.root().is_some();
        let store = self
            .open_store()
            .and_then(|store| store.status())
            .unwrap_or_default();
        RagStatus {
            store,
            running,
            vault_open,
        }
    }

    pub fn api_status(&self) -> ApiServerStatus {
        ApiServerStatus {
            running: self.inner.server.lock().unwrap().is_some(),
            error: self.inner.server_error.lock().unwrap().clone(),
        }
    }

    /// 설정대로 MCP 서버를 켜거나 끈다. 이미 돌고 있으면 내렸다가 다시 띄운다(포트·토큰 변경 반영).
    pub fn apply_api(&self, app: &tauri::AppHandle) -> ApiServerStatus {
        if let Some(server) = self.inner.server.lock().unwrap().take() {
            server.stop();
        }
        *self.inner.server_error.lock().unwrap() = None;
        let api = self.settings().api;
        if api.enabled {
            let ctx = Arc::new(AiContext {
                state: self.clone(),
                app: app.clone(),
            });
            let version = app.package_info().version.to_string();
            match crate::mcp::start(api.port, api.token, ctx, version) {
                Ok(server) => *self.inner.server.lock().unwrap() = Some(server),
                Err(message) => *self.inner.server_error.lock().unwrap() = Some(message),
            }
        }
        self.api_status()
    }

    /// 색인을 뒤에서 돌린다. 이미 돌고 있으면 끝난 뒤 한 번 더 돌도록 표시만 한다.
    pub fn start_index(&self, emit: Arc<dyn Fn(RagProgress) + Send + Sync>) {
        {
            let mut run = self.inner.index.lock().unwrap();
            if run.running {
                run.rerun = true;
                return;
            }
            run.running = true;
        }
        let state = self.clone();
        std::thread::Builder::new()
            .name("iwae-rag-index".into())
            .spawn(move || loop {
                let result = state.index_once(&emit);
                emit(RagProgress {
                    indexed: 0,
                    total: 0,
                    done: true,
                    error: result.err(),
                });
                let mut run = state.inner.index.lock().unwrap();
                if run.rerun {
                    run.rerun = false;
                    continue;
                }
                run.running = false;
                break;
            })
            .expect("색인 스레드를 만들지 못했습니다");
    }

    fn index_once(&self, emit: &Arc<dyn Fn(RagProgress) + Send + Sync>) -> Result<(), String> {
        let Some(root) = self.root() else {
            return Ok(());
        };
        let sources = load_sources(&root);
        let mut store = Store::open(&root)?;
        let embedder = self.embedder();
        store.sync(
            &sources,
            embedder.as_ref().map(|e| e as &dyn Embedder),
            &mut |indexed, total| {
                emit(RagProgress {
                    indexed,
                    total,
                    done: false,
                    error: None,
                });
            },
        )?;
        Ok(())
    }
}

fn emitter(app: tauri::AppHandle) -> Arc<dyn Fn(RagProgress) + Send + Sync> {
    Arc::new(move |progress| {
        let _ = app.emit("rag-progress", progress);
    })
}

/// 웹뷰가 Vault 를 열거나 닫을 때 알린다. `.iwae` 폴더가 있는 곳만 받는다.
#[tauri::command]
pub fn ai_set_vault(
    app: tauri::AppHandle,
    state: State<'_, AiState>,
    root: Option<String>,
) -> Result<(), String> {
    let root = match root {
        Some(root) => {
            let path = PathBuf::from(root);
            if !path.join(".iwae").is_dir() {
                return Err(tr!("IWAE Vault 가 아닌 폴더입니다.", "This folder is not an IWAE vault."));
            }
            Some(path)
        }
        None => None,
    };
    let opened = root.is_some();
    state.set_root(root);
    if opened {
        state.start_index(emitter(app));
    }
    Ok(())
}

#[tauri::command]
pub fn rag_index(app: tauri::AppHandle, state: State<'_, AiState>) {
    state.start_index(emitter(app));
}

#[tauri::command]
pub async fn rag_status(state: State<'_, AiState>) -> Result<RagStatus, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.status())
        .await
        .map_err(|err| tr!("색인 상태를 읽지 못했습니다: {err}", "Couldn't read the index status: {err}"))
}

#[tauri::command]
pub async fn rag_search(
    state: State<'_, AiState>,
    query: String,
    limit: Option<usize>,
    kind: Option<String>,
) -> Result<Vec<SearchHit>, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.search(&query, limit, kind.as_deref()))
        .await
        .map_err(|err| tr!("검색이 중단되었습니다: {err}", "Search was interrupted: {err}"))?
}

#[tauri::command]
pub fn ai_settings_get(state: State<'_, AiState>) -> AiSettings {
    state.settings()
}

#[tauri::command]
pub fn ai_embedding_configure(
    app: tauri::AppHandle,
    state: State<'_, AiState>,
    embedding: EmbeddingSettings,
) -> Result<AiSettings, String> {
    let updated = state.update_settings(|settings| settings.embedding = embedding)?;
    // 켜면 빠진 조각의 벡터를 채우러 한 번 돈다.
    if updated.embedding.enabled {
        state.start_index(emitter(app));
    }
    Ok(updated)
}

#[tauri::command]
pub fn ai_api_configure(
    app: tauri::AppHandle,
    state: State<'_, AiState>,
    enabled: bool,
    port: u16,
) -> Result<ApiServerStatus, String> {
    if port < 1024 {
        return Err(tr!("포트는 1024 이상이어야 합니다.", "The port must be 1024 or higher."));
    }
    state.update_settings(|settings| {
        settings.api.enabled = enabled;
        settings.api.port = port;
    })?;
    Ok(state.apply_api(&app))
}

#[tauri::command]
pub fn ai_api_status(state: State<'_, AiState>) -> ApiServerStatus {
    state.api_status()
}

/// 토큰을 새로 만든다. 서버가 돌고 있으면 새 토큰으로 다시 띄운다 — 예전 토큰은 즉시 무효다.
#[tauri::command]
pub fn ai_api_regenerate_token(
    app: tauri::AppHandle,
    state: State<'_, AiState>,
) -> Result<AiSettings, String> {
    let updated = state.update_settings(|settings| settings.api.token = settings::new_token())?;
    state.apply_api(&app);
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;
    use std::time::Duration;

    fn vault_with_markdown() -> PathBuf {
        let root = std::env::temp_dir().join(format!("iwae-ai-state-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".iwae")).unwrap();
        std::fs::write(root.join("memo.md"), "버스 초기화 순서").unwrap();
        std::fs::write(
            root.join(".iwae/index.json"),
            r#"{"version":1,"entries":[{"id":"m1","kind":"markdown","storage":"vault","path":"memo.md","displayName":"메모","contentHash":null,"size":1,"modifiedAt":null,"addedAt":"","missing":false}]}"#,
        )
        .unwrap();
        root
    }

    #[test]
    fn indexes_in_the_background_and_then_searches() {
        let root = vault_with_markdown();
        let state = AiState::new(root.join("appdata"));
        assert!(
            state.search("버스", None, None).is_err(),
            "Vault 없이는 검색하지 않는다"
        );
        state.set_root(Some(root));

        let (tx, rx) = channel();
        let tx = Mutex::new(tx);
        state.start_index(Arc::new(move |progress: RagProgress| {
            let _ = tx.lock().unwrap().send(progress);
        }));
        let done = loop {
            let progress = rx
                .recv_timeout(Duration::from_secs(10))
                .expect("색인이 끝나야 한다");
            if progress.done {
                break progress;
            }
        };
        assert!(done.error.is_none(), "{:?}", done.error);
        assert_eq!(state.search("버스", None, None).unwrap()[0].doc_id, "m1");
        assert_eq!(state.status().store.documents, 1);
        assert_eq!(state.documents(None).unwrap()[0].title, "메모");
    }

    #[test]
    fn reads_highlights_and_notes_with_one_based_pages() {
        let text = r#"{"version":1,"highlights":[
          {"id":"a","color":"blue","note":"정의","anchor":{"docId":"d1","page":0,"quote":"Dynamic address"}},
          {"id":"b","anchor":{"docId":"d2","page":4,"quote":"other"}}
        ]}"#;
        let all = parse_annotations(text, None);
        assert_eq!(all.len(), 2);
        assert_eq!(
            (all[0].page, all[0].color.as_str(), all[0].note.as_deref()),
            (1, "blue", Some("정의"))
        );
        assert_eq!(all[1].color, "yellow");
        assert_eq!(parse_annotations(text, Some("d2")).len(), 1);
        assert!(parse_annotations("broken", None).is_empty());
    }
}
