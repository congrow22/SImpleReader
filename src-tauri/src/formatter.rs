/// Add newline after sentence-ending punctuation (. ? !).
/// Only adds a break if the sentence terminator is followed by a space and another character.
pub fn add_sentence_breaks(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();

    let mut i = 0;
    while i < len {
        let ch = chars[i];
        result.push(ch);

        // Check if this is a sentence-ending punctuation
        if (ch == '.' || ch == '?' || ch == '!') && i + 1 < len {
            // Look ahead: if followed by a space and then a non-whitespace char, add newline
            if chars[i + 1] == ' '
                && i + 2 < len && !chars[i + 2].is_whitespace() {
                    result.push('\n');
                    i += 2; // skip the space
                    continue;
            }
        }

        i += 1;
    }

    result
}

/// Compress multiple consecutive blank lines into a single blank line.
pub fn compress_blank_lines(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut prev_was_blank = false;
    let mut first = true;

    for line in text.split('\n') {
        let is_blank = line.trim().is_empty();

        if is_blank {
            if !prev_was_blank {
                if !first {
                    result.push('\n');
                }
                result.push('\n');
                prev_was_blank = true;
            }
            // Skip additional blank lines
        } else {
            if !first && !prev_was_blank {
                result.push('\n');
            }
            result.push_str(line);
            prev_was_blank = false;
        }
        first = false;
    }

    result
}

/// Remove all blank lines from the text.
pub fn remove_blank_lines(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut first = true;

    for line in text.split('\n') {
        if !line.trim().is_empty() {
            if !first {
                result.push('\n');
            }
            result.push_str(line);
            first = false;
        }
    }

    result
}

/// Apply a format operation by name to the given text.
pub fn apply_format(text: &str, format_type: &str) -> anyhow::Result<String> {
    match format_type {
        "sentence_breaks" => Ok(add_sentence_breaks(text)),
        "compress_blank_lines" => Ok(compress_blank_lines(text)),
        "remove_blank_lines" => Ok(remove_blank_lines(text)),
        _ => anyhow::bail!("Unknown format type: {}", format_type),
    }
}
