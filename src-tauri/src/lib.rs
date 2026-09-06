//! Material Dictation Tauri 后端入口。

use state::AppState;
use tauri::Manager;

mod error;
mod service;
mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            let settings = service::settings::load_settings(app.handle());
            if let Some(state) = app.try_state::<AppState>() {
                *state.settings.lock().unwrap() = settings;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            service::audio::ffmpeg_available,
            service::audio::normalize_media,
            service::audio::waveform,
            service::audio::export_audio,
            service::transcribe::transcribe_audio,
            service::transcribe::cancel_transcribe,
            service::model::list_models,
            service::model::model_status,
            service::model::available_backends,
            service::model::add_model,
            service::model::remove_model,
            service::model::load_model,
            service::settings::get_settings,
            service::settings::set_settings,
            service::update::check_update,
            service::pptx::generate_pptx,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
