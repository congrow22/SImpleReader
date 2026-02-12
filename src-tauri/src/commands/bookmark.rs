use crate::bookmark::{Bookmark, BookmarkSearchResult, FileBookmarks};
use crate::AppState;
use std::collections::HashMap;
use tauri::command;

#[command]
pub async fn add_bookmark(
    file_path: String,
    position: usize,
    memo: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut store = state.bookmark_store.lock().map_err(|e| e.to_string())?;
    // Calculate line from position using tab manager if the file is open
    let line = {
        let tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
        if let Ok(buffer) = tab_manager.get_buffer(&file_path) {
            let total_chars = buffer.get_total_chars();
            let pos = position.min(total_chars);
            buffer.rope().char_to_line(pos)
        } else {
            0
        }
    };
    store
        .add_bookmark(&file_path, position, line, &memo)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn remove_bookmark(
    file_path: String,
    index: usize,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut store = state.bookmark_store.lock().map_err(|e| e.to_string())?;
    store
        .remove_bookmark(&file_path, index)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_bookmarks(
    file_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Bookmark>, String> {
    let store = state.bookmark_store.lock().map_err(|e| e.to_string())?;
    Ok(store.get_bookmarks(&file_path))
}

#[command]
pub async fn get_all_bookmarks(
    state: tauri::State<'_, AppState>,
) -> Result<HashMap<String, FileBookmarks>, String> {
    let store = state.bookmark_store.lock().map_err(|e| e.to_string())?;
    Ok(store.get_all_bookmarks().clone())
}

#[command]
pub async fn search_bookmarks(
    query: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<BookmarkSearchResult>, String> {
    let store = state.bookmark_store.lock().map_err(|e| e.to_string())?;
    Ok(store.search_bookmarks(&query))
}

#[command]
pub async fn save_last_position(
    file_path: String,
    position: usize,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut store = state.bookmark_store.lock().map_err(|e| e.to_string())?;
    store
        .save_last_position(&file_path, position)
        .map_err(|e| e.to_string())
}
