use ropey::Rope;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SearchMatch {
    pub line: usize,
    pub char_start: usize,
    pub char_end: usize,
    pub context: String,
}

/// Search for all occurrences of a query in a Rope.
pub fn search_in_rope(rope: &Rope, query: &str, case_sensitive: bool) -> Vec<SearchMatch> {
    if query.is_empty() {
        return Vec::new();
    }

    let mut results = Vec::new();
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

    let mut start = 0;
    while let Some(pos) = search_text[start..].find(&search_query) {
        let abs_pos = start + pos;
        // Convert byte position to char position
        let char_start = text[..abs_pos].chars().count();
        let char_end = char_start + query.chars().count();

        // Find the line number
        let line = rope.char_to_line(char_start);

        // Get context (the full line)
        let line_text = rope.line(line).to_string();
        let context = line_text.trim_end_matches('\n').to_string();

        results.push(SearchMatch {
            line,
            char_start,
            char_end,
            context,
        });

        start = abs_pos + search_query.len();
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
pub fn replace_all_in_rope(
    rope: &mut Rope,
    query: &str,
    replacement: &str,
    case_sensitive: bool,
) -> usize {
    if query.is_empty() {
        return 0;
    }

    let mut count = 0;
    let mut from_pos = 0;

    loop {
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

        let byte_start: usize = text.chars().take(from_pos).map(|c| c.len_utf8()).sum();

        if let Some(byte_pos) = search_text[byte_start..].find(&search_query) {
            let abs_byte_pos = byte_start + byte_pos;
            let char_start = text[..abs_byte_pos].chars().count();
            let char_end = char_start + query.chars().count();

            rope.remove(char_start..char_end);
            rope.insert(char_start, replacement);

            from_pos = char_start + replacement.chars().count();
            count += 1;
        } else {
            break;
        }
    }

    count
}
