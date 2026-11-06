//! 의미 검색용 임베딩. Ollama bge-m3 를 쓰고, 테스트는 결정적인 가짜를 넣는다.

/// 글 묶음을 벡터로 바꾸는 쪽. 테스트는 결정적인 가짜를 넣는다.
pub trait Embedder {
    /// 벡터가 어느 모델 것인지. 모델이 바뀌면 이전 벡터는 쓰지 않는다.
    fn model(&self) -> &str;
    fn embed(&self, inputs: &[String]) -> Result<Vec<Vec<f32>>, String>;
}

/// 의미 검색 기본 모델. 한국어·영어를 함께 다루고 Ollama 로 내려받을 수 있다.
pub const DEFAULT_EMBED_MODEL: &str = "bge-m3";
const EMBED_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// Ollama `/api/embed` 를 부르는 임베딩. 색인 스레드(동기)에서 쓰므로 안에서 비동기 요청을
/// 끝날 때까지 기다린다.
pub struct OllamaEmbedder {
    endpoint: String,
    model: String,
    client: reqwest::Client,
}

impl OllamaEmbedder {
    pub fn new(endpoint: &str, model: &str) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .timeout(EMBED_TIMEOUT)
            .build()
            .map_err(|err| tr!("임베딩 요청을 준비하지 못했습니다: {err}", "Couldn't prepare the embedding request: {err}"))?;
        Ok(Self {
            endpoint: endpoint.to_string(),
            model: model.to_string(),
            client,
        })
    }
}

#[derive(serde::Deserialize)]
struct EmbedResponse {
    embeddings: Vec<Vec<f32>>,
}

impl Embedder for OllamaEmbedder {
    fn model(&self) -> &str {
        &self.model
    }

    fn embed(&self, inputs: &[String]) -> Result<Vec<Vec<f32>>, String> {
        let url = crate::translation::endpoint_url(&self.endpoint, "api/embed")?;
        let body = serde_json::json!({ "model": self.model, "input": inputs });
        tauri::async_runtime::block_on(async {
            let response = self
                .client
                .post(url)
                .json(&body)
                .send()
                .await
                .map_err(|err| tr!("Ollama 임베딩 요청에 실패했습니다: {err}", "Ollama embedding request failed: {err}"))?;
            if !response.status().is_success() {
                return Err(tr!("Ollama 임베딩 오류: {}", "Ollama embedding error: {}", response.status()));
            }
            let parsed: EmbedResponse = response
                .json()
                .await
                .map_err(|err| tr!("Ollama 임베딩 응답을 읽지 못했습니다: {err}", "Couldn't read the Ollama embedding response: {err}"))?;
            Ok(parsed.embeddings)
        })
    }
}
