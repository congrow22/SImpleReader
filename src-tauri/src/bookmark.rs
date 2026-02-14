use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bookmark {
    pub position: usize,
    pub line: usize,
    pub memo: String,
    pub created: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileBookmarks {
    pub last_position: usize,
    pub last_opened: String,
    pub bookmarks: Vec<Bookmark>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub last_scroll_offset: usize,
    #[serde(default)]
    pub display_order: Option<usize>,
}

impl Default for FileBookmarks {
    fn default() -> Self {
        Self {
            last_position: 0,
            last_opened: chrono::Local::now().to_rfc3339(),
            bookmarks: Vec::new(),
            favorite: false,
            last_scroll_offset: 0,
            display_order: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BookmarkSearchResult {
    pub file_path: String,
    pub file_name: String,
    pub bookmark: Bookmark,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileListEntry {
    pub file_path: String,
    pub file_name: String,
    pub last_position: usize,
    pub last_opened: String,
    pub bookmark_count: usize,
    pub favorite: bool,
    pub display_order: Option<usize>,
}

pub struct BookmarkStore {
    data: HashMap<String, FileBookmarks>,
    store_path: PathBuf,
}

impl BookmarkStore {
    /// Create a new BookmarkStore, loading from disk if the file exists.
    pub fn new() -> anyhow::Result<Self> {
        let store_path = Self::default_path()?;
        let data = if store_path.exists() {
            let content = std::fs::read_to_string(&store_path)?;
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            HashMap::new()
        };
        Ok(Self { data, store_path })
    }

    fn default_path() -> anyhow::Result<PathBuf> {
        let home = dirs::home_dir()
            .ok_or_else(|| anyhow::anyhow!("Could not find home directory"))?;
        Ok(home.join(".simple-reader").join("books.json"))
    }

    /// Persist the bookmark data to disk.
    pub fn save_to_disk(&self) -> anyhow::Result<()> {
        if let Some(parent) = self.store_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(&self.data)?;
        std::fs::write(&self.store_path, content)?;
        Ok(())
    }

    /// Add a bookmark for a specific file.
    pub fn add_bookmark(
        &mut self,
        file_path: &str,
        position: usize,
        line: usize,
        memo: &str,
    ) -> anyhow::Result<()> {
        let entry = self
            .data
            .entry(file_path.to_string())
            .or_default();

        entry.bookmarks.push(Bookmark {
            position,
            line,
            memo: memo.to_string(),
            created: chrono::Local::now().to_rfc3339(),
        });
        self.save_to_disk()?;
        Ok(())
    }

    /// Remove a bookmark by index for a specific file.
    pub fn remove_bookmark(&mut self, file_path: &str, index: usize) -> anyhow::Result<()> {
        if let Some(entry) = self.data.get_mut(file_path) {
            if index < entry.bookmarks.len() {
                entry.bookmarks.remove(index);
                self.save_to_disk()?;
            } else {
                anyhow::bail!("Bookmark index out of range");
            }
        } else {
            anyhow::bail!("No bookmarks found for file: {}", file_path);
        }
        Ok(())
    }

    /// Get all bookmarks for a specific file.
    pub fn get_bookmarks(&self, file_path: &str) -> Vec<Bookmark> {
        self.data
            .get(file_path)
            .map(|entry| entry.bookmarks.clone())
            .unwrap_or_default()
    }

    /// Get all bookmarks for all files.
    pub fn get_all_bookmarks(&self) -> &HashMap<String, FileBookmarks> {
        &self.data
    }

    /// Search bookmarks by query string (matches filename and memo).
    pub fn search_bookmarks(&self, query: &str) -> Vec<BookmarkSearchResult> {
        let query_lower = query.to_lowercase();
        let mut results = Vec::new();

        for (file_path, file_bookmarks) in &self.data {
            let file_name = std::path::Path::new(file_path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let file_name_lower = file_name.to_lowercase();

            for bookmark in &file_bookmarks.bookmarks {
                let memo_lower = bookmark.memo.to_lowercase();
                if file_name_lower.contains(&query_lower) || memo_lower.contains(&query_lower) {
                    results.push(BookmarkSearchResult {
                        file_path: file_path.clone(),
                        file_name: file_name.clone(),
                        bookmark: bookmark.clone(),
                    });
                }
            }
        }
        results
    }

    /// Save the last reading position for a file (only if already tracked).
    pub fn save_last_position(&mut self, file_path: &str, position: usize, scroll_offset: usize) -> anyhow::Result<()> {
        if let Some(entry) = self.data.get_mut(file_path) {
            entry.last_position = position;
            entry.last_scroll_offset = scroll_offset;
            entry.last_opened = chrono::Local::now().to_rfc3339();
            self.save_to_disk()?;
        }
        Ok(())
    }

    /// Get the last reading position for a file.
    pub fn get_last_position(&self, file_path: &str) -> Option<(usize, usize)> {
        self.data.get(file_path).map(|entry| (entry.last_position, entry.last_scroll_offset))
    }

    /// Track a file being opened (creates entry if not exists, updates last_opened).
    pub fn track_file_open(&mut self, file_path: &str) -> anyhow::Result<()> {
        let entry = self
            .data
            .entry(file_path.to_string())
            .or_default();
        entry.last_opened = chrono::Local::now().to_rfc3339();
        self.save_to_disk()?;
        Ok(())
    }

    /// Get a list of all tracked files with metadata.
    pub fn get_file_list(&self) -> Vec<FileListEntry> {
        let mut entries: Vec<FileListEntry> = self
            .data
            .iter()
            .map(|(file_path, file_bookmarks)| {
                let file_name = std::path::Path::new(file_path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                FileListEntry {
                    file_path: file_path.clone(),
                    file_name,
                    last_position: file_bookmarks.last_position,
                    last_opened: file_bookmarks.last_opened.clone(),
                    bookmark_count: file_bookmarks.bookmarks.len(),
                    favorite: file_bookmarks.favorite,
                    display_order: file_bookmarks.display_order,
                }
            })
            .collect();
        // display_order가 있는 항목 우선(오름차순), 없으면 last_opened 내림차순
        entries.sort_by(|a, b| {
            match (a.display_order, b.display_order) {
                (Some(oa), Some(ob)) => oa.cmp(&ob),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => b.last_opened.cmp(&a.last_opened),
            }
        });
        entries
    }

    /// 파일 목록 순서 변경. ordered_paths 순서대로 display_order 설정.
    pub fn reorder_file_list(&mut self, ordered_paths: &[String]) -> anyhow::Result<()> {
        for (i, path) in ordered_paths.iter().enumerate() {
            if let Some(entry) = self.data.get_mut(path) {
                entry.display_order = Some(i);
            }
        }
        self.save_to_disk()
    }

    /// 책갈피 순서 변경 (from → to 위치로 이동).
    pub fn move_bookmark(&mut self, file_path: &str, from: usize, to: usize) -> anyhow::Result<()> {
        let entry = self.data.get_mut(file_path)
            .ok_or_else(|| anyhow::anyhow!("File not found: {}", file_path))?;
        if from >= entry.bookmarks.len() || to >= entry.bookmarks.len() {
            anyhow::bail!("Bookmark index out of range");
        }
        let item = entry.bookmarks.remove(from);
        entry.bookmarks.insert(to, item);
        self.save_to_disk()
    }

    /// Toggle favorite status for a file.
    pub fn toggle_favorite(&mut self, file_path: &str) -> anyhow::Result<bool> {
        let entry = self
            .data
            .entry(file_path.to_string())
            .or_default();
        entry.favorite = !entry.favorite;
        let new_state = entry.favorite;
        self.save_to_disk()?;
        Ok(new_state)
    }

    /// Remove a file entry and all its bookmarks.
    pub fn remove_file_entry(&mut self, file_path: &str) -> anyhow::Result<()> {
        self.data.remove(file_path);
        self.save_to_disk()?;
        Ok(())
    }
}
