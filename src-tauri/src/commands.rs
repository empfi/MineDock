use tauri::{AppHandle, State};
use crate::database::{DbState, get_servers, add_server, delete_server, get_settings, update_settings, get_server};
use crate::models::{Server, AppSettings};
use crate::process::ProcessManager;
use crate::downloader::{VersionManifest, fetch_versions, download_server_jar, fetch_software_versions, download_server_software};
use crate::files::{FileInfo, list_directory, read_text_file, write_text_file, delete_file, create_folder};
use crate::backups::{BackupInfo, create_backup, list_backups, restore_backup, delete_backup as del_backup};

#[tauri::command]
pub fn fetch_servers(state: State<DbState>) -> Result<Vec<Server>, String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
    get_servers(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fetch_server(state: State<DbState>, id: i64) -> Result<Option<Server>, String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
    get_server(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_new_server(state: State<DbState>, server: Server) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
    add_server(&conn, &server).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_server(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
    delete_server(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fetch_settings(state: State<DbState>) -> Result<AppSettings, String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
    get_settings(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_settings(state: State<DbState>, settings: AppSettings) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
    update_settings(&conn, &settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_mc_server(_app: AppHandle, id: i64, process_manager: State<'_, ProcessManager>) -> Result<(), String> {
    process_manager.start_server(id).await
}

#[tauri::command]
pub async fn stop_mc_server(id: i64, process_manager: State<'_, ProcessManager>) -> Result<(), String> {
    process_manager.stop_server(id).await
}

#[tauri::command]
pub async fn send_mc_command(id: i64, command: String, process_manager: State<'_, ProcessManager>) -> Result<(), String> {
    process_manager.send_command(id, command).await
}

#[tauri::command]
pub async fn get_mc_versions() -> Result<VersionManifest, String> {
    fetch_versions().await
}

#[tauri::command]
pub async fn get_software_versions(server_type: String) -> Result<Vec<String>, String> {
    fetch_software_versions(&server_type).await
}

#[tauri::command]
pub async fn download_software(app: AppHandle, server_type: String, version: String, path: String) -> Result<(), String> {
    download_server_software(app, server_type, version, path).await
}
#[tauri::command]
pub async fn download_mc_version(app: AppHandle, url: String, path: String) -> Result<(), String> {
    download_server_jar(app, url, path).await
}

#[tauri::command]
pub fn get_directory_contents(base_dir: String, sub_path: String) -> Result<Vec<FileInfo>, String> {
    list_directory(&base_dir, &sub_path)
}

#[tauri::command]
pub fn read_file_content(base_dir: String, sub_path: String) -> Result<String, String> {
    read_text_file(&base_dir, &sub_path)
}

#[tauri::command]
pub fn save_file_content(base_dir: String, sub_path: String, content: String) -> Result<(), String> {
    write_text_file(&base_dir, &sub_path, &content)
}

#[tauri::command]
pub fn delete_file_or_folder(base_dir: String, sub_path: String) -> Result<(), String> {
    delete_file(&base_dir, &sub_path)
}

#[tauri::command]
pub fn create_new_folder(base_dir: String, sub_path: String) -> Result<(), String> {
    create_folder(&base_dir, &sub_path)
}

#[tauri::command]
pub async fn create_mc_backup(server_path: String, backup_name: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        create_backup(&server_path, &backup_name)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn list_mc_backups(server_path: String) -> Result<Vec<BackupInfo>, String> {
    list_backups(&server_path)
}

#[tauri::command]
pub async fn restore_mc_backup(server_path: String, backup_name: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        restore_backup(&server_path, &backup_name)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn remove_mc_backup(server_path: String, backup_name: String) -> Result<(), String> {
    del_backup(&server_path, &backup_name)
}

#[tauri::command]
pub fn accept_eula(server_path: String) -> Result<(), String> {
    let path = std::path::Path::new(&server_path).join("eula.txt");
    std::fs::write(path, "eula=true").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_system_memory() -> Result<u64, String> {
    use sysinfo::System;
    let mut sys = System::new_all();
    sys.refresh_memory();
    Ok(sys.total_memory() / 1024 / 1024) // return in MB
}

#[tauri::command]
pub fn detect_java_paths() -> Result<Vec<String>, String> {
    let mut paths = Vec::new();
    
    // Add default PATH java
    if let Ok(_) = std::process::Command::new("java").arg("-version").output() {
        paths.push("java".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use std::path::PathBuf;
        
        let common_dirs = [
            "C:\\Program Files\\Java",
            "C:\\Program Files (x86)\\Java",
            "C:\\Program Files\\Eclipse Adoptium",
            "C:\\Program Files\\AdoptOpenJDK",
        ];

        for dir in common_dirs {
            let path = std::path::Path::new(dir);
            if path.exists() && path.is_dir() {
                if let Ok(entries) = std::fs::read_dir(path) {
                    for entry in entries {
                        if let Ok(entry) = entry {
                            let java_exe = entry.path().join("bin").join("java.exe");
                            if java_exe.exists() {
                                paths.push(java_exe.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
        }
        
        // Also check LOCALAPPDATA for some user-level installations (like Scoop/sdkman sometimes)
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let path = PathBuf::from(local_app_data).join("Programs").join("Eclipse Adoptium");
            if path.exists() && path.is_dir() {
                if let Ok(entries) = std::fs::read_dir(path) {
                    for entry in entries {
                        if let Ok(entry) = entry {
                            let java_exe = entry.path().join("bin").join("java.exe");
                            if java_exe.exists() {
                                paths.push(java_exe.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    
    // De-duplicate
    paths.sort();
    paths.dedup();

    Ok(paths)
}
