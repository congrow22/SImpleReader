use crate::search::{self, SearchMatch};
use crate::AppState;
use tauri::command;

#[command]
pub async fn search_text(
    file_id: String,
    query: String,
    case_sensitive: bool,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SearchMatch>, String> {
    let tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    let buffer = tab_manager
        .get_buffer(&file_id)
        .map_err(|e| e.to_string())?;
    Ok(search::search_in_rope(buffer.rope(), &query, case_sensitive))
}

#[command]
pub async fn replace_text(
    file_id: String,
    query: String,
    replacement: String,
    position: usize,
    case_sensitive: bool,
    state: tauri::State<'_, AppState>,
) -> Result<Option<usize>, String> {
    let mut tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    let result = {
        let buffer = tab_manager
            .get_buffer_mut(&file_id)
            .map_err(|e| e.to_string())?;
        let result = search::replace_next(buffer.rope_mut(), &query, &replacement, position, case_sensitive);
        if result.is_some() {
            buffer.is_modified = true;
        }
        result
    };
    if result.is_some() {
        tab_manager.set_modified(&file_id, true);
    }
    Ok(result)
}

#[command]
pub async fn replace_all_text(
    file_id: String,
    query: String,
    replacement: String,
    case_sensitive: bool,
    state: tauri::State<'_, AppState>,
) -> Result<usize, String> {
    let mut tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    let count = {
        let buffer = tab_manager
            .get_buffer_mut(&file_id)
            .map_err(|e| e.to_string())?;
        let count = search::replace_all_in_rope(buffer.rope_mut(), &query, &replacement, case_sensitive);
        if count > 0 {
            buffer.is_modified = true;
        }
        count
    };
    if count > 0 {
        tab_manager.set_modified(&file_id, true);
    }
    Ok(count)
}
