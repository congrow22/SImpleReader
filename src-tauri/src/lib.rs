mod bookmark;
mod commands;
mod config;
mod error;
mod formatter;
mod search;
mod tab_manager;
mod text_buffer;

use std::sync::Mutex;

pub struct AppState {
    pub tab_manager: Mutex<tab_manager::TabManager>,
    pub bookmark_store: Mutex<bookmark::BookmarkStore>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let bookmark_store = bookmark::BookmarkStore::new()
        .unwrap_or_else(|e| {
            eprintln!("Failed to load bookmark store: {}. Using empty store.", e);
            // Create a fallback empty store - we'll just try again
            bookmark::BookmarkStore::new().expect("Failed to create bookmark store")
        });

    let app_state = AppState {
        tab_manager: Mutex::new(tab_manager::TabManager::new()),
        bookmark_store: Mutex::new(bookmark_store),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // File commands
            commands::open_file,
            commands::close_file,
            commands::save_file,
            commands::get_text_chunk,
            commands::get_open_tabs,
            commands::switch_tab,
            commands::get_total_lines,
            // Edit commands
            commands::insert_text,
            commands::replace_line,
            commands::delete_text,
            commands::undo,
            commands::redo,
            // Bookmark commands
            commands::add_bookmark,
            commands::remove_bookmark,
            commands::get_bookmarks,
            commands::get_all_bookmarks,
            commands::search_bookmarks,
            commands::save_last_position,
            commands::track_file_open,
            commands::get_file_list,
            commands::remove_file_entry,
            // Search commands
            commands::search_text,
            commands::replace_text,
            commands::replace_all_text,
            // Format commands
            commands::preview_format,
            commands::apply_format,
            // Config commands
            commands::get_config,
            commands::save_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
