//! 应用设置的读取与持久化。

use tauri::{AppHandle, Manager, State};

use crate::{
    error::{Error, Result},
    state::{AppState, Settings},
};

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| Error::Other(e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("settings.json"))
}

pub fn load_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save_settings(app: &AppHandle, settings: &Settings) -> Result<()> {
    let path = settings_path(app)?;
    let text = serde_json::to_string_pretty(settings)?;
    std::fs::write(path, text)?;
    Ok(())
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.lock().map(|s| s.clone()).unwrap_or_default()
}

#[tauri::command]
pub fn set_settings(app: AppHandle, state: State<'_, AppState>, settings: Settings) -> Result<()> {
    {
        let mut guard = state
            .settings
            .lock()
            .map_err(|e| Error::Other(e.to_string()))?;
        *guard = settings.clone();
    }
    save_settings(&app, &settings)
}
