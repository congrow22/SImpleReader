mod bookmark;
mod commands;
mod config;
mod epub_reader;
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
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // When a second instance is launched, bring existing window to front
            // and open the file passed as argument
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            if args.len() > 1 {
                let file_path = args[1].clone();
                let path = std::path::Path::new(&file_path);
                if path.exists() && path.is_file() {
                    use tauri::Emitter;
                    let _ = app.emit("open-file-from-args", file_path);
                }
            }
        }))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Check if a file path was passed as CLI argument (file association)
            let args: Vec<String> = std::env::args().collect();
            if args.len() > 1 {
                let file_path = args[1].clone();
                let path = std::path::Path::new(&file_path);
                if path.exists() && path.is_file() {
                    use tauri::Emitter;
                    let handle = app.handle().clone();
                    // Emit after a short delay to ensure frontend is ready
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        let _ = handle.emit("open-file-from-args", file_path);
                    });
                }
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
            commands::toggle_favorite,
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
            // Shell context menu commands
            commands::register_context_menu,
            commands::unregister_context_menu,
            commands::is_context_menu_registered,
            // Font commands
            commands::get_system_fonts,
            // EPUB commands
            commands::get_epub_chapters,
            commands::get_epub_chapter,
            commands::get_epub_font_styles,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
