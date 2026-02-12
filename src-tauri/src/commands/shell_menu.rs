use tauri::command;

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

/// Register "Open with SimpleReader" context menu in Windows Explorer
#[command]
pub fn register_context_menu() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let exe_path = std::env::current_exe()
            .map_err(|e| format!("Failed to get exe path: {}", e))?;
        let exe_str = exe_path.to_string_lossy().to_string();

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        // Create shell key: HKCU\Software\Classes\*\shell\SimpleReader
        let shell_key = hkcu
            .create_subkey(r"Software\Classes\*\shell\SimpleReader")
            .map_err(|e| format!("Failed to create registry key: {}", e))?
            .0;

        shell_key
            .set_value("", &"Open with SimpleReader")
            .map_err(|e| format!("Failed to set value: {}", e))?;
        shell_key
            .set_value("Icon", &exe_str)
            .map_err(|e| format!("Failed to set icon: {}", e))?;

        // Create command key
        let cmd_key = hkcu
            .create_subkey(r"Software\Classes\*\shell\SimpleReader\command")
            .map_err(|e| format!("Failed to create command key: {}", e))?
            .0;

        let cmd_value = format!("\"{}\" \"%1\"", exe_str);
        cmd_key
            .set_value("", &cmd_value)
            .map_err(|e| format!("Failed to set command: {}", e))?;

        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

/// Unregister context menu
#[command]
pub fn unregister_context_menu() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        // Delete command subkey first, then shell key
        let _ = hkcu.delete_subkey(r"Software\Classes\*\shell\SimpleReader\command");
        let _ = hkcu.delete_subkey(r"Software\Classes\*\shell\SimpleReader");

        Ok(true)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

/// Check if context menu is registered
#[command]
pub fn is_context_menu_registered() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let result = hkcu.open_subkey(r"Software\Classes\*\shell\SimpleReader");
        Ok(result.is_ok())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}
