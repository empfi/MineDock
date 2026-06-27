use tauri::{AppHandle, State};
use crate::database::{DbState, get_servers, add_server, delete_server, get_settings, update_settings, get_server, update_server_port, update_server_sharing, update_server_version, update_server_profile};
use crate::models::{Server, AppSettings};
use crate::process::ProcessManager;
use crate::downloader::{VersionManifest, fetch_versions, download_server_jar, fetch_software_versions, download_server_software};
use crate::files::{FileInfo, LogSummary, list_directory, list_log_summaries, read_log_file, read_text_file, write_text_file, delete_or_schedule, create_folder, import_paths};
use crate::backups::{BackupInfo, create_backup, list_backups, restore_backup, delete_backup as del_backup};
use crate::worlds::{WorldInfo, list_worlds, create_world, activate_world, rename_world, delete_world, export_world, import_world};

#[tauri::command]
pub fn get_worlds(server_path: String) -> Result<Vec<WorldInfo>, String> {
    list_worlds(&server_path)
}

#[tauri::command]
pub fn create_server_world(server_path: String, name: String, seed: String, kind: String) -> Result<(), String> {
    create_world(&server_path, &name, &seed, &kind)
}

#[tauri::command]
pub fn activate_server_world(server_path: String, name: String) -> Result<(), String> {
    activate_world(&server_path, &name)
}

#[tauri::command]
pub fn rename_server_world(server_path: String, old_name: String, new_name: String) -> Result<(), String> {
    rename_world(&server_path, &old_name, &new_name)
}

#[tauri::command]
pub fn delete_server_world(server_path: String, name: String) -> Result<(), String> {
    delete_world(&server_path, &name)
}

#[tauri::command]
pub async fn export_server_world(server_path: String, name: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || export_world(&server_path, &name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn import_server_world(server_path: String, zip_path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || import_world(&server_path, &zip_path))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
pub struct PlayerInfo {
    uuid: String,
    is_op: bool,
    banned: bool,
    whitelist_enabled: bool,
    whitelisted: bool,
    kills: u64,
    deaths: u64,
    play_time_minutes: u64,
    money: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct PlayerIdentity {
    id: String,
    name: String,
}

#[tauri::command]
pub fn get_player_names(server_path: String) -> Result<Vec<String>, String> {
    let cache: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(std::path::Path::new(&server_path).join("usercache.json"))
            .map_err(|_| "Player cache is not available yet")?
    ).map_err(|e| e.to_string())?;
    Ok(cache.as_array().into_iter().flatten()
        .filter_map(|player| player["name"].as_str().map(str::to_string))
        .collect())
}

#[tauri::command]
pub async fn lookup_minecraft_player(username: String) -> Result<PlayerIdentity, String> {
    if username.len() < 3 || username.len() > 16 || !username.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err("Enter a valid Minecraft username".to_string());
    }
    let response = reqwest::get(format!("https://api.mojang.com/users/profiles/minecraft/{username}"))
        .await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err("Minecraft player not found".to_string());
    }
    response.json().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_whitelist_player(server_path: String, uuid: String, username: String, allowed: bool) -> Result<(), String> {
    let path = std::path::Path::new(&server_path).join("whitelist.json");
    let mut players: Vec<serde_json::Value> = std::fs::read_to_string(&path)
        .ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
    players.retain(|player| !player["uuid"].as_str().is_some_and(|value| value.eq_ignore_ascii_case(&uuid)));
    if allowed {
        players.push(serde_json::json!({ "uuid": uuid, "name": username }));
    }
    std::fs::write(path, serde_json::to_string_pretty(&players).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_player_info(server_path: String, username: String) -> Result<PlayerInfo, String> {
    let root = std::path::Path::new(&server_path);
    let cache: serde_json::Value = std::fs::read_to_string(root.join("usercache.json"))
        .ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_else(|| serde_json::json!([]));
    let uuid = if let Some(uuid) = cache.as_array()
        .and_then(|players| players.iter().find(|player| {
            player["name"].as_str().is_some_and(|name| name.eq_ignore_ascii_case(&username))
        }))
        .and_then(|player| player["uuid"].as_str())
    {
        uuid.to_string()
    } else {
        let identity = lookup_minecraft_player(username.clone()).await?;
        let id = identity.id;
        if id.len() != 32 {
            return Err("Minecraft returned an invalid player UUID".to_string());
        }
        format!("{}-{}-{}-{}-{}", &id[0..8], &id[8..12], &id[12..16], &id[16..20], &id[20..32])
    };

    let ops: serde_json::Value = std::fs::read_to_string(root.join("ops.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| serde_json::json!([]));
    let is_op = ops.as_array().is_some_and(|players| players.iter().any(|player| {
        player["uuid"].as_str().is_some_and(|value| value.eq_ignore_ascii_case(&uuid))
    }));
    let bans: serde_json::Value = std::fs::read_to_string(root.join("banned-players.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| serde_json::json!([]));
    let banned = bans.as_array().is_some_and(|players| players.iter().any(|player| {
        player["uuid"].as_str().is_some_and(|value| value.eq_ignore_ascii_case(&uuid))
    }));
    let properties = std::fs::read_to_string(root.join("server.properties")).unwrap_or_default();
    let whitelist_enabled = properties.lines().any(|line| line.trim().eq_ignore_ascii_case("white-list=true"));
    let whitelist: serde_json::Value = std::fs::read_to_string(root.join("whitelist.json"))
        .ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_else(|| serde_json::json!([]));
    let whitelisted = whitelist.as_array().is_some_and(|players| players.iter().any(|player| {
        player["uuid"].as_str().is_some_and(|value| value.eq_ignore_ascii_case(&uuid))
    }));

    let stats: serde_json::Value = std::fs::read_to_string(root.join("world").join("stats").join(format!("{uuid}.json")))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    let custom = &stats["stats"]["minecraft:custom"];
    let money = std::fs::read_to_string(root.join("plugins").join("Essentials").join("userdata").join(format!("{}.yml", uuid.to_ascii_lowercase())))
        .ok()
        .and_then(|content| content.lines().find_map(|line| {
            line.trim().strip_prefix("money:").map(|value| value.trim().trim_matches('\'').trim_matches('"').to_string())
        }));

    Ok(PlayerInfo {
        uuid,
        is_op,
        banned,
        whitelist_enabled,
        whitelisted,
        kills: custom["minecraft:player_kills"].as_u64().unwrap_or(0),
        deaths: custom["minecraft:deaths"].as_u64().unwrap_or(0),
        play_time_minutes: custom["minecraft:play_time"].as_u64().unwrap_or(0) / 1200,
        money,
    })
}

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
    if conn.query_row("SELECT COUNT(*) FROM servers WHERE port = ?1", [server.port], |row| row.get::<_, i64>(0)).map_err(|e| e.to_string())? > 0 {
        return Err(format!("Port {} is already assigned to another server", server.port));
    }
    add_server(&conn, &server).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_server(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
    delete_server(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_server_port(state: State<DbState>, id: i64, port: i32) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
    if conn.query_row("SELECT COUNT(*) FROM servers WHERE port = ?1 AND id != ?2", rusqlite::params![port, id], |row| row.get::<_, i64>(0)).map_err(|e| e.to_string())? > 0 {
        return Err(format!("Port {port} is already assigned to another server"));
    }
    update_server_port(&conn, id, port).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_server_sharing(state: State<DbState>, id: i64, enabled: bool) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
    update_server_sharing(&conn, id, enabled).map_err(|e| e.to_string())?;
    crate::tunnel::notify_config_changed();
    Ok(())
}

#[tauri::command]
pub async fn test_relay_connection(relay: String, token: String) -> Result<(), String> {
    if token.len() < 32 { return Err("Token must contain at least 32 characters".into()); }
    crate::tunnel::test_relay(&relay, &token).await
}

#[tauri::command]
pub fn fetch_settings(state: State<DbState>) -> Result<AppSettings, String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
    get_settings(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_settings(state: State<DbState>, settings: AppSettings) -> Result<(), String> {
    if settings.tunnel_enabled {
        if settings.tunnel_relay.parse::<std::net::SocketAddr>().is_err()
            && !settings.tunnel_relay.contains(':') {
            return Err("Relay address must be host:port".into());
        }
        if settings.tunnel_token.len() < 32 {
            return Err("Tunnel token must contain at least 32 characters".into());
        }
    }
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
pub fn get_log_summaries(base_dir: String) -> Result<Vec<LogSummary>, String> {
    list_log_summaries(&base_dir)
}

#[tauri::command]
pub fn read_log_content(base_dir: String, name: String) -> Result<String, String> {
    read_log_file(&base_dir, &name)
}

#[tauri::command]
pub fn save_file_content(base_dir: String, sub_path: String, content: String) -> Result<(), String> {
    write_text_file(&base_dir, &sub_path, &content)
}

#[tauri::command]
pub fn delete_file_or_folder(base_dir: String, sub_path: String) -> Result<String, String> {
    delete_or_schedule(&base_dir, &sub_path)
        .map(|scheduled| if scheduled { "scheduled" } else { "deleted" }.to_string())
}

#[tauri::command]
pub fn create_new_folder(base_dir: String, sub_path: String) -> Result<(), String> {
    create_folder(&base_dir, &sub_path)
}

#[tauri::command]
pub async fn import_dropped_files(base_dir: String, sub_path: String, paths: Vec<String>) -> Result<usize, String> {
    tokio::task::spawn_blocking(move || import_paths(&base_dir, &sub_path, &paths))
        .await
        .map_err(|e| e.to_string())?
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

#[tauri::command]
pub fn delete_server_files(server_path: String) -> Result<(), String> {
    let path = std::path::Path::new(&server_path);
    if path.exists() {
        std::fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn update_server_version_info(state: State<DbState>, id: i64, version: String, jar_path: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
    update_server_version(&conn, id, &version, &jar_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_server_settings(
    state: State<DbState>,
    id: i64,
    name: String,
    jar_path: String,
    ram_min: i32,
    ram_max: i32,
    java_path: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
    update_server_profile(&conn, id, &name, &jar_path, ram_min, ram_max, &java_path).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct ImportScanResult {
    pub jar_files: Vec<String>,
    pub detected_port: Option<i32>,
    pub server_properties_exists: bool,
}

#[tauri::command]
pub fn scan_directory_for_import(directory_path: String) -> Result<ImportScanResult, String> {
    let path = std::path::Path::new(&directory_path);
    if !path.exists() || !path.is_dir() {
        return Err("Directory does not exist".to_string());
    }

    let mut jar_files = Vec::new();
    let mut detected_port = None;
    let mut server_properties_exists = false;

    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if entry_path.is_file() {
                if let Some(ext) = entry_path.extension() {
                    if ext == "jar" {
                        if let Some(filename) = entry_path.file_name() {
                            jar_files.push(filename.to_string_lossy().to_string());
                        }
                    }
                }
                if entry_path.file_name().and_then(|f| f.to_str()) == Some("server.properties") {
                    server_properties_exists = true;
                    if let Ok(content) = std::fs::read_to_string(&entry_path) {
                        for line in content.lines() {
                            if line.trim().starts_with("server-port=") {
                                if let Some(port_str) = line.split('=').nth(1) {
                                    if let Ok(port) = port_str.trim().parse::<i32>() {
                                        detected_port = Some(port);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    jar_files.sort();

    Ok(ImportScanResult {
        jar_files,
        detected_port,
        server_properties_exists,
    })
}
