use crate::tab_manager::{FileInfo, TabInfo, TextChunk};
use crate::AppState;
use tauri::command;

#[command]
pub async fn open_file(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<FileInfo, String> {
    // Get last position from bookmark store
    let last_position = {
        let store = state.bookmark_store.lock().map_err(|e| e.to_string())?;
        store.get_last_position(&path).unwrap_or(0)
    };

    let mut tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    tab_manager
        .open_file(&path, last_position)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn close_file(
    file_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let last_position = {
        let mut tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
        tab_manager.close_tab(&file_id).map_err(|e| e.to_string())?
    };

    // Save last position to bookmark store
    let mut store = state.bookmark_store.lock().map_err(|e| e.to_string())?;
    store
        .save_last_position(&file_id, last_position)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[command]
pub async fn save_file(
    file_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    tab_manager
        .save_file(&file_id)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_text_chunk(
    file_id: String,
    start_line: usize,
    end_line: usize,
    state: tauri::State<'_, AppState>,
) -> Result<TextChunk, String> {
    let tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    tab_manager
        .get_text_chunk(&file_id, start_line, end_line)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_open_tabs(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<TabInfo>, String> {
    let tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    Ok(tab_manager.get_open_tabs())
}

#[command]
pub async fn switch_tab(
    file_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<FileInfo, String> {
    let mut tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    tab_manager
        .switch_tab(&file_id)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_total_lines(
    file_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<usize, String> {
    let tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    tab_manager
        .get_total_lines(&file_id)
        .map_err(|e| e.to_string())
}
