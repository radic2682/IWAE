//! 열린 문서를 붙잡아 두는 LRU.
//!
//! 엔진 타입을 모르는 채로 값만 담는다 — PDFium 이 바뀌어도 이 파일은 그대로다.
//! 측정상 문서 하나가 ~8MB 이므로 16개를 잡아도 130MB 안쪽이다(MCP·여러 패널이 문서를 열어도 보고 있는 문서가 밀려나지 않게).

/// 동시에 열어 둘 문서 수.
pub const CAPACITY: usize = 16;

/// 아주 작은 LRU. 용량이 8이라 `Vec` 선형 탐색이 해시맵+연결리스트보다 빠르고 단순하다.
/// 앞쪽이 가장 최근에 쓴 항목이다.
pub struct DocCache<V> {
    capacity: usize,
    entries: Vec<(String, V)>,
}

impl<V> DocCache<V> {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            entries: Vec::with_capacity(capacity),
        }
    }

    /// 있으면 맨 앞으로 끌어올리고 돌려준다.
    pub fn get(&mut self, key: &str) -> Option<&V> {
        let index = self.entries.iter().position(|(k, _)| k == key)?;
        let entry = self.entries.remove(index);
        self.entries.insert(0, entry);
        self.entries.first().map(|(_, value)| value)
    }

    /// 넣고 가장 오래된 것을 밀어낸다. 같은 키가 이미 있으면 교체한다.
    pub fn put(&mut self, key: String, value: V) -> &V {
        if let Some(index) = self.entries.iter().position(|(k, _)| *k == key) {
            self.entries.remove(index);
        }

        self.entries.insert(0, (key, value));
        self.entries.truncate(self.capacity);

        // 방금 넣은 것은 반드시 맨 앞에 있다 — capacity 가 0 이 아닌 한.
        &self.entries[0].1
    }

    /// 꺼내 버린다. 문서 핸들이 떨어지면서 파일도 닫힌다(쪽 편집으로 파일을 덮어쓰기 전에 필요).
    pub fn remove(&mut self, key: &str) -> Option<V> {
        let index = self.entries.iter().position(|(k, _)| k == key)?;
        Some(self.entries.remove(index).1)
    }

    #[cfg(test)]
    pub fn keys(&self) -> Vec<&str> {
        self.entries.iter().map(|(k, _)| k.as_str()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oldest_is_evicted_past_capacity() {
        let mut cache = DocCache::new(2);
        cache.put("a".into(), 1);
        cache.put("b".into(), 2);
        cache.put("c".into(), 3);

        assert_eq!(cache.keys(), vec!["c", "b"]);
        assert!(cache.get("a").is_none());
    }

    #[test]
    fn recently_read_entry_survives() {
        let mut cache = DocCache::new(2);
        cache.put("a".into(), 1);
        cache.put("b".into(), 2);
        assert_eq!(cache.get("a"), Some(&1));

        cache.put("c".into(), 3);
        assert_eq!(cache.keys(), vec!["c", "a"]);
    }

    #[test]
    fn same_key_replaces() {
        let mut cache = DocCache::new(2);
        cache.put("a".into(), 1);
        cache.put("a".into(), 9);

        assert_eq!(cache.keys(), vec!["a"]);
        assert_eq!(cache.get("a"), Some(&9));
    }
}
