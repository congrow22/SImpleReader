use std::path::PathBuf;
use tauri::command;

#[command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file: {}", e))
}

#[command]
pub async fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write file: {}", e))
}

#[command]
pub fn get_config_dir() -> Result<PathBuf, String> {
    dirs::config_dir()
        .ok_or_else(|| "Could not find config directory".to_string())
}
