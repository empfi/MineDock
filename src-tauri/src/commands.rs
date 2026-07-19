use crate::backups::{
    create_backup, delete_backup as del_backup, list_backups, restore_backup, restore_backup_clean,
    verify_backup, BackupInfo, BackupVerification,
};
use crate::database::{
    add_server, delete_server, get_server, get_servers, get_settings, update_server_port,
    update_server_profile, update_server_sharing, update_server_status, update_server_version,
    update_settings, DbState,
};
use crate::downloader::{
    download_server_jar, download_server_software, fetch_software_version_info,
    fetch_software_versions, fetch_versions, install_mod_loader, SoftwareVersionInfo,
    VersionManifest,
};
use crate::files::{
    create_folder, delete_or_schedule, import_paths, list_directory, list_log_summaries,
    move_entries, move_entry, read_log_file, read_text_file, search_files, write_text_file, FileInfo, FileSearchResult, LogSummary,
};
use crate::models::{AppSettings, Server};
use crate::paths;
use crate::plugins::{
    install_plugin, list_marketplace_versions, list_plugins, remove_plugin, resolve_download,
    search_marketplace, set_plugin_enabled, stream_plugin_updates, InstalledPlugin,
    MarketplacePlugin, MarketplacePluginDetails, MarketplaceVersion,
};
use crate::process::{java_major, ProcessManager};
use crate::worlds::{
    activate_world, create_world, delete_world, export_world, import_world, list_worlds,
    rename_world, WorldInfo,
};
use tauri::{AppHandle, Emitter, Manager, State};

#[tauri::command]
pub fn get_worlds(server_path: String) -> Result<Vec<WorldInfo>, String> {
    list_worlds(&server_path)
}

#[tauri::command]
pub async fn get_installed_plugins(server_path: String) -> Result<Vec<InstalledPlugin>, String> {
    tokio::task::spawn_blocking(move || list_plugins(&server_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn check_plugin_updates(
    app: AppHandle,
    server_path: String,
    minecraft_version: String,
    server_type: String,
) -> Result<(), String> {
    stream_plugin_updates(app, &server_path, &minecraft_version, &server_type).await
}

#[tauri::command]
pub async fn get_plugin_versions(
    source: String,
    project_id: String,
    minecraft_version: String,
) -> Result<Vec<MarketplaceVersion>, String> {
    list_marketplace_versions(&source, &project_id, &minecraft_version).await
}

#[tauri::command]
pub async fn search_plugins(
    query: String,
    minecraft_version: String,
    page: u32,
    project_type: Option<String>,
) -> Result<Vec<MarketplacePlugin>, String> {
    search_marketplace(&query, &minecraft_version, page, project_type.as_deref()).await
}

#[tauri::command]
pub async fn get_marketplace_plugin_details(
    source: String,
    id: String,
) -> Result<MarketplacePluginDetails, String> {
    crate::plugins::get_marketplace_plugin_details(&source, &id).await
}

#[tauri::command]
pub async fn install_modpack(
    app: AppHandle,
    server_path: String,
    server_id: i64,
    project_id: String,
    version_id: String,
) -> Result<(), String> {
    let id = format!("Modrinth:{project_id}");
    let _ = app.emit(
        "install-progress",
        serde_json::json!({ "id": id, "name": project_id, "state": "downloading" }),
    );
    let result = crate::plugins::install_modpack(
        app.clone(),
        &server_path,
        server_id,
        &project_id,
        &version_id,
    )
    .await;
    let _ = app.emit(
        "install-progress",
        serde_json::json!({
            "id": id, "name": project_id, "state": if result.is_ok() { "done" } else { "failed" }
        }),
    );
    result
}

#[tauri::command]
pub async fn install_marketplace_plugin(
    app: AppHandle,
    server_path: String,
    source: String,
    project_id: String,
    plugin_name: String,
    minecraft_version: String,
    server_type: String,
    project_type: String,
    replace_file: Option<String>,
    version: Option<String>,
) -> Result<(), String> {
    let download = resolve_download(
        &source,
        &project_id,
        &minecraft_version,
        version.as_deref(),
        &project_type,
        &server_type,
    )
    .await?;
    let id = format!("{source}:{project_id}");
    if source == "Modrinth" {
        let mut pending = download.dependencies.clone();
        let mut installed = std::collections::HashSet::new();
        while let Some((dependency_id, dependency_version)) = pending.pop() {
            if !installed.insert(dependency_id.clone()) {
                continue;
            }
            let dependency = resolve_download(
                &source,
                &dependency_id,
                &minecraft_version,
                dependency_version.as_deref(),
                &project_type,
                &server_type,
            )
            .await?;
            pending.extend(dependency.dependencies.clone());
            let directory = std::path::Path::new(&server_path).join(if project_type == "mod" {
                "mods"
            } else {
                "plugins"
            });
            if !directory.join(&dependency.file_name).exists() {
                install_plugin(
                    &app,
                    &format!("Modrinth:{dependency_id}"),
                    &dependency_id,
                    &server_path,
                    dependency,
                    None,
                    &project_type,
                )
                .await?;
            }
        }
    }
    let result = install_plugin(
        &app,
        &id,
        &plugin_name,
        &server_path,
        download,
        replace_file,
        &project_type,
    )
    .await;
    let _ = app.emit(
        "install-progress",
        serde_json::json!({
            "id": id, "name": plugin_name, "state": if result.is_ok() { "done" } else { "failed" }
        }),
    );
    result
}

#[tauri::command]
pub fn toggle_plugin(server_path: String, file_name: String, enabled: bool) -> Result<(), String> {
    set_plugin_enabled(&server_path, &file_name, enabled)
}

#[tauri::command]
pub fn delete_plugin(server_path: String, file_name: String) -> Result<(), String> {
    remove_plugin(&server_path, &file_name)
}

#[tauri::command]
pub fn create_server_world(
    server_path: String,
    name: String,
    seed: String,
    kind: String,
) -> Result<(), String> {
    create_world(&server_path, &name, &seed, &kind)
}

#[tauri::command]
pub fn activate_server_world(server_path: String, name: String) -> Result<(), String> {
    activate_world(&server_path, &name)
}

#[tauri::command]
pub fn rename_server_world(
    server_path: String,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
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
            .map_err(|_| "Player cache is not available yet")?,
    )
    .map_err(|e| e.to_string())?;
    Ok(cache
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|player| player["name"].as_str().map(str::to_string))
        .collect())
}

#[tauri::command]
pub async fn lookup_minecraft_player(username: String) -> Result<PlayerIdentity, String> {
    if username.len() < 3
        || username.len() > 16
        || !username
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Err("Enter a valid Minecraft username".to_string());
    }
    let response = reqwest::get(format!(
        "https://api.mojang.com/users/profiles/minecraft/{username}"
    ))
    .await
    .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err("Minecraft player not found".to_string());
    }
    response.json().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_whitelist_player(
    server_path: String,
    uuid: String,
    username: String,
    allowed: bool,
) -> Result<(), String> {
    let path = std::path::Path::new(&server_path).join("whitelist.json");
    let mut players: Vec<serde_json::Value> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    players.retain(|player| {
        !player["uuid"]
            .as_str()
            .is_some_and(|value| value.eq_ignore_ascii_case(&uuid))
    });
    if allowed {
        players.push(serde_json::json!({ "uuid": uuid, "name": username }));
    }
    std::fs::write(
        path,
        serde_json::to_string_pretty(&players).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_player_info(server_path: String, username: String) -> Result<PlayerInfo, String> {
    let root = std::path::Path::new(&server_path);
    let cache: serde_json::Value = std::fs::read_to_string(root.join("usercache.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| serde_json::json!([]));
    let uuid = if let Some(uuid) = cache
        .as_array()
        .and_then(|players| {
            players.iter().find(|player| {
                player["name"]
                    .as_str()
                    .is_some_and(|name| name.eq_ignore_ascii_case(&username))
            })
        })
        .and_then(|player| player["uuid"].as_str())
    {
        uuid.to_string()
    } else {
        let identity = lookup_minecraft_player(username.clone()).await?;
        let id = identity.id;
        if id.len() != 32 {
            return Err("Minecraft returned an invalid player UUID".to_string());
        }
        format!(
            "{}-{}-{}-{}-{}",
            &id[0..8],
            &id[8..12],
            &id[12..16],
            &id[16..20],
            &id[20..32]
        )
    };

    let ops: serde_json::Value = std::fs::read_to_string(root.join("ops.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| serde_json::json!([]));
    let is_op = ops.as_array().is_some_and(|players| {
        players.iter().any(|player| {
            player["uuid"]
                .as_str()
                .is_some_and(|value| value.eq_ignore_ascii_case(&uuid))
        })
    });
    let bans: serde_json::Value = std::fs::read_to_string(root.join("banned-players.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| serde_json::json!([]));
    let banned = bans.as_array().is_some_and(|players| {
        players.iter().any(|player| {
            player["uuid"]
                .as_str()
                .is_some_and(|value| value.eq_ignore_ascii_case(&uuid))
        })
    });
    let properties = std::fs::read_to_string(root.join("server.properties")).unwrap_or_default();
    let whitelist_enabled = properties
        .lines()
        .any(|line| line.trim().eq_ignore_ascii_case("white-list=true"));
    let whitelist: serde_json::Value = std::fs::read_to_string(root.join("whitelist.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| serde_json::json!([]));
    let whitelisted = whitelist.as_array().is_some_and(|players| {
        players.iter().any(|player| {
            player["uuid"]
                .as_str()
                .is_some_and(|value| value.eq_ignore_ascii_case(&uuid))
        })
    });

    let stats: serde_json::Value = std::fs::read_to_string(
        root.join("world")
            .join("stats")
            .join(format!("{uuid}.json")),
    )
    .ok()
    .and_then(|text| serde_json::from_str(&text).ok())
    .unwrap_or_default();
    let custom = &stats["stats"]["minecraft:custom"];
    let money = std::fs::read_to_string(
        root.join("plugins")
            .join("Essentials")
            .join("userdata")
            .join(format!("{}.yml", uuid.to_ascii_lowercase())),
    )
    .ok()
    .and_then(|content| {
        content.lines().find_map(|line| {
            line.trim().strip_prefix("money:").map(|value| {
                value
                    .trim()
                    .trim_matches('\'')
                    .trim_matches('"')
                    .to_string()
            })
        })
    });

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
    if conn
        .query_row(
            "SELECT COUNT(*) FROM servers WHERE port = ?1",
            [server.port],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        > 0
    {
        return Err(format!(
            "Port {} is already assigned to another server",
            server.port
        ));
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
    if conn
        .query_row(
            "SELECT COUNT(*) FROM servers WHERE port = ?1 AND id != ?2",
            rusqlite::params![port, id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        > 0
    {
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
    if token.len() < 32 {
        return Err("Token must contain at least 32 characters".into());
    }
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
        if settings
            .tunnel_relay
            .parse::<std::net::SocketAddr>()
            .is_err()
            && !settings.tunnel_relay.contains(':')
        {
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
pub async fn start_mc_server(
    app: AppHandle,
    id: i64,
    process_manager: State<'_, ProcessManager>,
) -> Result<(), String> {
    let was_restarting = {
        let state = app.state::<DbState>();
        let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
        get_server(&conn, id)
            .map_err(|error| error.to_string())?
            .is_some_and(|server| server.status == "restarting")
    };
    let result = process_manager.start_server(id).await;
    if result.is_err() {
        let fallback = if was_restarting { "crashed" } else { "offline" };
        let state = app.state::<DbState>();
        if let Ok(conn) = state.db.lock() {
            let _ = update_server_status(&conn, id, fallback);
        }
        let _ = app.emit("server-status-changed", (id, fallback));
    }
    result
}

#[tauri::command]
pub async fn stop_mc_server(
    id: i64,
    process_manager: State<'_, ProcessManager>,
) -> Result<(), String> {
    process_manager.stop_server(id).await
}

#[tauri::command]
pub async fn kill_mc_server(
    id: i64,
    process_manager: State<'_, ProcessManager>,
) -> Result<(), String> {
    process_manager.kill_server(id).await
}

#[tauri::command]
pub async fn send_mc_command(
    id: i64,
    command: String,
    process_manager: State<'_, ProcessManager>,
) -> Result<(), String> {
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
pub async fn get_software_version_info(
    server_type: String,
) -> Result<Vec<SoftwareVersionInfo>, String> {
    fetch_software_version_info(&server_type).await
}

#[tauri::command]
pub async fn download_software(
    app: AppHandle,
    server_type: String,
    version: String,
    path: String,
) -> Result<(), String> {
    download_server_software(app, server_type, version, path).await
}

#[tauri::command]
pub async fn install_loader(
    app: AppHandle,
    server_type: String,
    version: String,
    server_path: String,
    java_path: String,
) -> Result<String, String> {
    install_mod_loader(app, server_type, version, server_path, java_path, None).await
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
pub fn search_server_files(base_dir: String, query: String) -> Result<Vec<FileSearchResult>, String> {
    search_files(&base_dir, &query)
}

#[tauri::command]
pub fn move_file_or_folder(base_dir: String, source_path: String, destination_path: String) -> Result<(), String> {
    move_entry(&base_dir, &source_path, &destination_path)
}

#[tauri::command]
pub fn move_files_or_folders(base_dir: String, source_paths: Vec<String>, destination_dir: String) -> Result<(), String> {
    move_entries(&base_dir, &source_paths, &destination_dir)
}

#[tauri::command]
pub fn read_file_content(base_dir: String, sub_path: String) -> Result<String, String> {
    read_text_file(&base_dir, &sub_path)
}

#[tauri::command]
pub async fn get_log_summaries(base_dir: String) -> Result<Vec<LogSummary>, String> {
    tokio::task::spawn_blocking(move || list_log_summaries(&base_dir))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_log_content(base_dir: String, name: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || read_log_file(&base_dir, &name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn save_file_content(
    base_dir: String,
    sub_path: String,
    content: String,
) -> Result<(), String> {
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
pub async fn import_dropped_files(
    base_dir: String,
    sub_path: String,
    paths: Vec<String>,
) -> Result<usize, String> {
    tokio::task::spawn_blocking(move || import_paths(&base_dir, &sub_path, &paths))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_mc_backup(
    app: tauri::AppHandle,
    server_path: String,
    backup_name: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || create_backup(&app, &server_path, &backup_name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn list_mc_backups(server_path: String) -> Result<Vec<BackupInfo>, String> {
    list_backups(&server_path)
}

#[tauri::command]
pub async fn verify_mc_backup(
    server_path: String,
    backup_name: String,
) -> Result<BackupVerification, String> {
    tokio::task::spawn_blocking(move || verify_backup(&server_path, &backup_name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn restore_mc_backup(
    app: tauri::AppHandle,
    server_path: String,
    backup_name: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || restore_backup(&app, &server_path, &backup_name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn restore_safe_apply_backup(
    app: tauri::AppHandle,
    server_path: String,
    backup_name: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || restore_backup_clean(&app, &server_path, &backup_name))
        .await
        .map_err(|e| e.to_string())?
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

#[derive(serde::Serialize)]
pub struct ServerDiskUsage {
    total: u64,
    worlds: u64,
    backups: u64,
    additions: u64,
}

#[tauri::command]
pub async fn get_server_disk_usage(
    state: State<'_, DbState>,
    id: i64,
) -> Result<ServerDiskUsage, String> {
    let path = {
        let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
        get_server(&conn, id)
            .map_err(|e| e.to_string())?
            .ok_or("Server not found")?
            .install_path
    };
    tokio::task::spawn_blocking(move || {
        let root = std::path::Path::new(&path);
        let mut usage = ServerDiskUsage {
            total: 0,
            worlds: 0,
            backups: 0,
            additions: 0,
        };
        for entry in walkdir::WalkDir::new(root)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
        {
            let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
            usage.total += size;
            let relative = entry.path().strip_prefix(root).unwrap_or(entry.path());
            if relative.starts_with(".minedock") {
                usage.backups += size;
            } else if relative.starts_with("plugins") || relative.starts_with("mods") {
                usage.additions += size;
            } else if relative
                .components()
                .next()
                .is_some_and(|part| part.as_os_str().to_string_lossy().starts_with("world"))
            {
                usage.worlds += size;
            }
        }
        Ok(usage)
    })
    .await
    .map_err(|e| e.to_string())?
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
            let path = PathBuf::from(local_app_data)
                .join("Programs")
                .join("Eclipse Adoptium");
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
pub async fn install_managed_java(app: AppHandle, major: u32) -> Result<String, String> {
    if ![8, 16, 17, 21].contains(&major) {
        return Err("Unsupported Java version".into());
    }
    let root = paths::app_data_dir(&app)?
        .join("runtimes")
        .join(format!("java-{major}"));
    let executable = root
        .join("bin")
        .join(if cfg!(windows) { "java.exe" } else { "java" });
    if executable.exists() {
        return Ok(executable.to_string_lossy().into_owned());
    }
    let url = format!("https://api.adoptium.net/v3/binary/latest/{major}/ga/windows/x64/jre/hotspot/normal/eclipse");
    let bytes = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    let target = root.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut archive =
            zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
        let temporary = target.with_extension("download");
        let _ = std::fs::remove_dir_all(&temporary);
        std::fs::create_dir_all(&temporary).map_err(|e| e.to_string())?;
        archive.extract(&temporary).map_err(|e| e.to_string())?;
        let extracted = std::fs::read_dir(&temporary)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .find(|entry| entry.path().is_dir())
            .ok_or("Java archive is empty")?
            .path();
        let _ = std::fs::remove_dir_all(&target);
        std::fs::rename(extracted, &target).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_dir_all(temporary);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(executable.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn get_java_major(path: String) -> Result<u32, String> {
    java_major(&path)
}

#[tauri::command]
pub async fn delete_server_files(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    let server_path = {
        let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
        get_server(&conn, id)
            .map_err(|e| e.to_string())?
            .ok_or("Server not found")?
            .install_path
    };
    tokio::task::spawn_blocking(move || {
        let path = std::path::Path::new(&server_path);
        if path.exists() {
            std::fs::remove_dir_all(path).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn update_server_version_info(
    state: State<DbState>,
    id: i64,
    version: String,
    jar_path: String,
) -> Result<(), String> {
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
    run_in_container: bool,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
    update_server_profile(&conn, id, &name, &jar_path, ram_min, ram_max, &java_path, run_in_container)
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct ImportScanResult {
    pub jar_files: Vec<String>,
    pub detected_port: Option<i32>,
    pub server_properties_exists: bool,
    pub detected_server_type: Option<String>,
    pub detected_version: Option<String>,
    pub detected_jar: Option<String>,
}

fn detect_version_from_text(text: &str) -> Option<String> {
    for marker in ["for Minecraft ", "Starting minecraft server version "] {
        if let Some(value) = text
            .lines()
            .rev()
            .find_map(|line| {
                line.split_once(marker).map(|(_, rest)| {
                    rest.split_whitespace()
                        .next()
                        .unwrap_or("")
                        .trim_matches(|c: char| c == ')' || c == ',')
                        .to_string()
                })
            })
            .filter(|value| !value.is_empty())
        {
            return Some(normalize_minecraft_version(&value));
        }
    }
    None
}

fn normalize_minecraft_version(value: &str) -> String {
    if let Some((_, minecraft)) = value.split_once("(MC: ") {
        return minecraft
            .split(')')
            .next()
            .unwrap_or(minecraft)
            .trim()
            .to_string();
    }
    value.trim().to_string()
}

fn inspect_server_jar(path: &std::path::Path) -> (Option<String>, Option<String>) {
    use std::io::Read;
    let Ok(file) = std::fs::File::open(path) else {
        return (None, None);
    };
    let Ok(mut jar) = zip::ZipArchive::new(file) else {
        return (None, None);
    };
    let mut version = None;
    if let Ok(mut entry) = jar.by_name("version.json") {
        let mut content = String::new();
        if entry.read_to_string(&mut content).is_ok() {
            version = serde_json::from_str::<serde_json::Value>(&content)
                .ok()
                .and_then(|json| json["id"].as_str().map(normalize_minecraft_version));
        }
    }
    let mut server_type = None;
    if let Ok(mut entry) = jar.by_name("META-INF/MANIFEST.MF") {
        let mut manifest = String::new();
        let _ = entry.read_to_string(&mut manifest);
        let lower = manifest.to_ascii_lowercase();
        server_type = if lower.contains("purpur") {
            Some("purpur".into())
        } else if lower.contains("paper") {
            Some("paper".into())
        } else if lower.contains("velocity") {
            Some("velocity".into())
        } else if lower.contains("net.minecraft.server.main") {
            Some("vanilla".into())
        } else {
            None
        };
        if version.is_none() {
            version = detect_version_from_text(&manifest);
        }
    }
    (server_type, version)
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
    let mut detected_server_type = if path.join("velocity.toml").exists() {
        Some("velocity".to_string())
    } else if path.join("purpur.yml").exists() {
        Some("purpur".to_string())
    } else if path.join("paper.yml").exists()
        || path.join("config").join("paper-global.yml").exists()
    {
        Some("paper".to_string())
    } else {
        None
    };
    let mut detected_version = std::fs::read_to_string(path.join("version_history.json"))
        .ok()
        .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
        .and_then(|json| {
            json["currentVersion"]
                .as_str()
                .map(normalize_minecraft_version)
        });

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
    let detected_jar = jar_files
        .iter()
        .find(|name| name.as_str() == "server.jar")
        .or_else(|| {
            jar_files.iter().find(|name| {
                let lower = name.to_ascii_lowercase();
                lower.contains("paper") || lower.contains("purpur") || lower.contains("velocity")
            })
        })
        .or_else(|| jar_files.first())
        .cloned();
    if let Some(jar_name) = &detected_jar {
        let (jar_type, jar_version) = inspect_server_jar(&path.join(jar_name));
        if detected_server_type.is_none() {
            detected_server_type = jar_type;
        }
        if detected_version.is_none() {
            detected_version = jar_version;
        }
    }
    if detected_version.is_none() {
        detected_version = std::fs::read_to_string(path.join("logs").join("latest.log"))
            .ok()
            .and_then(|content| detect_version_from_text(&content));
    }

    Ok(ImportScanResult {
        jar_files,
        detected_port,
        server_properties_exists,
        detected_server_type,
        detected_version,
        detected_jar,
    })
}

#[cfg(test)]
mod import_tests {
    use super::normalize_minecraft_version;

    #[test]
    fn extracts_minecraft_version_from_paper_build() {
        assert_eq!(
            normalize_minecraft_version("1.21.4-232-12d8fe0 (MC: 1.21.4)"),
            "1.21.4"
        );
        assert_eq!(normalize_minecraft_version("1.20.6"), "1.20.6");
    }
}

#[tauri::command]
pub fn is_docker_available() -> bool {
    crate::process::is_docker_available()
}

#[tauri::command]
pub fn get_server_schedules(state: State<DbState>, server_id: i64) -> Result<Vec<crate::models::ServerSchedule>, String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
    crate::database::get_schedules(&conn, server_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_server_schedule(state: State<DbState>, schedule: crate::models::ServerSchedule) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
    crate::database::add_schedule(&conn, &schedule).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_server_schedule(state: State<DbState>, schedule: crate::models::ServerSchedule) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
    crate::database::update_schedule(&conn, &schedule).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_server_schedule(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
    crate::database::delete_schedule(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn trigger_schedule_now(app: AppHandle, state: State<'_, DbState>, id: i64) -> Result<(), String> {
    let schedule = {
        let conn = state.db.lock().map_err(|_| "Failed to lock DB")?;
        let mut found = None;
        if let Ok(mut stmt) = conn.prepare("SELECT server_id FROM schedules WHERE id = ?1") {
            if let Ok(server_id) = stmt.query_row([id], |row| row.get::<_, i64>(0)) {
                if let Ok(schedules) = crate::database::get_schedules(&conn, server_id) {
                    found = schedules.into_iter().find(|s| s.id == Some(id));
                }
            }
        }
        found.ok_or("Schedule not found")?
    };

    tokio::spawn(async move {
        crate::scheduler::run_schedule_tasks(app, schedule).await;
    });

    Ok(())
}
