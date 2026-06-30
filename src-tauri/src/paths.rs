use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn legacy_app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let legacy = legacy_app_data_dir(app)?;
    let target = legacy
        .parent()
        .ok_or("App data directory has no parent")?
        .join(".Minedock");
    if legacy.exists() && !target.exists() {
        std::fs::rename(&legacy, &target).map_err(|error| error.to_string())?;
    }
    std::fs::create_dir_all(&target).map_err(|error| error.to_string())?;
    Ok(target)
}
