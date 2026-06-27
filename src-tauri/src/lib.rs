mod database;
mod models;
mod process;
mod downloader;
mod files;
mod backups;
mod commands;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let conn = database::init_db(&app.handle()).expect("Failed to initialize database");
            app.manage(database::DbState {
                db: Mutex::new(conn),
            });
            
            let process_manager = process::ProcessManager::new(app.handle().clone());
            app.manage(process_manager);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::fetch_servers,
            commands::fetch_server,
            commands::create_new_server,
            commands::remove_server,
            commands::fetch_settings,
            commands::save_settings,
            commands::start_mc_server,
            commands::stop_mc_server,
            commands::send_mc_command,
            commands::get_mc_versions,
            commands::download_mc_version,
            commands::get_software_versions,
            commands::download_software,
            commands::get_directory_contents,
            commands::read_file_content,
            commands::save_file_content,
            commands::delete_file_or_folder,
            commands::create_new_folder,
            commands::create_mc_backup,
            commands::list_mc_backups,
            commands::restore_mc_backup,
            commands::remove_mc_backup,
            commands::accept_eula,
            commands::get_system_memory,
            commands::detect_java_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
