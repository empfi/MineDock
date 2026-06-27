mod database;
mod models;
mod process;
mod downloader;
mod files;
mod backups;
mod commands;
mod worlds;
pub mod tunnel;

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
            tunnel::start_client(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::fetch_servers,
            commands::fetch_server,
            commands::create_new_server,
            commands::remove_server,
            commands::save_server_port,
            commands::set_server_sharing,
            commands::test_relay_connection,
            commands::fetch_settings,
            commands::save_settings,
            commands::start_mc_server,
            commands::stop_mc_server,
            commands::send_mc_command,
            commands::get_player_info,
            commands::get_player_names,
            commands::lookup_minecraft_player,
            commands::set_whitelist_player,
            commands::get_mc_versions,
            commands::download_mc_version,
            commands::get_software_versions,
            commands::download_software,
            commands::get_directory_contents,
            commands::read_file_content,
            commands::get_log_summaries,
            commands::read_log_content,
            commands::save_file_content,
            commands::delete_file_or_folder,
            commands::create_new_folder,
            commands::import_dropped_files,
            commands::create_mc_backup,
            commands::list_mc_backups,
            commands::restore_mc_backup,
            commands::remove_mc_backup,
            commands::accept_eula,
            commands::get_system_memory,
            commands::detect_java_paths,
            commands::delete_server_files,
            commands::update_server_version_info,
            commands::update_server_settings,
            commands::scan_directory_for_import,
            commands::get_worlds,
            commands::create_server_world,
            commands::activate_server_world,
            commands::rename_server_world,
            commands::delete_server_world,
            commands::export_server_world,
            commands::import_server_world,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
