use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("{0}")]
    Custom(String),
}

impl From<AppError> for String {
    fn from(err: AppError) -> Self {
        err.to_string()
    }
}
