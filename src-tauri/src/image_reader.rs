use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];

// ── Natural Sort ──

#[derive(Eq, PartialEq)]
enum SortChunk {
    Text(String),
    Num(u64),
}

impl Ord for SortChunk {
    fn cmp(&self, other: &Self) -> Ordering {
        match (self, other) {
            (SortChunk::Num(a), SortChunk::Num(b)) => a.cmp(b),
            (SortChunk::Text(a), SortChunk::Text(b)) => a.cmp(b),
            (SortChunk::Text(_), SortChunk::Num(_)) => Ordering::Less,
            (SortChunk::Num(_), SortChunk::Text(_)) => Ordering::Greater,
        }
    }
}

impl PartialOrd for SortChunk {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn natural_sort_key(s: &str) -> Vec<SortChunk> {
    let mut chunks = Vec::new();
    let lower = s.to_lowercase();
    let mut chars = lower.char_indices().peekable();

    while chars.peek().is_some() {
        let (start, ch) = *chars.peek().unwrap();
        if ch.is_ascii_digit() {
            while chars.peek().map_or(false, |(_, c)| c.is_ascii_digit()) {
                chars.next();
            }
            let end = chars.peek().map_or(lower.len(), |(i, _)| *i);
            chunks.push(SortChunk::Num(lower[start..end].parse().unwrap_or(0)));
        } else {
            chars.next();
            while chars.peek().map_or(false, |(_, c)| !c.is_ascii_digit()) {
                chars.next();
            }
            let end = chars.peek().map_or(lower.len(), |(i, _)| *i);
            chunks.push(SortChunk::Text(lower[start..end].to_string()));
        }
    }
    chunks
}

fn natural_sort_cmp(a: &Path, b: &Path) -> Ordering {
    let a_name = a.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let b_name = b.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    natural_sort_key(&a_name).cmp(&natural_sort_key(&b_name))
}

// ── 시리즈 그룹핑 ──

static DIGIT_RE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"\d+").unwrap());

/// 파일명(확장자 제외)에서 마지막 숫자 블록 앞의 접두사를 추출.
/// 숫자가 없으면 전체 파일명을 소문자로 반환.
fn extract_series_prefix(stem: &str) -> String {
    let mut last_start = None;
    for m in DIGIT_RE.find_iter(stem) {
        last_start = Some(m.start());
    }
    match last_start {
        Some(start) => stem[..start].to_lowercase(),
        None => stem.to_lowercase(),
    }
}

/// 같은 디렉토리에서 인접한 ZIP 파일 경로를 찾는다.
/// (이전 ZIP, 다음 ZIP) 튜플을 반환.
pub fn find_adjacent_zips(current_zip: &Path) -> anyhow::Result<(Option<PathBuf>, Option<PathBuf>)> {
    let dir = current_zip
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Cannot determine parent directory"))?;

    let current_name = current_zip
        .file_name()
        .ok_or_else(|| anyhow::anyhow!("Cannot get filename"))?
        .to_string_lossy();

    // 같은 디렉토리의 ZIP 파일 수집 + natural sort
    let mut zips: Vec<PathBuf> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension()
                    .map(|ext| ext.to_string_lossy().to_lowercase() == "zip")
                    .unwrap_or(false)
        })
        .collect();

    zips.sort_by(|a, b| natural_sort_cmp(a, b));

    // 현재 파일의 접두사 추출
    let current_stem = current_zip
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let current_prefix = extract_series_prefix(&current_stem);

    // 같은 접두사의 파일들로 그룹핑
    let group: Vec<&PathBuf> = zips
        .iter()
        .filter(|p| {
            let stem = p.file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            extract_series_prefix(&stem) == current_prefix
        })
        .collect();

    // 그룹 크기 > 1이면 그룹 내 탐색, 아니면 전체 목록으로 폴백
    let search_list: Vec<&PathBuf> = if group.len() > 1 {
        group
    } else {
        zips.iter().collect()
    };

    // 현재 위치 찾기
    let current_pos = search_list
        .iter()
        .position(|p| {
            p.file_name()
                .map(|n| n.to_string_lossy().to_lowercase())
                == Some(current_name.to_lowercase().into())
        });

    let current_pos = match current_pos {
        Some(pos) => pos,
        None => return Ok((None, None)),
    };

    let prev = if current_pos > 0 {
        Some(search_list[current_pos - 1].clone())
    } else {
        None
    };
    let next = if current_pos + 1 < search_list.len() {
        Some(search_list[current_pos + 1].clone())
    } else {
        None
    };

    Ok((prev, next))
}

#[allow(dead_code)]
pub enum ImageSource {
    Folder {
        dir_path: PathBuf,
        image_paths: Vec<PathBuf>,
    },
    Zip {
        zip_path: PathBuf,
        entry_names: Vec<String>,
    },
}

impl ImageSource {
    pub fn len(&self) -> usize {
        match self {
            ImageSource::Folder { image_paths, .. } => image_paths.len(),
            ImageSource::Zip { entry_names, .. } => entry_names.len(),
        }
    }

    pub fn names(&self) -> Vec<String> {
        match self {
            ImageSource::Folder { image_paths, .. } => image_paths
                .iter()
                .map(|p| {
                    p.file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default()
                })
                .collect(),
            ImageSource::Zip { entry_names, .. } => entry_names.clone(),
        }
    }

    pub fn read_bytes(&self, index: usize) -> anyhow::Result<Vec<u8>> {
        match self {
            ImageSource::Folder { image_paths, .. } => {
                let path = image_paths
                    .get(index)
                    .ok_or_else(|| anyhow::anyhow!("Image index out of range: {}", index))?;
                std::fs::read(path).map_err(|e| anyhow::anyhow!("Failed to read image: {}", e))
            }
            ImageSource::Zip {
                zip_path,
                entry_names,
                ..
            } => {
                let entry_name = entry_names
                    .get(index)
                    .ok_or_else(|| anyhow::anyhow!("Image index out of range: {}", index))?;
                read_zip_image(zip_path, entry_name)
            }
        }
    }
}

pub fn is_image_extension(ext: &str) -> bool {
    IMAGE_EXTENSIONS.contains(&ext)
}

fn is_image_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    IMAGE_EXTENSIONS
        .iter()
        .any(|ext| lower.ends_with(&format!(".{}", ext)))
}

/// Scan a directory itself for image files.
/// Returns (directory path, sorted image paths).
pub fn scan_directory_images(dir_path: &Path) -> anyhow::Result<(PathBuf, Vec<PathBuf>)> {
    if !dir_path.is_dir() {
        anyhow::bail!("Not a directory: {}", dir_path.display());
    }

    let mut images: Vec<PathBuf> = std::fs::read_dir(dir_path)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|p| p.is_file() && is_image_file(&p.to_string_lossy()))
        .collect();

    images.sort_by(|a, b| {
        let a_name = a
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let b_name = b
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        a_name.cmp(&b_name)
    });

    Ok((dir_path.to_path_buf(), images))
}

/// Scan the parent directory of `file_path` for image files.
/// Returns (directory path, sorted image paths, index of the original file).
pub fn scan_folder_images(file_path: &Path) -> anyhow::Result<(PathBuf, Vec<PathBuf>, usize)> {
    let dir = file_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Cannot determine parent directory"))?;

    let mut images: Vec<PathBuf> = std::fs::read_dir(dir)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|p| p.is_file() && is_image_file(&p.to_string_lossy()))
        .collect();

    // Sort alphabetically by filename (case-insensitive)
    images.sort_by(|a, b| {
        let a_name = a
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let b_name = b
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        a_name.cmp(&b_name)
    });

    let target_name = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase());
    let current_index = images
        .iter()
        .position(|p| {
            p.file_name()
                .map(|n| n.to_string_lossy().to_lowercase())
                == target_name
        })
        .unwrap_or(0);

    Ok((dir.to_path_buf(), images, current_index))
}

/// List image entries in a ZIP file, sorted depth-first alphabetically.
/// Uses custom fast parser: only reads EOCD + Central Directory (no local header validation).
pub fn list_zip_images(zip_path: &Path) -> anyhow::Result<Vec<String>> {
    let index = crate::zip_fast::ZipIndex::open(zip_path)?;

    let mut entries: Vec<String> = index
        .entry_names()
        .filter(|name| !name.ends_with('/') && is_image_file(name))
        .map(|name| name.to_string())
        .collect();

    entries.sort_by(|a, b| {
        let a_parts: Vec<&str> = a.split('/').collect();
        let b_parts: Vec<&str> = b.split('/').collect();
        a_parts.cmp(&b_parts)
    });

    Ok(entries)
}

/// Read a single image entry from a ZIP file using the fast parser.
pub fn read_zip_image(zip_path: &Path, entry_name: &str) -> anyhow::Result<Vec<u8>> {
    let index = crate::zip_fast::ZipIndex::open(zip_path)?;
    index.read_entry(entry_name)
}
