mod commands;
mod config;
mod error;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::read_text_file,
            commands::write_text_file,
            commands::get_config_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
