use ropey::Rope;
use std::path::Path;
use chardetng::EncodingDetector;
use encoding_rs::Encoding;

#[derive(Debug, Clone)]
pub enum EditOperation {
    Insert { position: usize, text: String },
    Delete { position: usize, text: String },
    Replace { position: usize, old_text: String, new_text: String },
}

const MAX_UNDO: usize = 100;

pub struct TextBuffer {
    rope: Rope,
    undo_stack: Vec<EditOperation>,
    redo_stack: Vec<EditOperation>,
    pub is_modified: bool,
}

impl TextBuffer {
    /// Create a new TextBuffer by loading a file from disk.
    /// 인코딩을 자동 감지하여 UTF-8로 변환합니다 (CP949, Shift_JIS, Big5 등 지원).
    pub fn from_file(path: &Path) -> anyhow::Result<Self> {
        let raw_bytes = std::fs::read(path)?;

        // UTF-8 BOM 체크
        let bytes = if raw_bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
            &raw_bytes[3..]
        } else {
            &raw_bytes
        };

        // UTF-8로 먼저 시도
        let text = match std::str::from_utf8(bytes) {
            Ok(s) => s.to_string(),
            Err(_) => {
                // 자동 인코딩 감지
                let mut detector = EncodingDetector::new();
                detector.feed(bytes, true);
                let encoding = detector.guess(None, true);
                let (decoded, _, had_errors) = encoding.decode(bytes);
                if had_errors {
                    // 최후 수단: 손실 허용하여 디코딩
                    let (decoded, _, _) = Encoding::for_label(b"euc-kr")
                        .unwrap_or(encoding_rs::WINDOWS_1252)
                        .decode(bytes);
                    decoded.into_owned()
                } else {
                    decoded.into_owned()
                }
            }
        };

        let rope = Rope::from_str(&text);
        Ok(Self {
            rope,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            is_modified: false,
        })
    }

    /// Create a TextBuffer from a string (used for EPUB text content).
    pub fn from_string(text: &str) -> Self {
        Self {
            rope: Rope::from_str(text),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            is_modified: false,
        }
    }

    /// Create an empty TextBuffer.
    pub fn new() -> Self {
        Self {
            rope: Rope::new(),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            is_modified: false,
        }
    }

    /// Get a chunk of lines for virtual scrolling.
    /// Returns lines from start_line (inclusive) to end_line (exclusive).
    pub fn get_chunk(&self, start_line: usize, end_line: usize) -> Vec<String> {
        let total = self.rope.len_lines();
        let start = start_line.min(total);
        let end = end_line.min(total);

        let mut lines = Vec::with_capacity(end.saturating_sub(start));
        for i in start..end {
            let line = self.rope.line(i);
            lines.push(line.to_string());
        }
        lines
    }

    fn push_undo(&mut self, op: EditOperation) {
        self.undo_stack.push(op);
        if self.undo_stack.len() > MAX_UNDO {
            self.undo_stack.drain(0..self.undo_stack.len() - MAX_UNDO);
        }
    }

    /// Insert text at a character position.
    pub fn insert_text(&mut self, char_pos: usize, text: &str) {
        let pos = char_pos.min(self.rope.len_chars());
        self.rope.insert(pos, text);
        self.push_undo(EditOperation::Insert {
            position: pos,
            text: text.to_string(),
        });
        self.redo_stack.clear();
        self.is_modified = true;
    }

    /// Replace the content of a specific line (preserving line ending).
    pub fn replace_line(&mut self, line_idx: usize, new_text: &str) -> bool {
        let total_lines = self.rope.len_lines();
        if line_idx >= total_lines {
            return false;
        }

        let start_char = self.rope.line_to_char(line_idx);
        let line = self.rope.line(line_idx);
        let line_str = line.to_string();
        let line_len = line.len_chars();

        // Determine content length (excluding trailing newline)
        let content_len = if line_str.ends_with("\r\n") {
            line_len.saturating_sub(2)
        } else if line_str.ends_with('\n') || line_str.ends_with('\r') {
            line_len.saturating_sub(1)
        } else {
            line_len // last line without newline
        };

        let end_char = start_char + content_len;
        let old_text = self.rope.slice(start_char..end_char).to_string();

        // Strip trailing newlines from new_text
        let new_text_clean = new_text.trim_end_matches(|c: char| c == '\n' || c == '\r');

        // Remove old content, insert new
        if start_char < end_char {
            self.rope.remove(start_char..end_char);
        }
        if !new_text_clean.is_empty() {
            self.rope.insert(start_char, new_text_clean);
        }

        self.push_undo(EditOperation::Replace {
            position: start_char,
            old_text,
            new_text: new_text_clean.to_string(),
        });
        self.redo_stack.clear();
        self.is_modified = true;
        true
    }

    /// Delete text from start_char (inclusive) to end_char (exclusive).
    pub fn delete_text(&mut self, start_char: usize, end_char: usize) {
        let total = self.rope.len_chars();
        let start = start_char.min(total);
        let end = end_char.min(total);
        if start >= end {
            return;
        }
        let deleted = self.rope.slice(start..end).to_string();
        self.rope.remove(start..end);
        self.push_undo(EditOperation::Delete {
            position: start,
            text: deleted,
        });
        self.redo_stack.clear();
        self.is_modified = true;
    }

    /// Undo the last edit operation.
    pub fn undo(&mut self) -> bool {
        if let Some(op) = self.undo_stack.pop() {
            match &op {
                EditOperation::Insert { position, text } => {
                    let end = *position + text.chars().count();
                    self.rope.remove(*position..end);
                }
                EditOperation::Delete { position, text } => {
                    self.rope.insert(*position, text);
                }
                EditOperation::Replace { position, old_text, new_text } => {
                    let end = *position + new_text.chars().count();
                    self.rope.remove(*position..end);
                    self.rope.insert(*position, old_text);
                }
            }
            self.redo_stack.push(op);
            self.is_modified = !self.undo_stack.is_empty();
            true
        } else {
            false
        }
    }

    /// Redo the last undone edit operation.
    pub fn redo(&mut self) -> bool {
        if let Some(op) = self.redo_stack.pop() {
            match &op {
                EditOperation::Insert { position, text } => {
                    self.rope.insert(*position, text);
                }
                EditOperation::Delete { position, text } => {
                    let end = *position + text.chars().count();
                    self.rope.remove(*position..end);
                }
                EditOperation::Replace { position, old_text, new_text } => {
                    let end = *position + old_text.chars().count();
                    self.rope.remove(*position..end);
                    self.rope.insert(*position, new_text);
                }
            }
            self.undo_stack.push(op);
            self.is_modified = true;
            true
        } else {
            false
        }
    }

    /// Save the rope contents to a file.
    pub fn save(&mut self, path: &Path) -> anyhow::Result<()> {
        let writer = std::io::BufWriter::new(std::fs::File::create(path)?);
        self.rope.write_to(writer)?;
        self.is_modified = false;
        // Clear undo/redo after save
        self.undo_stack.clear();
        self.redo_stack.clear();
        Ok(())
    }

    /// Get total number of lines.
    pub fn get_total_lines(&self) -> usize {
        self.rope.len_lines()
    }

    /// Get total number of characters.
    pub fn get_total_chars(&self) -> usize {
        self.rope.len_chars()
    }

    /// Get a reference to the underlying Rope.
    pub fn rope(&self) -> &Rope {
        &self.rope
    }

    /// Get a mutable reference to the underlying Rope.
    pub fn rope_mut(&mut self) -> &mut Rope {
        &mut self.rope
    }

    /// Replace the entire rope content (used by formatter).
    pub fn replace_all(&mut self, new_text: &str) {
        let old_text = self.rope.to_string();
        self.rope = Rope::from_str(new_text);
        self.push_undo(EditOperation::Delete {
            position: 0,
            text: old_text,
        });
        self.push_undo(EditOperation::Insert {
            position: 0,
            text: new_text.to_string(),
        });
        self.redo_stack.clear();
        self.is_modified = true;
    }

    /// Get the full text as a String.
    pub fn to_string_full(&self) -> String {
        self.rope.to_string()
    }
}
