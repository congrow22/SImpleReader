use crate::epub_reader::ChapterInfo;
use crate::AppState;
use tauri::command;

#[command]
pub async fn get_epub_chapters(
    file_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ChapterInfo>, String> {
    let tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    tab_manager
        .get_epub_chapter_infos(&file_id)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_epub_chapter(
    file_id: String,
    chapter_index: usize,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let mut tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    tab_manager.set_last_position(&file_id, chapter_index);
    tab_manager
        .get_epub_chapter_html(&file_id, chapter_index)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_epub_font_styles(
    file_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let tab_manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    tab_manager
        .get_epub_font_styles(&file_id)
        .map_err(|e| e.to_string())
}
