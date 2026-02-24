use std::io::Read;
use std::path::{Path, PathBuf};

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];

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

    let current_index = images.iter().position(|p| p == file_path).unwrap_or(0);

    Ok((dir.to_path_buf(), images, current_index))
}

/// List image entries in a ZIP file, sorted depth-first alphabetically.
pub fn list_zip_images(zip_path: &Path) -> anyhow::Result<Vec<String>> {
    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;

    let mut entries: Vec<String> = (0..archive.len())
        .filter_map(|i| {
            let entry = archive.by_index(i).ok()?;
            let name = entry.name().to_string();
            if !entry.is_dir() && is_image_file(&name) {
                Some(name)
            } else {
                None
            }
        })
        .collect();

    // Sort: by directory components first (depth-first), then by filename
    entries.sort_by(|a, b| {
        let a_parts: Vec<&str> = a.split('/').collect();
        let b_parts: Vec<&str> = b.split('/').collect();
        a_parts.cmp(&b_parts)
    });

    Ok(entries)
}

/// Read a single image entry from a ZIP file.
pub fn read_zip_image(zip_path: &Path, entry_name: &str) -> anyhow::Result<Vec<u8>> {
    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    let mut entry = archive
        .by_name(entry_name)
        .map_err(|e| anyhow::anyhow!("ZIP entry not found: {} - {}", entry_name, e))?;

    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut buf)?;
    Ok(buf)
}
