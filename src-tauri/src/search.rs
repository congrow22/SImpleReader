use ropey::Rope;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SearchMatch {
    pub line: usize,
    pub char_start: usize,
    pub char_end: usize,
    pub line_char_start: usize,
    pub line_char_end: usize,
    pub context: String,
}

/// Count UTF-16 code units for a string (matches JavaScript's string indexing).
fn utf16_len(s: &str) -> usize {
    s.chars().map(|c| c.len_utf16()).sum()
}

/// Search for all occurrences of a query in a Rope.
/// Searches line-by-line to avoid byte/char position mismatches.
/// line_char_start/line_char_end use UTF-16 code unit offsets (for JS compatibility).
pub fn search_in_rope(rope: &Rope, query: &str, case_sensitive: bool) -> Vec<SearchMatch> {
    if query.is_empty() {
        return Vec::new();
    }

    let mut results = Vec::new();
    let search_query = if case_sensitive {
        query.to_string()
    } else {
        query.to_lowercase()
    };
    let query_chars = query.chars().count();
    let query_utf16_len = utf16_len(query);

    let mut global_char_offset: usize = 0;

    for line_idx in 0..rope.len_lines() {
        let line = rope.line(line_idx);
        let line_text = line.to_string();
        let search_line = if case_sensitive {
            line_text.clone()
        } else {
            line_text.to_lowercase()
        };

        let mut byte_start = 0;
        while let Some(byte_pos) = search_line[byte_start..].find(&search_query) {
            let abs_byte_pos = byte_start + byte_pos;
            // Count Unicode chars for Rope operations (char_start/char_end)
            let line_char_start_unicode = line_text[..abs_byte_pos].chars().count();

            // Count UTF-16 code units for JS substring (line_char_start/line_char_end)
            let line_char_start = utf16_len(&line_text[..abs_byte_pos]);
            let line_char_end = line_char_start + query_utf16_len;

            let char_start = global_char_offset + line_char_start_unicode;
            let char_end = char_start + query_chars;

            let context = line_text
                .trim_end_matches('\n')
                .trim_end_matches('\r')
                .to_string();

            results.push(SearchMatch {
                line: line_idx,
                char_start,
                char_end,
                line_char_start,
                line_char_end,
                context,
            });

            byte_start = abs_byte_pos + search_query.len();
        }

        global_char_offset += line_text.chars().count();
    }

    results
}

/// Replace the next occurrence of query after the given char position.
/// Returns the char position where the replacement was made, or None.
pub fn replace_next(
    rope: &mut Rope,
    query: &str,
    replacement: &str,
    from_position: usize,
    case_sensitive: bool,
) -> Option<usize> {
    if query.is_empty() {
        return None;
    }

    let text = rope.to_string();
    let search_text;
    let search_query;

    if case_sensitive {
        search_text = text.clone();
        search_query = query.to_string();
    } else {
        search_text = text.to_lowercase();
        search_query = query.to_lowercase();
    };

    // Convert from_position (char index) to byte index for searching
    let byte_start: usize = text.chars().take(from_position).map(|c| c.len_utf8()).sum();

    if let Some(byte_pos) = search_text[byte_start..].find(&search_query) {
        let abs_byte_pos = byte_start + byte_pos;
        let char_start = text[..abs_byte_pos].chars().count();
        let char_end = char_start + query.chars().count();

        rope.remove(char_start..char_end);
        rope.insert(char_start, replacement);

        Some(char_start)
    } else {
        None
    }
}

/// Replace all occurrences of query in the Rope.
/// Returns the number of replacements made.
/// String 기반 일괄 치환으로 O(n) 성능.
pub fn replace_all_in_rope(
    rope: &mut Rope,
    query: &str,
    replacement: &str,
    case_sensitive: bool,
) -> usize {
    if query.is_empty() {
        return 0;
    }

    let text = rope.to_string();
    let search_query = if case_sensitive {
        query.to_string()
    } else {
        query.to_lowercase()
    };

    // 매칭 위치를 한 번에 수집
    let search_text = if case_sensitive {
        text.clone()
    } else {
        text.to_lowercase()
    };

    let mut match_positions = Vec::new();
    let mut byte_start = 0;
    while let Some(byte_pos) = search_text[byte_start..].find(&search_query) {
        let abs_byte_pos = byte_start + byte_pos;
        match_positions.push(abs_byte_pos);
        byte_start = abs_byte_pos + query.len();
    }

    let count = match_positions.len();
    if count == 0 {
        return 0;
    }

    // String 상에서 한 번에 조립
    let mut result = String::with_capacity(text.len());
    let mut last_end = 0;
    for &pos in &match_positions {
        result.push_str(&text[last_end..pos]);
        result.push_str(replacement);
        last_end = pos + query.len();
    }
    result.push_str(&text[last_end..]);

    *rope = Rope::from_str(&result);
    count
}
