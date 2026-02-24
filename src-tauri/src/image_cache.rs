use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

const MAX_CACHE_BYTES: usize = 100 * 1024 * 1024; // 100 MB
const PREFETCH_AHEAD: usize = 2;
const PREFETCH_BEHIND: usize = 1;

/// Image source info needed by the cache to read images independently.
#[derive(Clone)]
pub enum ImageSourceInfo {
    Folder {
        image_paths: Vec<PathBuf>,
    },
    Zip {
        zip_path: PathBuf,
        entry_names: Vec<String>,
    },
}

struct ZipHandle {
    archive: zip::ZipArchive<std::fs::File>,
}

/// LRU byte cache with a total memory budget.
struct LruBytesCache {
    /// Ordered from oldest (front) to newest (back).
    order: VecDeque<(String, usize)>,
    data: HashMap<(String, usize), Vec<u8>>,
    total_bytes: usize,
}

impl LruBytesCache {
    fn new() -> Self {
        Self {
            order: VecDeque::new(),
            data: HashMap::new(),
            total_bytes: 0,
        }
    }

    fn get(&mut self, file_id: &str, index: usize) -> Option<Vec<u8>> {
        let key = (file_id.to_string(), index);
        if let Some(bytes) = self.data.get(&key) {
            // Move to back (most recently used)
            self.order.retain(|k| k != &key);
            self.order.push_back(key);
            Some(bytes.clone())
        } else {
            None
        }
    }

    fn contains(&self, file_id: &str, index: usize) -> bool {
        self.data.contains_key(&(file_id.to_string(), index))
    }

    fn insert(&mut self, file_id: &str, index: usize, bytes: Vec<u8>) {
        let key = (file_id.to_string(), index);
        if self.data.contains_key(&key) {
            return;
        }

        let size = bytes.len();

        // Evict until we have room
        while self.total_bytes + size > MAX_CACHE_BYTES && !self.order.is_empty() {
            if let Some(old_key) = self.order.pop_front() {
                if let Some(old_bytes) = self.data.remove(&old_key) {
                    self.total_bytes -= old_bytes.len();
                }
            }
        }

        self.total_bytes += size;
        self.data.insert(key.clone(), bytes);
        self.order.push_back(key);
    }

    fn remove_file(&mut self, file_id: &str) {
        self.order.retain(|k| k.0 != file_id);
        let keys_to_remove: Vec<_> = self
            .data
            .keys()
            .filter(|k| k.0 == file_id)
            .cloned()
            .collect();
        for key in keys_to_remove {
            if let Some(bytes) = self.data.remove(&key) {
                self.total_bytes -= bytes.len();
            }
        }
    }
}

struct CacheInner {
    zip_handles: HashMap<String, ZipHandle>,
    /// Source info for all image tabs (both folder and zip)
    sources: HashMap<String, ImageSourceInfo>,
    lru: LruBytesCache,
}

pub struct ImageCacheManager {
    inner: Arc<Mutex<CacheInner>>,
}

impl ImageCacheManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(CacheInner {
                zip_handles: HashMap::new(),
                sources: HashMap::new(),
                lru: LruBytesCache::new(),
            })),
        }
    }

    /// Register an image source when a tab is opened.
    /// ZIP archive handle is opened lazily on first read_image call.
    pub fn register(&self, file_id: &str, source: ImageSourceInfo) {
        let mut inner = self.inner.lock().unwrap();
        inner.sources.insert(file_id.to_string(), source);
    }

    /// Unregister when a tab is closed.
    pub fn unregister(&self, file_id: &str) {
        let mut inner = self.inner.lock().unwrap();
        inner.zip_handles.remove(file_id);
        inner.sources.remove(file_id);
        inner.lru.remove_file(file_id);
    }

    /// Read an image, using LRU cache first, then the appropriate source.
    pub fn read_image(&self, file_id: &str, index: usize) -> anyhow::Result<Vec<u8>> {
        let mut inner = self.inner.lock().unwrap();

        // Check LRU cache first
        if let Some(bytes) = inner.lru.get(file_id, index) {
            return Ok(bytes);
        }

        // Read from source
        let bytes = Self::read_from_source(&mut inner, file_id, index)?;

        // Cache the result
        inner.lru.insert(file_id, index, bytes.clone());

        Ok(bytes)
    }

    /// Prefetch images around the current index in a background thread.
    pub fn prefetch(&self, file_id: &str, current_index: usize, total: usize) {
        let inner_arc = Arc::clone(&self.inner);
        let file_id = file_id.to_string();

        // Collect indices to prefetch
        let mut indices = Vec::new();
        for i in 1..=PREFETCH_AHEAD {
            if current_index + i < total {
                indices.push(current_index + i);
            }
        }
        for i in 1..=PREFETCH_BEHIND {
            if current_index >= i {
                indices.push(current_index - i);
            }
        }

        // Filter out already cached
        {
            let inner = inner_arc.lock().unwrap();
            indices.retain(|&idx| !inner.lru.contains(&file_id, idx));
        }

        if indices.is_empty() {
            return;
        }

        std::thread::spawn(move || {
            for idx in indices {
                let mut inner = inner_arc.lock().unwrap();
                // Double-check not cached (another thread might have added it)
                if inner.lru.contains(&file_id, idx) {
                    continue;
                }
                // Check source still registered (tab might have been closed)
                if !inner.sources.contains_key(&file_id) {
                    break;
                }
                match Self::read_from_source(&mut inner, &file_id, idx) {
                    Ok(bytes) => {
                        inner.lru.insert(&file_id, idx, bytes);
                    }
                    Err(_) => break,
                }
            }
        });
    }

    fn read_from_source(
        inner: &mut CacheInner,
        file_id: &str,
        index: usize,
    ) -> anyhow::Result<Vec<u8>> {
        let source = inner
            .sources
            .get(file_id)
            .ok_or_else(|| anyhow::anyhow!("Image source not registered: {}", file_id))?
            .clone();

        match source {
            ImageSourceInfo::Folder { image_paths } => {
                let path = image_paths
                    .get(index)
                    .ok_or_else(|| anyhow::anyhow!("Image index out of range: {}", index))?;
                std::fs::read(path).map_err(|e| anyhow::anyhow!("Failed to read image: {}", e))
            }
            ImageSourceInfo::Zip {
                ref zip_path,
                ref entry_names,
            } => {
                let entry_name = entry_names
                    .get(index)
                    .ok_or_else(|| anyhow::anyhow!("Image index out of range: {}", index))?;

                // Lazily open and cache ZipArchive handle on first access
                if !inner.zip_handles.contains_key(file_id) {
                    let file = std::fs::File::open(zip_path)?;
                    let archive = zip::ZipArchive::new(file)?;
                    inner
                        .zip_handles
                        .insert(file_id.to_string(), ZipHandle { archive });
                }

                let handle = inner.zip_handles.get_mut(file_id).unwrap();
                let mut entry = handle.archive.by_name(entry_name).map_err(|e| {
                    anyhow::anyhow!("ZIP entry not found: {} - {}", entry_name, e)
                })?;
                let mut buf = Vec::with_capacity(entry.size() as usize);
                entry.read_to_end(&mut buf)?;
                Ok(buf)
            }
        }
    }
}
