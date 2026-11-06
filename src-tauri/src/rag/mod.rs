//! 바깥 AI 가 Vault 를 빠르게 찾아볼 수 있게 하는 검색 색인(RAG).
//!
//! 순수한 계산(자르기·합치기·Markdown)은 하위 모듈에, SQLite 저장소는 `store` 에 둔다.

pub mod chunk;
pub mod embed;
pub mod fuse;
pub mod markdown;
pub mod source;
pub mod store;
