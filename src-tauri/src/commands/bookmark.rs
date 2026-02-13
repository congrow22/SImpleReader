use crate::bookmark::{Bookmark, BookmarkSearchResult, FileBookmarks, FileListEntry};
use crate::AppState;
use std::collections::HashMap;
use tauri::command;

#[command]
pub async fn track_file_open(
    file_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut store = state.bookmark_store.lock().map_err(|e| e.to_string())?;
    store
        .track_file_open(&file_path)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_file_list(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<FileListEntry>, String> {
    let store = state.bookmark_store.lock().map_err(|e| e.to_string())?;
    Ok(store.get_file_list())
}

#[command]
pub async fn remove_file_entry(
    file_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut store = state.bookmark_store.lock().map_err(|e| e.to_string())?;
    store
        .remove_file_entry(&file_path)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn add_bookmark(
    file_path: String,
    position: usize,
    line: usize,
    memo: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut store = state.bookmark_store.lock().map_err(|e| e.to_string())?;
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
pub async fn toggle_favorite(
    file_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let mut store = state.bookmark_store.lock().map_err(|e| e.to_string())?;
    store
        .toggle_favorite(&file_path)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn save_last_position(
    file_path: String,
    position: usize,
    scroll_offset: Option<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut store = state.bookmark_store.lock().map_err(|e| e.to_string())?;
    store
        .save_last_position(&file_path, position, scroll_offset.unwrap_or(0))
        .map_err(|e| e.to_string())
}
