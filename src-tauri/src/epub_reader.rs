use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub struct ChapterInfo {
    pub index: usize,
    pub title: String,
}

#[derive(Debug, Clone)]
pub struct EpubChapter {
    pub title: String,
    pub html: String,
}

pub struct EpubBook {
    pub font_styles: String,
    pub chapters: Vec<EpubChapter>,
}

impl EpubBook {
    pub fn get_chapter_infos(&self) -> Vec<ChapterInfo> {
        self.chapters
            .iter()
            .enumerate()
            .map(|(i, ch)| ChapterInfo {
                index: i,
                title: ch.title.clone(),
            })
            .collect()
    }

    pub fn get_chapter_html(&self, index: usize) -> Option<String> {
        self.chapters.get(index).map(|ch| ch.html.clone())
    }

    pub fn total_chapters(&self) -> usize {
        self.chapters.len()
    }
}

// --- Font deobfuscation types ---

#[derive(Debug, Clone, PartialEq)]
enum ObfuscationAlgorithm {
    Idpf,  // http://www.idpf.org/2008/embedding
    Adobe, // http://ns.adobe.com/pdf/enc#RC
}

#[derive(Debug, Clone)]
struct EncryptionInfo {
    uri: String,
    algorithm: ObfuscationAlgorithm,
}

// --- Main parse function ---

pub fn parse_epub(path: &Path) -> anyhow::Result<EpubBook> {
    let mut doc = epub::doc::EpubDoc::new(path)
        .map_err(|e| anyhow::anyhow!("Failed to open EPUB: {}", e))?;

    // Get unique identifier for font deobfuscation
    let unique_id = get_unique_identifier(&doc);

    // Parse encryption.xml to find obfuscated fonts
    let encryption_infos = parse_encryption_xml(path);

    // Build image map: path -> base64 data URI (images only)
    let image_map = build_image_map(&mut doc);

    // Build font map: path -> base64 data URI (deobfuscated fonts)
    let font_map = build_font_map(&mut doc, &encryption_infos, unique_id.as_deref());

    // Build CSS map (no font data) and font_styles (@font-face with data URIs, stored once)
    let (css_map, font_styles) = build_css_and_font_styles(&mut doc, &image_map, &font_map);

    // Build TOC title lookup
    let toc_titles = build_toc_titles(&doc.toc);

    let num_chapters = doc.get_num_chapters();
    let mut chapters = Vec::new();

    for i in 0..num_chapters {
        doc.set_current_chapter(i);

        let current_path = {
            doc.spine
                .get(i)
                .and_then(|spine_item| doc.resources.get(&spine_item.idref))
                .map(|res| res.path.to_string_lossy().to_string())
        };

        if let Some((content, mime)) = doc.get_current_str() {
            if mime.contains("html") || mime.contains("xml") {
                let chapter_title = current_path
                    .as_ref()
                    .and_then(|p| find_toc_title(p, &toc_titles))
                    .unwrap_or_else(|| format!("Chapter {}", chapters.len() + 1));

                let base_path = current_path.as_deref().unwrap_or("");
                // Process with image_map only (no font data in per-chapter HTML)
                let processed_html =
                    process_chapter_html(&content, base_path, &image_map, &css_map);

                chapters.push(EpubChapter {
                    title: chapter_title,
                    html: processed_html,
                });
            }
        }
    }

    if chapters.is_empty() {
        anyhow::bail!("No readable chapters found in EPUB");
    }

    Ok(EpubBook {
        font_styles,
        chapters,
    })
}

// --- Unique identifier ---

fn get_unique_identifier(
    doc: &epub::doc::EpubDoc<std::io::BufReader<std::fs::File>>,
) -> Option<String> {
    let uid = doc.unique_identifier.as_ref().filter(|s| !s.is_empty());
    if let Some(id) = uid {
        return Some(id.clone());
    }
    doc.mdata("identifier").map(|m| m.value.clone())
}

// --- encryption.xml parsing ---

fn parse_encryption_xml(path: &Path) -> Vec<EncryptionInfo> {
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };
    let mut archive = match zip::ZipArchive::new(file) {
        Ok(a) => a,
        Err(_) => return Vec::new(),
    };
    let mut enc_file = match archive.by_name("META-INF/encryption.xml") {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };

    let mut content = String::new();
    if std::io::Read::read_to_string(&mut enc_file, &mut content).is_err() {
        return Vec::new();
    }

    let mut infos = Vec::new();

    let block_re = regex::Regex::new(
        r"(?s)<(?:\w+:)?EncryptedData[^>]*>(.*?)</(?:\w+:)?EncryptedData>",
    )
    .unwrap();
    let algo_re = regex::Regex::new(r#"(?i)Algorithm\s*=\s*["']([^"']+)["']"#).unwrap();
    let uri_re = regex::Regex::new(
        r#"(?i)<(?:\w+:)?CipherReference[^>]+URI\s*=\s*["']([^"']+)["']"#,
    )
    .unwrap();

    for block in block_re.captures_iter(&content) {
        let block_text = &block[1];

        let algorithm = if let Some(algo_caps) = algo_re.captures(block_text) {
            let algo_str = &algo_caps[1];
            if algo_str.contains("idpf.org/2008/embedding") {
                ObfuscationAlgorithm::Idpf
            } else if algo_str.contains("ns.adobe.com/pdf/enc") {
                ObfuscationAlgorithm::Adobe
            } else {
                continue;
            }
        } else {
            continue;
        };

        let uri = if let Some(uri_caps) = uri_re.captures(block_text) {
            percent_decode(&uri_caps[1])
        } else {
            continue;
        };

        infos.push(EncryptionInfo { uri, algorithm });
    }

    infos
}

fn percent_decode(s: &str) -> String {
    let re = regex::Regex::new(r"%([0-9a-fA-F]{2})").unwrap();
    re.replace_all(s, |caps: &regex::Captures| {
        let byte = u8::from_str_radix(&caps[1], 16).unwrap_or(b'?');
        String::from(byte as char)
    })
    .to_string()
}

// --- Font deobfuscation ---

fn deobfuscate_idpf(data: &mut [u8], unique_id: &str) {
    use sha1::Digest;

    let cleaned: String = unique_id.chars().filter(|c| !c.is_whitespace()).collect();

    let mut hasher = sha1::Sha1::new();
    hasher.update(cleaned.as_bytes());
    let key: [u8; 20] = hasher.finalize().into();

    let len = data.len().min(1040);
    for i in 0..len {
        data[i] ^= key[i % 20];
    }
}

fn deobfuscate_adobe(data: &mut [u8], unique_id: &str) {
    let hex_str: String = unique_id
        .trim_start_matches("urn:uuid:")
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect();

    if hex_str.len() < 32 {
        return;
    }

    let mut key = [0u8; 16];
    for i in 0..16 {
        key[i] = u8::from_str_radix(&hex_str[i * 2..i * 2 + 2], 16).unwrap_or(0);
    }

    let len = data.len().min(1024);
    for i in 0..len {
        data[i] ^= key[i % 16];
    }
}

fn is_font_mime(mime: &str) -> bool {
    mime.contains("font")
        || mime.contains("opentype")
        || mime.contains("truetype")
        || mime.contains("woff")
}

fn font_data_uri_mime(mime: &str) -> &str {
    if mime.contains("woff2") {
        "font/woff2"
    } else if mime.contains("woff") {
        "font/woff"
    } else if mime.contains("opentype") || mime.contains("otf") {
        "font/otf"
    } else {
        "font/ttf"
    }
}

// --- Resource map builders ---

fn build_image_map(
    doc: &mut epub::doc::EpubDoc<std::io::BufReader<std::fs::File>>,
) -> HashMap<String, String> {
    use base64::Engine;
    let mut map = HashMap::new();

    let image_resources: Vec<(String, String, String)> = doc
        .resources
        .iter()
        .filter(|(_, res)| res.mime.starts_with("image/"))
        .map(|(id, res)| {
            (
                id.clone(),
                res.path.to_string_lossy().to_string(),
                res.mime.clone(),
            )
        })
        .collect();

    for (id, path, mime) in image_resources {
        if let Some((data, _)) = doc.get_resource(&id) {
            let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
            let data_uri = format!("data:{};base64,{}", mime, b64);

            map.insert(path.clone(), data_uri.clone());
            if let Some(pos) = path.rfind('/') {
                map.insert(path[pos + 1..].to_string(), data_uri);
            }
        }
    }

    map
}

fn build_font_map(
    doc: &mut epub::doc::EpubDoc<std::io::BufReader<std::fs::File>>,
    encryption_infos: &[EncryptionInfo],
    unique_id: Option<&str>,
) -> HashMap<String, String> {
    use base64::Engine;
    let mut map = HashMap::new();

    let font_resources: Vec<(String, String, String)> = doc
        .resources
        .iter()
        .filter(|(_, res)| is_font_mime(&res.mime))
        .map(|(id, res)| {
            (
                id.clone(),
                res.path.to_string_lossy().to_string(),
                res.mime.clone(),
            )
        })
        .collect();

    for (id, path, mime) in font_resources {
        if let Some((mut data, _)) = doc.get_resource(&id) {
            if let Some(enc) = find_encryption_info(&path, encryption_infos) {
                if let Some(uid) = unique_id {
                    match enc.algorithm {
                        ObfuscationAlgorithm::Idpf => deobfuscate_idpf(&mut data, uid),
                        ObfuscationAlgorithm::Adobe => deobfuscate_adobe(&mut data, uid),
                    }
                }
            }

            let css_mime = font_data_uri_mime(&mime);
            let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
            let data_uri = format!("data:{};base64,{}", css_mime, b64);

            map.insert(path.clone(), data_uri.clone());
            if let Some(pos) = path.rfind('/') {
                map.insert(path[pos + 1..].to_string(), data_uri);
            }
        }
    }

    map
}

fn find_encryption_info<'a>(
    font_path: &str,
    infos: &'a [EncryptionInfo],
) -> Option<&'a EncryptionInfo> {
    infos.iter().find(|e| {
        e.uri == font_path
            || font_path.ends_with(&e.uri)
            || e.uri.ends_with(font_path)
            || {
                let enc_name = e.uri.rsplit('/').next().unwrap_or(&e.uri);
                let font_name = font_path.rsplit('/').next().unwrap_or(font_path);
                enc_name == font_name
            }
    })
}

/// Extract @font-face blocks from CSS. Returns (font_face_blocks, remaining_css).
fn extract_font_face_blocks(css: &str) -> (String, String) {
    let re = regex::Regex::new(r"(?s)@font-face\s*\{[^}]*\}").unwrap();
    let font_faces: String = re
        .find_iter(css)
        .map(|m| m.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let remaining = re.replace_all(css, "").to_string();
    (font_faces, remaining)
}

/// Build css_map (CSS without @font-face) and font_styles (@font-face with data URIs).
/// Font data is stored only in font_styles (once), not in per-chapter CSS.
fn build_css_and_font_styles(
    doc: &mut epub::doc::EpubDoc<std::io::BufReader<std::fs::File>>,
    image_map: &HashMap<String, String>,
    font_map: &HashMap<String, String>,
) -> (HashMap<String, String>, String) {
    let mut css_map = HashMap::new();
    let mut all_font_styles = String::new();

    let css_resources: Vec<(String, String)> = doc
        .resources
        .iter()
        .filter(|(_, res)| res.mime.contains("css"))
        .map(|(id, res)| (id.clone(), res.path.to_string_lossy().to_string()))
        .collect();

    // Build a combined map for @font-face url() replacement (images + fonts)
    let mut font_face_map = image_map.clone();
    font_face_map.extend(font_map.iter().map(|(k, v)| (k.clone(), v.clone())));

    for (id, path) in css_resources {
        if let Some((data, _)) = doc.get_resource(&id) {
            if let Ok(css_text) = String::from_utf8(data) {
                // Split: @font-face blocks -> font_styles, rest -> css_map
                let (font_faces, remaining) = extract_font_face_blocks(&css_text);

                if !font_faces.is_empty() {
                    // Replace url() in @font-face with font data URIs
                    let processed_fonts =
                        replace_css_urls(&font_faces, &path, &font_face_map);
                    all_font_styles.push_str(&processed_fonts);
                    all_font_styles.push('\n');
                }

                // Replace url() in remaining CSS with image-only data URIs
                let processed_remaining = replace_css_urls(&remaining, &path, image_map);
                css_map.insert(path.clone(), processed_remaining.clone());
                if let Some(pos) = path.rfind('/') {
                    css_map.insert(path[pos + 1..].to_string(), processed_remaining);
                }
            }
        }
    }

    (css_map, all_font_styles)
}

// --- CSS processing ---

fn replace_css_urls(
    css: &str,
    css_path: &str,
    resource_map: &HashMap<String, String>,
) -> String {
    let re = regex::Regex::new(r#"url\(\s*['"]?([^'")]+?)['"]?\s*\)"#).unwrap();

    re.replace_all(css, |caps: &regex::Captures| {
        let src = caps[1].trim();

        if src.starts_with("data:") {
            return caps[0].to_string();
        }

        let resolved = resolve_path(css_path, src);
        if let Some(data_uri) = find_in_resource_map(&resolved, src, resource_map) {
            format!("url(\"{}\")", data_uri)
        } else {
            caps[0].to_string()
        }
    })
    .to_string()
}

fn inline_linked_stylesheets(
    html: &str,
    chapter_path: &str,
    css_map: &HashMap<String, String>,
) -> String {
    let link_re = regex::Regex::new(r#"(?i)<link\b[^>]*>"#).unwrap();
    let rel_re = regex::Regex::new(r#"(?i)rel\s*=\s*["']stylesheet["']"#).unwrap();
    let href_re = regex::Regex::new(r#"(?i)href\s*=\s*["']([^"']+)["']"#).unwrap();

    link_re
        .replace_all(html, |caps: &regex::Captures| {
            let tag = &caps[0];

            if !rel_re.is_match(tag) {
                return tag.to_string();
            }

            if let Some(href_caps) = href_re.captures(tag) {
                let href = &href_caps[1];
                let resolved = resolve_path(chapter_path, href);

                if let Some(css_content) = find_in_resource_map(&resolved, href, css_map) {
                    return format!("<style>{}</style>", css_content);
                }
            }

            tag.to_string()
        })
        .to_string()
}

// --- Chapter HTML processing ---

fn process_chapter_html(
    html: &str,
    chapter_path: &str,
    image_map: &HashMap<String, String>,
    css_map: &HashMap<String, String>,
) -> String {
    // Step 1: Inline linked stylesheets (css_map has NO font data)
    let html_with_css = inline_linked_stylesheets(html, chapter_path, css_map);

    // Step 2: Extract body content
    let body = extract_body_content(&html_with_css);

    // Step 3: Extract all style blocks
    let styles = extract_head_styles(&html_with_css);

    // Step 4: Strip any inline @font-face (handled globally via font_styles)
    let (_, styles_no_fonts) = extract_font_face_blocks(&styles);

    // Step 5: Replace image url() in remaining styles
    let processed_styles = replace_css_urls(&styles_no_fonts, chapter_path, image_map);

    // Step 6: Replace image sources in body
    let processed_body = replace_image_sources(&body, chapter_path, image_map);

    if processed_styles.trim().is_empty() {
        processed_body
    } else {
        format!("<style>{}</style>\n{}", processed_styles, processed_body)
    }
}

fn extract_body_content(html: &str) -> String {
    let lower = html.to_lowercase();
    if let Some(body_start) = lower.find("<body") {
        if let Some(tag_end) = html[body_start..].find('>') {
            let content_start = body_start + tag_end + 1;
            if let Some(body_end) = lower.find("</body>") {
                return html[content_start..body_end].trim().to_string();
            }
            return html[content_start..].trim().to_string();
        }
    }
    html.to_string()
}

fn extract_head_styles(html: &str) -> String {
    let mut styles = String::new();
    let lower = html.to_lowercase();
    let mut search_start = 0;

    while let Some(style_start) = lower[search_start..].find("<style") {
        let abs_start = search_start + style_start;
        if let Some(tag_end) = html[abs_start..].find('>') {
            let content_start = abs_start + tag_end + 1;
            if let Some(style_end) = lower[content_start..].find("</style>") {
                let abs_end = content_start + style_end;
                styles.push_str(&html[content_start..abs_end]);
                styles.push('\n');
                search_start = abs_end + 8;
                continue;
            }
        }
        break;
    }

    styles
}

fn replace_image_sources(
    html: &str,
    chapter_path: &str,
    image_map: &HashMap<String, String>,
) -> String {
    let re =
        regex::Regex::new(r#"(?i)((?:src|xlink:href)\s*=\s*["'])([^"']+)(["'])"#).unwrap();

    re.replace_all(html, |caps: &regex::Captures| {
        let prefix = &caps[1];
        let src = &caps[2];
        let suffix = &caps[3];

        if src.starts_with("data:") {
            return caps[0].to_string();
        }

        let resolved = resolve_path(chapter_path, src);
        if let Some(data_uri) = find_in_resource_map(&resolved, src, image_map) {
            format!("{}{}{}", prefix, data_uri, suffix)
        } else {
            caps[0].to_string()
        }
    })
    .to_string()
}

// --- TOC helpers ---

fn build_toc_titles(toc: &[epub::doc::NavPoint]) -> HashMap<String, String> {
    let mut titles = HashMap::new();
    collect_toc_titles(toc, &mut titles);
    titles
}

fn collect_toc_titles(navpoints: &[epub::doc::NavPoint], titles: &mut HashMap<String, String>) {
    for nav in navpoints {
        let content_path = nav.content.to_string_lossy().to_string();
        let clean_path = content_path
            .split('#')
            .next()
            .unwrap_or(&content_path)
            .to_string();
        if !titles.contains_key(&clean_path) {
            titles.insert(clean_path, nav.label.clone());
        }
        if !nav.children.is_empty() {
            collect_toc_titles(&nav.children, titles);
        }
    }
}

fn find_toc_title(resource_path: &str, toc_titles: &HashMap<String, String>) -> Option<String> {
    if let Some(title) = toc_titles.get(resource_path) {
        return Some(title.clone());
    }

    for (toc_path, title) in toc_titles {
        if resource_path.ends_with(toc_path.as_str()) || toc_path.ends_with(resource_path) {
            return Some(title.clone());
        }
    }

    None
}

// --- Path resolution & resource lookup ---

fn resolve_path(base: &str, relative: &str) -> String {
    if relative.starts_with('/') {
        return relative[1..].to_string();
    }

    let base_dir = base.rfind('/').map(|i| &base[..i]).unwrap_or("");

    let mut parts: Vec<&str> = base_dir.split('/').filter(|s| !s.is_empty()).collect();

    for component in relative.split('/') {
        match component {
            ".." => {
                parts.pop();
            }
            "." | "" => {}
            other => parts.push(other),
        }
    }

    parts.join("/")
}

fn find_in_resource_map(
    resolved_path: &str,
    original_src: &str,
    resource_map: &HashMap<String, String>,
) -> Option<String> {
    if let Some(uri) = resource_map.get(resolved_path) {
        return Some(uri.clone());
    }

    if let Some(uri) = resource_map.get(original_src) {
        return Some(uri.clone());
    }

    let filename = original_src.rsplit('/').next().unwrap_or(original_src);
    if let Some(uri) = resource_map.get(filename) {
        return Some(uri.clone());
    }

    for (key, uri) in resource_map {
        if key.ends_with(filename) || resolved_path.ends_with(key.as_str()) {
            return Some(uri.clone());
        }
    }

    None
}

