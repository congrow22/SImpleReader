use crate::AppState;
use tauri::{command, ipc::Response, State};

#[command]
pub async fn get_image_list(
    file_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    tab_manager
        .get_image_list(&file_id)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_image_bytes(
    file_id: String,
    index: usize,
    state: State<'_, AppState>,
) -> Result<Response, String> {
    // Read via cache (LRU hit → instant, miss → cached ZipArchive or fs::read)
    let bytes = state
        .image_cache
        .read_image(&file_id, index)
        .map_err(|e| e.to_string())?;

    // Update last position
    {
        let mut tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
        tab_manager.set_last_position(&file_id, index, 0);
    }

    // Trigger background prefetch for adjacent images
    let total = {
        let tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
        tab_manager.get_image_count(&file_id)
    };
    state.image_cache.prefetch(&file_id, index, total);

    Ok(Response::new(bytes))
}
