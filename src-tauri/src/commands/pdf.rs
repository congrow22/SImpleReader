use tauri::{command, ipc::Response, State};
use crate::AppState;

#[command]
pub async fn read_pdf_bytes(file_id: String, state: State<'_, AppState>) -> Result<Response, String> {
    let tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    let path = tab_manager.get_file_path(&file_id).map_err(|e| e.to_string())?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}
