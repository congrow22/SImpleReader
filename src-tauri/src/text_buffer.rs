use ropey::Rope;
use std::path::Path;

#[derive(Debug, Clone)]
pub enum EditOperation {
    Insert { position: usize, text: String },
    Delete { position: usize, text: String },
}

pub struct TextBuffer {
    rope: Rope,
    undo_stack: Vec<EditOperation>,
    redo_stack: Vec<EditOperation>,
    pub is_modified: bool,
}

impl TextBuffer {
    /// Create a new TextBuffer by loading a file from disk.
    pub fn from_file(path: &Path) -> anyhow::Result<Self> {
        let rope = Rope::from_reader(std::io::BufReader::new(std::fs::File::open(path)?))?;
        Ok(Self {
            rope,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            is_modified: false,
        })
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

    /// Insert text at a character position.
    pub fn insert_text(&mut self, char_pos: usize, text: &str) {
        let pos = char_pos.min(self.rope.len_chars());
        self.rope.insert(pos, text);
        self.undo_stack.push(EditOperation::Insert {
            position: pos,
            text: text.to_string(),
        });
        self.redo_stack.clear();
        self.is_modified = true;
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
        self.undo_stack.push(EditOperation::Delete {
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
        self.undo_stack.push(EditOperation::Delete {
            position: 0,
            text: old_text,
        });
        self.undo_stack.push(EditOperation::Insert {
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
