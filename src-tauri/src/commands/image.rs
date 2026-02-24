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
    let mut tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    let bytes = tab_manager
        .get_image_bytes(&file_id, index)
        .map_err(|e| e.to_string())?;
    tab_manager.set_last_position(&file_id, index, 0);
    Ok(Response::new(bytes))
}
