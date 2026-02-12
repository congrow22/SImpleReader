use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub font_family: String,
    pub font_size: u32,
    pub theme: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            font_family: "Segoe UI".to_string(),
            font_size: 14,
            theme: "dark".to_string(),
        }
    }
}

impl AppConfig {
    pub fn load() -> anyhow::Result<Self> {
        let path = Self::config_path()?;
        if path.exists() {
            let content = std::fs::read_to_string(&path)?;
            Ok(serde_json::from_str(&content)?)
        } else {
            Ok(Self::default())
        }
    }

    pub fn save(&self) -> anyhow::Result<()> {
        let path = Self::config_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }

    fn config_path() -> anyhow::Result<PathBuf> {
        let config_dir = dirs::config_dir()
            .ok_or_else(|| anyhow::anyhow!("Could not find config directory"))?;
        Ok(config_dir.join(env!("CARGO_PKG_NAME")).join("config.json"))
    }
}
