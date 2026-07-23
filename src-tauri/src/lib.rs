mod ai;
mod backups;
mod commands;
mod database;
mod discord;
mod downloader;
mod files;
mod models;
mod paths;
mod plugins;
mod process;
mod scheduler;
pub mod tunnel;
mod worlds;

use std::sync::atomic::AtomicBool;
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
            app.manage(ai::AiState(Mutex::new(None)));
            app.manage(ai::AiCancelState(AtomicBool::new(false)));
            let conn = database::init_db(&app.handle()).expect("Failed to initialize database");
            app.manage(database::DbState {
                db: Mutex::new(conn),
            });

            let process_manager = process::ProcessManager::new(app.handle().clone());
            app.manage(process_manager);

            let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
            app.manage(discord::DiscordState { tx });
            discord::start_rpc_worker(rx);
            tunnel::start_client(app.handle().clone());

            // Start background task scheduler
            scheduler::start_scheduler(app.handle().clone());

            // Auto-reattach to running Docker containers on startup
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                let servers = {
                    if let Some(state) = app_handle.try_state::<database::DbState>() {
                        if let Ok(conn) = state.db.lock() {
                            database::get_servers(&conn).unwrap_or_default()
                        } else {
                            Vec::new()
                        }
                    } else {
                        Vec::new()
                    }
                };
                let pm = app_handle.state::<process::ProcessManager>();
                for server in servers {
                    if server.run_in_container {
                        if let Some(id) = server.id {
                            let (_, running) = process::get_container_running_state(id);
                            if running {
                                let _ = pm.start_server(id).await;
                            }
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::fetch_servers,
            commands::get_installed_plugins,
            commands::check_plugin_updates,
            commands::get_plugin_versions,
            commands::search_plugins,
            commands::get_marketplace_plugin_details,
            commands::install_marketplace_plugin,
            commands::toggle_plugin,
            commands::delete_plugin,
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
            commands::kill_mc_server,
            commands::send_mc_command,
            commands::get_player_info,
            commands::get_player_names,
            commands::lookup_minecraft_player,
            commands::set_whitelist_player,
            commands::get_mc_versions,
            commands::download_mc_version,
            commands::get_software_versions,
            commands::get_software_version_info,
            commands::download_software,
            commands::install_loader,
            commands::get_directory_contents,
            commands::search_server_files,
            commands::move_file_or_folder,
            commands::move_files_or_folders,
            commands::read_file_content,
            commands::get_log_summaries,
            commands::read_log_content,
            commands::save_file_content,
            commands::delete_file_or_folder,
            commands::create_new_folder,
            commands::import_dropped_files,
            commands::create_mc_backup,
            commands::list_mc_backups,
            commands::verify_mc_backup,
            commands::restore_mc_backup,
            commands::restore_safe_apply_backup,
            commands::remove_mc_backup,
            commands::rename_mc_backup,
            commands::accept_eula,
            commands::get_system_memory,
            commands::get_server_disk_usage,
            commands::detect_java_paths,
            commands::get_java_major,
            commands::install_managed_java,
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
            discord::update_discord_rpc,
            discord::clear_discord_rpc,
            commands::install_modpack,
            ai::set_ai_key,
            ai::has_ai_key,
            ai::cancel_ai,
            ai::ai_chat,
            ai::get_ai_logo,
            commands::is_docker_available,
            commands::get_server_schedules,
            commands::add_server_schedule,
            commands::update_server_schedule,
            commands::delete_server_schedule,
            commands::trigger_schedule_now,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
