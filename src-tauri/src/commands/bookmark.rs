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
    // position from frontend is already a line number
    store
        .add_bookmark(&file_path, position, position, &memo)
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
