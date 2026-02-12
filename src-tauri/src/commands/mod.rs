mod file;

pub use file::*;

use tauri::command;

#[command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to SImpleReader.", name)
}
