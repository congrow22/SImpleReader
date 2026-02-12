use crate::AppState;
use tauri::command;

#[command]
pub async fn insert_text(
    file_id: String,
    position: usize,
    text: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    {
        let buffer = tab_manager
            .get_buffer_mut(&file_id)
            .map_err(|e| e.to_string())?;
        buffer.insert_text(position, &text);
    }
    tab_manager.set_modified(&file_id, true);
    Ok(())
}

#[command]
pub async fn delete_text(
    file_id: String,
    start: usize,
    end: usize,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    {
        let buffer = tab_manager
            .get_buffer_mut(&file_id)
            .map_err(|e| e.to_string())?;
        buffer.delete_text(start, end);
    }
    tab_manager.set_modified(&file_id, true);
    Ok(())
}

#[command]
pub async fn undo(
    file_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    let is_modified = {
        let buffer = tab_manager
            .get_buffer_mut(&file_id)
            .map_err(|e| e.to_string())?;
        if !buffer.undo() {
            return Err("Nothing to undo".to_string());
        }
        buffer.is_modified
    };
    tab_manager.set_modified(&file_id, is_modified);
    Ok(())
}

#[command]
pub async fn redo(
    file_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    let is_modified = {
        let buffer = tab_manager
            .get_buffer_mut(&file_id)
            .map_err(|e| e.to_string())?;
        if !buffer.redo() {
            return Err("Nothing to redo".to_string());
        }
        buffer.is_modified
    };
    tab_manager.set_modified(&file_id, is_modified);
    Ok(())
}
