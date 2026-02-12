use crate::formatter;
use crate::AppState;
use tauri::command;

#[command]
pub async fn preview_format(
    file_id: String,
    format_type: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    let buffer = tab_manager
        .get_buffer(&file_id)
        .map_err(|e| e.to_string())?;
    let text = buffer.to_string_full();
    formatter::apply_format(&text, &format_type).map_err(|e| e.to_string())
}

#[command]
pub async fn apply_format(
    file_id: String,
    format_type: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    {
        let buffer = tab_manager
            .get_buffer_mut(&file_id)
            .map_err(|e| e.to_string())?;
        let text = buffer.to_string_full();
        let formatted = formatter::apply_format(&text, &format_type).map_err(|e| e.to_string())?;
        buffer.replace_all(&formatted);
    }
    tab_manager.set_modified(&file_id, true);
    Ok(())
}
