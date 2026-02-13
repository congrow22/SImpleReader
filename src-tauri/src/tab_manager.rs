use crate::epub_reader::EpubBook;
use crate::text_buffer::TextBuffer;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;

pub enum FileType {
    Text,
    Epub,
    Pdf,
}

pub struct Tab {
    pub path: PathBuf,
    pub buffer: Option<TextBuffer>,
    pub epub_book: Option<EpubBook>,
    pub last_position: usize,
    pub is_modified: bool,
    pub file_type: FileType,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub total_lines: usize,
    pub total_chars: usize,
    pub last_position: usize,
    pub is_modified: bool,
    pub file_type: String,
    pub total_chapters: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct TabInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_active: bool,
    pub is_modified: bool,
    pub file_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TextChunk {
    pub lines: Vec<String>,
    pub start_line: usize,
    pub end_line: usize,
    pub total_lines: usize,
}

pub struct TabManager {
    tabs: HashMap<String, Tab>,
    pub active_tab: Option<String>,
}

impl TabManager {
    pub fn new() -> Self {
        Self {
            tabs: HashMap::new(),
            active_tab: None,
        }
    }

    /// Open a file in a new tab (or switch to it if already open).
    /// Returns FileInfo about the opened file.
    pub fn open_file(&mut self, path: &str, last_position: usize) -> anyhow::Result<FileInfo> {
        // If already open, just switch to it
        if self.tabs.contains_key(path) {
            return self.switch_tab(path);
        }

        let file_path = PathBuf::from(path);
        if !file_path.exists() {
            anyhow::bail!("File not found: {}", path);
        }

        let ext = file_path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        if ext == "epub" {
            self.open_epub(path, &file_path, last_position)
        } else if ext == "pdf" {
            self.open_pdf(path, &file_path, last_position)
        } else {
            self.open_text(path, &file_path, last_position)
        }
    }

    fn open_text(
        &mut self,
        path: &str,
        file_path: &PathBuf,
        last_position: usize,
    ) -> anyhow::Result<FileInfo> {
        let buffer = TextBuffer::from_file(file_path)?;
        let total_lines = buffer.get_total_lines();
        let total_chars = buffer.get_total_chars();

        let tab = Tab {
            path: file_path.clone(),
            buffer: Some(buffer),
            epub_book: None,
            last_position,
            is_modified: false,
            file_type: FileType::Text,
        };

        let file_name = file_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string());

        self.tabs.insert(path.to_string(), tab);
        self.active_tab = Some(path.to_string());

        Ok(FileInfo {
            id: path.to_string(),
            name: file_name,
            path: path.to_string(),
            total_lines,
            total_chars,
            last_position,
            is_modified: false,
            file_type: "text".to_string(),
            total_chapters: 0,
        })
    }

    fn open_epub(
        &mut self,
        path: &str,
        file_path: &PathBuf,
        last_position: usize,
    ) -> anyhow::Result<FileInfo> {
        let epub_book = crate::epub_reader::parse_epub(file_path)?;
        let total_chapters = epub_book.total_chapters();

        let file_name = file_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string());

        let tab = Tab {
            path: file_path.clone(),
            buffer: None,
            epub_book: Some(epub_book),
            last_position,
            is_modified: false,
            file_type: FileType::Epub,
        };

        self.tabs.insert(path.to_string(), tab);
        self.active_tab = Some(path.to_string());

        Ok(FileInfo {
            id: path.to_string(),
            name: file_name,
            path: path.to_string(),
            total_lines: 0,
            total_chars: 0,
            last_position,
            is_modified: false,
            file_type: "epub".to_string(),
            total_chapters,
        })
    }

    fn open_pdf(
        &mut self,
        path: &str,
        file_path: &PathBuf,
        last_position: usize,
    ) -> anyhow::Result<FileInfo> {
        let file_name = file_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string());

        let tab = Tab {
            path: file_path.clone(),
            buffer: None,
            epub_book: None,
            last_position,
            is_modified: false,
            file_type: FileType::Pdf,
        };

        self.tabs.insert(path.to_string(), tab);
        self.active_tab = Some(path.to_string());

        Ok(FileInfo {
            id: path.to_string(),
            name: file_name,
            path: path.to_string(),
            total_lines: 0,
            total_chars: 0,
            last_position,
            is_modified: false,
            file_type: "pdf".to_string(),
            total_chapters: 0,
        })
    }

    /// Close a tab. Returns the last_position so caller can persist it.
    pub fn close_tab(&mut self, id: &str) -> anyhow::Result<usize> {
        let tab = self
            .tabs
            .remove(id)
            .ok_or_else(|| anyhow::anyhow!("Tab not found: {}", id))?;

        let last_position = tab.last_position;

        // If we closed the active tab, pick another one
        if self.active_tab.as_deref() == Some(id) {
            self.active_tab = self.tabs.keys().next().cloned();
        }

        Ok(last_position)
    }

    /// Switch to an existing tab, lazy-loading the rope if it was unloaded.
    pub fn switch_tab(&mut self, id: &str) -> anyhow::Result<FileInfo> {
        // Unload rope from the previously active tab to save memory (text only)
        if let Some(prev_id) = &self.active_tab {
            if prev_id != id {
                let prev_id_clone = prev_id.clone();
                if let Some(prev_tab) = self.tabs.get_mut(&prev_id_clone) {
                    if matches!(prev_tab.file_type, FileType::Text) && !prev_tab.is_modified {
                        prev_tab.buffer = None;
                    }
                }
            }
        }

        let tab = self
            .tabs
            .get_mut(id)
            .ok_or_else(|| anyhow::anyhow!("Tab not found: {}", id))?;

        // Lazy-load rope if needed (text files only)
        if matches!(tab.file_type, FileType::Text) && tab.buffer.is_none() {
            tab.buffer = Some(TextBuffer::from_file(&tab.path)?);
        }

        let (total_lines, total_chars, total_chapters, file_type_str) = match tab.file_type {
            FileType::Text => {
                let buffer = tab.buffer.as_ref().unwrap();
                (
                    buffer.get_total_lines(),
                    buffer.get_total_chars(),
                    0,
                    "text".to_string(),
                )
            }
            FileType::Epub => {
                let chapters = tab
                    .epub_book
                    .as_ref()
                    .map(|b| b.total_chapters())
                    .unwrap_or(0);
                (0, 0, chapters, "epub".to_string())
            }
            FileType::Pdf => (0, 0, 0, "pdf".to_string()),
        };

        let last_position = tab.last_position;
        let is_modified = tab.is_modified;
        let path_str = tab.path.to_string_lossy().to_string();
        let name = tab
            .path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path_str.clone());

        self.active_tab = Some(id.to_string());

        Ok(FileInfo {
            id: id.to_string(),
            name,
            path: path_str,
            total_lines,
            total_chars,
            last_position,
            is_modified,
            file_type: file_type_str,
            total_chapters,
        })
    }

    /// Get info about all open tabs.
    pub fn get_open_tabs(&self) -> Vec<TabInfo> {
        self.tabs
            .iter()
            .map(|(id, tab)| {
                let name = tab
                    .path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| id.clone());
                let file_type = match tab.file_type {
                    FileType::Text => "text",
                    FileType::Epub => "epub",
                    FileType::Pdf => "pdf",
                };
                TabInfo {
                    id: id.clone(),
                    name,
                    path: tab.path.to_string_lossy().to_string(),
                    is_active: self.active_tab.as_deref() == Some(id.as_str()),
                    is_modified: tab.is_modified,
                    file_type: file_type.to_string(),
                }
            })
            .collect()
    }

    /// Get a text chunk from the active (or specified) tab.
    pub fn get_text_chunk(
        &self,
        file_id: &str,
        start_line: usize,
        end_line: usize,
    ) -> anyhow::Result<TextChunk> {
        let tab = self
            .tabs
            .get(file_id)
            .ok_or_else(|| anyhow::anyhow!("Tab not found: {}", file_id))?;
        let buffer = tab
            .buffer
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Buffer not loaded for tab: {}", file_id))?;

        let total_lines = buffer.get_total_lines();
        let actual_end = end_line.min(total_lines);
        let lines = buffer.get_chunk(start_line, actual_end);

        Ok(TextChunk {
            lines,
            start_line,
            end_line: actual_end,
            total_lines,
        })
    }

    /// Get total lines for a file.
    pub fn get_total_lines(&self, file_id: &str) -> anyhow::Result<usize> {
        let tab = self
            .tabs
            .get(file_id)
            .ok_or_else(|| anyhow::anyhow!("Tab not found: {}", file_id))?;
        let buffer = tab
            .buffer
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Buffer not loaded for tab: {}", file_id))?;
        Ok(buffer.get_total_lines())
    }

    /// Get a mutable reference to a tab's buffer.
    pub fn get_buffer_mut(&mut self, file_id: &str) -> anyhow::Result<&mut TextBuffer> {
        let tab = self
            .tabs
            .get_mut(file_id)
            .ok_or_else(|| anyhow::anyhow!("Tab not found: {}", file_id))?;
        tab.buffer
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("Buffer not loaded for tab: {}", file_id))
    }

    /// Get an immutable reference to a tab's buffer.
    pub fn get_buffer(&self, file_id: &str) -> anyhow::Result<&TextBuffer> {
        let tab = self
            .tabs
            .get(file_id)
            .ok_or_else(|| anyhow::anyhow!("Tab not found: {}", file_id))?;
        tab.buffer
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Buffer not loaded for tab: {}", file_id))
    }

    /// Mark a tab as modified.
    pub fn set_modified(&mut self, file_id: &str, modified: bool) {
        if let Some(tab) = self.tabs.get_mut(file_id) {
            tab.is_modified = modified;
        }
    }

    /// Save the file for a tab.
    pub fn save_file(&mut self, file_id: &str) -> anyhow::Result<()> {
        let tab = self
            .tabs
            .get_mut(file_id)
            .ok_or_else(|| anyhow::anyhow!("Tab not found: {}", file_id))?;
        let path = tab.path.clone();
        if let Some(buffer) = tab.buffer.as_mut() {
            buffer.save(&path)?;
            tab.is_modified = false;
        } else {
            anyhow::bail!("Buffer not loaded for tab: {}", file_id);
        }
        Ok(())
    }

    /// Update the last reading position for a tab.
    pub fn set_last_position(&mut self, file_id: &str, position: usize) {
        if let Some(tab) = self.tabs.get_mut(file_id) {
            tab.last_position = position;
        }
    }

    /// Get the file path for a tab.
    pub fn get_file_path(&self, file_id: &str) -> anyhow::Result<PathBuf> {
        let tab = self
            .tabs
            .get(file_id)
            .ok_or_else(|| anyhow::anyhow!("Tab not found: {}", file_id))?;
        Ok(tab.path.clone())
    }

    /// Get EPUB chapter HTML by index.
    pub fn get_epub_chapter_html(
        &self,
        file_id: &str,
        chapter_index: usize,
    ) -> anyhow::Result<String> {
        let tab = self
            .tabs
            .get(file_id)
            .ok_or_else(|| anyhow::anyhow!("Tab not found: {}", file_id))?;
        let epub_book = tab
            .epub_book
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Not an EPUB file: {}", file_id))?;
        epub_book
            .get_chapter_html(chapter_index)
            .ok_or_else(|| anyhow::anyhow!("Chapter {} not found", chapter_index))
    }

    /// Get EPUB font styles (@font-face CSS).
    pub fn get_epub_font_styles(&self, file_id: &str) -> anyhow::Result<String> {
        let tab = self
            .tabs
            .get(file_id)
            .ok_or_else(|| anyhow::anyhow!("Tab not found: {}", file_id))?;
        let epub_book = tab
            .epub_book
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Not an EPUB file: {}", file_id))?;
        Ok(epub_book.font_styles.clone())
    }

    /// Get EPUB chapter info list.
    pub fn get_epub_chapter_infos(
        &self,
        file_id: &str,
    ) -> anyhow::Result<Vec<crate::epub_reader::ChapterInfo>> {
        let tab = self
            .tabs
            .get(file_id)
            .ok_or_else(|| anyhow::anyhow!("Tab not found: {}", file_id))?;
        let epub_book = tab
            .epub_book
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Not an EPUB file: {}", file_id))?;
        Ok(epub_book.get_chapter_infos())
    }
}
