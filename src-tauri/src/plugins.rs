use serde::Serialize;
use sha2::{Digest, Sha512};
use std::{
    collections::HashMap,
    fs::File,
    io::{Cursor, Read},
    path::Path,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::Emitter;
use zip::ZipArchive;

const USER_AGENT: &str = "MineDock/0.1.0 (https://github.com/empfi/MineDock)";
const UPDATE_CACHE_TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Clone)]
struct PluginCache {
    fingerprint: Vec<(String, u64, u64)>,
    plugins: Vec<InstalledPlugin>,
    updates_checked: Option<Instant>,
}

static PLUGIN_CACHE: OnceLock<Mutex<HashMap<String, PluginCache>>> = OnceLock::new();

#[derive(Clone, Serialize)]
pub struct InstalledPlugin {
    pub file_name: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub enabled: bool,
    pub icon_url: Option<String>,
    pub source: Option<String>,
    pub project_id: Option<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
    #[serde(skip_serializing)]
    sha512: String,
}

#[derive(Serialize)]
pub struct MarketplaceVersion {
    pub version: String,
    pub published: String,
}

#[derive(Serialize)]
pub struct MarketplacePlugin {
    pub source: String,
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub downloads: u64,
}

#[derive(Serialize)]
pub struct PluginDownload {
    pub url: String,
    pub file_name: String,
    pub version: String,
}

#[derive(Serialize)]
pub struct MarketplacePluginDetails {
    pub source: String,
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub downloads: u64,
    pub body: String,
    pub gallery: Vec<String>,
    pub categories: Vec<String>,
    pub project_url: String,
}

fn yaml_value(text: &str, key: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let (found, value) = line.split_once(':')?;
        (found.trim().trim_matches(['\'', '"']) == key).then(|| {
            value.trim().trim_matches(['\'', '"', ',']).to_string()
        })
    })
}

fn plugin_stub(path: &Path) -> InstalledPlugin {
    let file_name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    let enabled = file_name.ends_with(".jar");
    InstalledPlugin {
        name: file_name.trim_end_matches(".disabled").trim_end_matches(".jar").to_string(),
        version: "Unknown".into(),
        description: String::new(),
        file_name,
        enabled,
        icon_url: None,
        source: None,
        project_id: None,
        latest_version: None,
        update_available: false,
        sha512: String::new(),
    }
}

fn inspect_plugin(path: &Path) -> InstalledPlugin {
    let mut result = plugin_stub(path);
    result.sha512 = hash_file(path);
    let Ok(file) = File::open(path) else { return result };
    let Ok(mut jar) = zip::ZipArchive::new(file) else { return result };
    for descriptor in ["plugin.yml", "paper-plugin.yml", "fabric.mod.json", "quilt.mod.json"] {
        if let Ok(mut entry) = jar.by_name(descriptor) {
            let mut content = String::new();
            if entry.read_to_string(&mut content).is_ok() {
                if descriptor.ends_with(".json") {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(name) = json["name"].as_str() { result.name = name.to_string(); }
                        if let Some(version) = json["version"].as_str() { result.version = version.to_string(); }
                        if let Some(desc) = json["description"].as_str() { result.description = desc.to_string(); }
                    }
                } else {
                    result.name = yaml_value(&content, "name").unwrap_or(result.name);
                    result.version = yaml_value(&content, "version").unwrap_or(result.version);
                    result.description = yaml_value(&content, "description").unwrap_or_default();
                }
            }
            break;
        }
    }
    result
}

fn hash_file(path: &Path) -> String {
    let Ok(mut file) = File::open(path) else { return String::new() };
    let mut hasher = Sha512::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let Ok(read) = file.read(&mut buffer) else { return String::new() };
        if read == 0 { break; }
        hasher.update(&buffer[..read]);
    }
    hex::encode(hasher.finalize())
}

pub fn list_plugins(server_path: &str) -> Result<Vec<InstalledPlugin>, String> {
    let plugins_dir = Path::new(server_path).join("plugins");
    let mods_dir = Path::new(server_path).join("mods");
    
    let mut paths: Vec<_> = Vec::new();
    
    for dir in &[plugins_dir, mods_dir] {
        if dir.exists() {
            if let Ok(entries) = std::fs::read_dir(dir) {
                paths.extend(entries.flatten().map(|entry| entry.path()).filter(|path| {
                    let name = path.file_name().unwrap_or_default().to_string_lossy();
                    path.is_file() && (name.ends_with(".jar") || name.ends_with(".jar.disabled"))
                }));
            }
        }
    }
    
    paths.sort();
    let fingerprint: Vec<_> = paths.iter().filter_map(|path| {
        let metadata = path.metadata().ok()?;
        let modified = metadata.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
        Some((path.file_name()?.to_string_lossy().into_owned(), metadata.len(), modified))
    }).collect();
    let key = server_path.to_string();
    let cache = PLUGIN_CACHE.get_or_init(Default::default);
    if let Some(hit) = cache.lock().map_err(|e| e.to_string())?.get(&key)
        .filter(|entry| entry.fingerprint == fingerprint) {
        return Ok(hit.plugins.clone());
    }
    let mut plugins: Vec<_> = paths.iter().map(|path| plugin_stub(path)).collect();
    plugins.sort_by_key(|plugin| plugin.name.to_ascii_lowercase());
    cache.lock().map_err(|e| e.to_string())?.insert(key, PluginCache {
        fingerprint,
        plugins: plugins.clone(),
        updates_checked: None,
    });
    Ok(plugins)
}

fn clean_version(v: &str) -> String {
    let mut cleaned = v.trim().to_lowercase();
    if cleaned.starts_with('v') {
        cleaned.remove(0);
    }
    if let Some((base, _)) = cleaned.split_once('-') {
        cleaned = base.trim().to_string();
    }
    if let Some((base, _)) = cleaned.split_once('+') {
        cleaned = base.trim().to_string();
    }
    cleaned
}

fn is_update_available(installed: &str, latest: &str) -> bool {
    let inst_clean = clean_version(installed);
    let lat_clean = clean_version(latest);
    if inst_clean.is_empty() || lat_clean.is_empty() {
        return false;
    }
    if inst_clean == lat_clean {
        return false;
    }
    if inst_clean.contains(&lat_clean) || lat_clean.contains(&inst_clean) {
        return false;
    }
    true
}

async fn enrich_from_modrinth(client: &reqwest::Client, plugin: &mut InstalledPlugin, loaders: &str, game_versions: &str) -> Result<bool, String> {
    if plugin.sha512.is_empty() { return Ok(false); }
    let response = client.get(format!("https://api.modrinth.com/v2/version_file/{}", plugin.sha512))
        .query(&[("algorithm", "sha512")]).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() { return Ok(false); }
    let version: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let project_id = version["project_id"].as_str().ok_or("Missing Modrinth project")?.to_string();
    let project: serde_json::Value = client.get(format!("https://api.modrinth.com/v2/project/{project_id}"))
        .send().await.and_then(reqwest::Response::error_for_status).map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;
    let versions: serde_json::Value = client.get(format!("https://api.modrinth.com/v2/project/{project_id}/version"))
        .query(&[("loaders", loaders), ("game_versions", game_versions), ("include_changelog", "false")])
        .send().await.and_then(reqwest::Response::error_for_status).map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;
    let latest = versions.as_array().and_then(|items| items.first()).and_then(|item| item["version_number"].as_str()).map(str::to_owned);
    plugin.icon_url = project["icon_url"].as_str().map(str::to_owned);
    plugin.source = Some("Modrinth".into());
    plugin.project_id = Some(project_id);
    plugin.latest_version = latest.clone();
    plugin.update_available = latest.as_deref().is_some_and(|latest| is_update_available(&plugin.version, latest));
    Ok(true)
}

async fn enrich_from_hangar(client: &reqwest::Client, plugin: &mut InstalledPlugin, minecraft: &str) -> Result<(), String> {
    let hangar: serde_json::Value = client.get("https://hangar.papermc.io/api/v1/projects")
        .query(&[("query", plugin.name.as_str()), ("limit", "5"), ("platform", "PAPER")])
        .send().await.and_then(reqwest::Response::error_for_status).map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;
    if let Some(project) = hangar["result"].as_array().into_iter().flatten()
        .find(|project| project["name"].as_str().is_some_and(|name| name.eq_ignore_ascii_case(&plugin.name))) {
        if let (Some(owner), Some(slug)) = (project["namespace"]["owner"].as_str(), project["namespace"]["slug"].as_str()) {
            let id = format!("{owner}/{slug}");
            plugin.icon_url = project["avatarUrl"].as_str().map(str::to_owned);
            plugin.source = Some("Hangar".into());
            plugin.project_id = Some(id.clone());
            if let Ok(download) = resolve_download("Hangar", &id, minecraft, None, "plugin").await {
                plugin.latest_version = Some(download.version.clone());
                plugin.update_available = is_update_available(&plugin.version, &download.version);
            }
        }
    }
    Ok(())
}

pub async fn stream_plugin_updates(app: tauri::AppHandle, server_path: &str, minecraft: &str) -> Result<(), String> {
    let server_path = server_path.to_owned();
    let scan_path = server_path.clone();
    let mut plugins = tokio::task::spawn_blocking(move || list_plugins(&scan_path))
        .await.map_err(|e| e.to_string())??;
    let key = server_path.to_string();
    let cache = PLUGIN_CACHE.get_or_init(Default::default);
    if cache.lock().map_err(|e| e.to_string())?.get(&key)
        .and_then(|entry| entry.updates_checked)
        .is_some_and(|checked| checked.elapsed() < UPDATE_CACHE_TTL) {
        for plugin in plugins {
            let _ = app.emit("plugin-update-info", plugin);
        }
        return Ok(());
    }
    let client = reqwest::Client::builder().user_agent(USER_AGENT).build().map_err(|e| e.to_string())?;
    let loaders = serde_json::json!(["paper", "purpur", "spigot", "bukkit"]).to_string();
    let game_versions = serde_json::json!([minecraft]).to_string();
    for plugin in &mut plugins {
        let path = Path::new(&server_path).join("plugins").join(&plugin.file_name);
        *plugin = tokio::task::spawn_blocking(move || inspect_plugin(&path))
            .await.map_err(|e| e.to_string())?;
        if !enrich_from_modrinth(&client, plugin, &loaders, &game_versions).await.unwrap_or(false) {
            let _ = enrich_from_hangar(&client, plugin, minecraft).await;
        }
        let _ = app.emit("plugin-update-info", plugin.clone());
    }
    if let Some(entry) = cache.lock().map_err(|e| e.to_string())?.get_mut(&key) {
        entry.plugins = plugins;
        entry.updates_checked = Some(Instant::now());
    }
    Ok(())
}

pub async fn list_marketplace_versions(source: &str, id: &str, minecraft: &str) -> Result<Vec<MarketplaceVersion>, String> {
    let client = reqwest::Client::builder().user_agent(USER_AGENT).build().map_err(|e| e.to_string())?;
    if source == "Modrinth" {
        let loaders = serde_json::json!(["paper", "purpur", "spigot", "bukkit"]).to_string();
        let game_versions = serde_json::json!([minecraft]).to_string();
        let data: serde_json::Value = client.get(format!("https://api.modrinth.com/v2/project/{id}/version"))
            .query(&[("loaders", loaders.as_str()), ("game_versions", game_versions.as_str()), ("include_changelog", "false")])
            .send().await.and_then(reqwest::Response::error_for_status).map_err(|e| e.to_string())?
            .json().await.map_err(|e| e.to_string())?;
        return Ok(data.as_array().into_iter().flatten().filter_map(|item| Some(MarketplaceVersion {
            version: item["version_number"].as_str()?.into(),
            published: item["date_published"].as_str().unwrap_or("").into(),
        })).collect());
    }
    let data: serde_json::Value = client.get(format!("https://hangar.papermc.io/api/v1/projects/{id}/versions"))
        .query(&[("limit", "100"), ("platform", "PAPER"), ("platformVersion", minecraft)])
        .send().await.and_then(reqwest::Response::error_for_status).map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;
    Ok(data["result"].as_array().into_iter().flatten().filter_map(|item| Some(MarketplaceVersion {
        version: item["name"].as_str()?.into(),
        published: item["createdAt"].as_str().unwrap_or("").into(),
    })).collect())
}

pub fn set_plugin_enabled(server_path: &str, file_name: &str, enabled: bool) -> Result<(), String> {
    if file_name.contains(['/', '\\']) { return Err("Invalid plugin filename".into()); }
    let mut directory = Path::new(server_path).join("plugins");
    if !directory.join(file_name).exists() {
        directory = Path::new(server_path).join("mods");
    }
    let source = directory.join(file_name);
    let target_name = if enabled { file_name.trim_end_matches(".disabled").to_string() } else { format!("{file_name}.disabled") };
    std::fs::rename(source, directory.join(target_name)).map_err(|e| e.to_string())
}

pub fn remove_plugin(server_path: &str, file_name: &str) -> Result<(), String> {
    if file_name.contains(['/', '\\']) { return Err("Invalid plugin filename".into()); }
    let mut path = Path::new(server_path).join("plugins").join(file_name);
    if !path.exists() {
        path = Path::new(server_path).join("mods").join(file_name);
    }
    std::fs::remove_file(path).map_err(|e| e.to_string())
}

pub async fn search_marketplace(query: &str, minecraft: &str, page: u32, project_type: Option<&str>) -> Result<Vec<MarketplacePlugin>, String> {
    let client = reqwest::Client::builder().user_agent(USER_AGENT).build().map_err(|e| e.to_string())?;
    let mut results: Vec<MarketplacePlugin> = Vec::new();

    let p_type = project_type.unwrap_or("plugin");
    let query_hangar = p_type == "plugin";

    // Modrinth supports plugin, mod, and modpack
    let fetch_limit = if query_hangar { 12 } else { 50 }; // Fetch more to allow filtering
    let limit = if query_hangar { 12 } else { 24 };
    let offset = (page * limit).to_string();
    let facets = serde_json::json!([[format!("project_type:{p_type}")], ["server_side:required", "server_side:optional"], [format!("versions:{minecraft}")]]).to_string();
    let modrinth_res = client.get("https://api.modrinth.com/v2/search")
        .query(&[("query", query), ("limit", &fetch_limit.to_string()), ("offset", offset.as_str()), ("index", "downloads"), ("facets", facets.as_str())])
        .send().await.and_then(reqwest::Response::error_for_status);
    if let Ok(response) = modrinth_res {
        if let Ok(data) = response.json::<serde_json::Value>().await {
            if let Some(hits) = data["hits"].as_array() {
                let mut count = 0;
                for hit in hits {
                    if !query_hangar {
                        let client_side = hit["client_side"].as_str().unwrap_or("optional");
                        let server_side = hit["server_side"].as_str().unwrap_or("optional");
                        // Exclude purely client-side mods
                        if client_side == "required" && server_side == "optional" {
                            continue;
                        }
                    }
                    if count >= limit { break; }
                    count += 1;
                    
                    if let (Some(id), Some(name)) = (hit["project_id"].as_str(), hit["title"].as_str()) {
                        results.push(MarketplacePlugin {
                            source: "Modrinth".into(),
                            id: id.into(),
                            name: name.into(),
                            description: hit["description"].as_str().unwrap_or("").into(),
                            icon_url: hit["icon_url"].as_str().map(str::to_owned),
                            downloads: hit["downloads"].as_u64().unwrap_or(0),
                        });
                    }
                }
            }
        }
    }

    if query_hangar {
        let limit = if true { 12 } else { 24 };
        let offset = (page * limit).to_string();
        let hangar_res = client.get("https://hangar.papermc.io/api/v1/projects")
            .query(&[("query", query), ("limit", &limit.to_string()), ("offset", offset.as_str()), ("platform", "PAPER")])
            .send().await.and_then(reqwest::Response::error_for_status);
        if let Ok(response) = hangar_res {
            if let Ok(data) = response.json::<serde_json::Value>().await {
                if let Some(result) = data["result"].as_array() {
                    for project in result {
                        if let (Some(owner), Some(slug), Some(name)) = (
                            project["namespace"]["owner"].as_str(),
                            project["namespace"]["slug"].as_str(),
                            project["name"].as_str(),
                        ) {
                            results.push(MarketplacePlugin {
                                source: "Hangar".into(),
                                id: format!("{owner}/{slug}"),
                                name: name.into(),
                                description: project["description"].as_str().unwrap_or("").into(),
                                icon_url: project["avatarUrl"].as_str().map(str::to_owned),
                                downloads: project["stats"]["downloads"].as_u64().unwrap_or(0),
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(results)
}

pub async fn get_marketplace_plugin_details(source: &str, id: &str) -> Result<MarketplacePluginDetails, String> {
    let client = reqwest::Client::builder().user_agent(USER_AGENT).build().map_err(|e| e.to_string())?;
    if source == "Modrinth" {
        let url = format!("https://api.modrinth.com/v2/project/{id}");
        let project: serde_json::Value = client.get(&url)
            .send().await.and_then(reqwest::Response::error_for_status).map_err(|e| e.to_string())?
            .json().await.map_err(|e| e.to_string())?;

        let mut gallery = Vec::new();
        if let Some(images) = project["gallery"].as_array() {
            for img in images {
                if let Some(url) = img["url"].as_str() {
                    gallery.push(url.to_string());
                }
            }
        }

        let mut categories = Vec::new();
        if let Some(cats) = project["categories"].as_array() {
            for cat in cats {
                if let Some(c) = cat.as_str() {
                    categories.push(c.to_string());
                }
            }
        }

        let slug = project["slug"].as_str().unwrap_or(id);
        let project_url = format!("https://modrinth.com/plugin/{slug}");

        Ok(MarketplacePluginDetails {
            source: "Modrinth".into(),
            id: id.into(),
            name: project["title"].as_str().unwrap_or("Unknown").into(),
            description: project["description"].as_str().unwrap_or("").into(),
            icon_url: project["icon_url"].as_str().map(str::to_owned),
            downloads: project["downloads"].as_u64().unwrap_or(0),
            body: project["body"].as_str().unwrap_or("").into(),
            gallery,
            categories,
            project_url,
        })
    } else if source == "Hangar" {
        let url = format!("https://hangar.papermc.io/api/v1/projects/{id}");
        let project: serde_json::Value = client.get(&url)
            .send().await.and_then(reqwest::Response::error_for_status).map_err(|e| e.to_string())?
            .json().await.map_err(|e| e.to_string())?;

        let page_url = format!("https://hangar.papermc.io/api/v1/pages/{id}/main");
        let body = if let Ok(resp) = client.get(&page_url).send().await {
            if let Ok(page_json) = resp.json::<serde_json::Value>().await {
                page_json["contents"].as_str().unwrap_or_else(|| {
                    page_json["markdown"].as_str().unwrap_or("").into()
                }).to_string()
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        let mut categories = Vec::new();
        if let Some(cat) = project["category"].as_str() {
            categories.push(cat.to_string());
        }

        let project_url = format!("https://hangar.papermc.io/{id}");

        Ok(MarketplacePluginDetails {
            source: "Hangar".into(),
            id: id.into(),
            name: project["name"].as_str().unwrap_or("Unknown").into(),
            description: project["description"].as_str().unwrap_or("").into(),
            icon_url: project["avatarUrl"].as_str().map(str::to_owned),
            downloads: project["stats"]["downloads"].as_u64().unwrap_or(0),
            body,
            gallery: Vec::new(),
            categories,
            project_url,
        })
    } else {
        Err(format!("Unknown source: {source}"))
    }
}

pub async fn resolve_download(source: &str, id: &str, minecraft: &str, requested_version: Option<&str>, project_type: &str) -> Result<PluginDownload, String> {
    let client = reqwest::Client::builder().user_agent(USER_AGENT).build().map_err(|e| e.to_string())?;
    if source == "Modrinth" {
        let loaders_arr = if project_type == "mod" || project_type == "modpack" { vec!["fabric", "quilt", "forge", "neoforge"] } else { vec!["paper", "purpur", "spigot", "bukkit", "velocity", "waterfall", "bungeecord"] };
        let loaders = serde_json::json!(loaders_arr).to_string();
        let versions = serde_json::json!([minecraft]).to_string();
        let data: serde_json::Value = client.get(format!("https://api.modrinth.com/v2/project/{id}/version"))
            .query(&[("loaders", loaders.as_str()), ("game_versions", versions.as_str()), ("include_changelog", "false")])
            .send().await.and_then(reqwest::Response::error_for_status).map_err(|e| e.to_string())?
            .json().await.map_err(|e| e.to_string())?;
        let items = data.as_array().ok_or("Invalid Modrinth response")?;
        let version = requested_version.and_then(|requested| items.iter().find(|item| item["version_number"] == requested))
            .or_else(|| items.first()).ok_or("No compatible Modrinth version found")?;
        let file = version["files"].as_array().and_then(|files| files.iter().find(|file| file["primary"] == true).or_else(|| files.first()))
            .ok_or("No downloadable file found")?;
        return Ok(PluginDownload {
            url: file["url"].as_str().ok_or("Missing download URL")?.into(),
            file_name: file["filename"].as_str().ok_or("Missing filename")?.into(),
            version: version["version_number"].as_str().unwrap_or("Unknown").into(),
        });
    }
    let data: serde_json::Value = client.get(format!("https://hangar.papermc.io/api/v1/projects/{id}/versions"))
        .query(&[("limit", "100"), ("platform", "PAPER"), ("platformVersion", minecraft)])
        .send().await.and_then(reqwest::Response::error_for_status).map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;
    let items = data["result"].as_array().ok_or("Invalid Hangar response")?;
    let version = requested_version.and_then(|requested| items.iter().find(|item| item["name"] == requested))
        .or_else(|| items.first()).ok_or("No compatible Hangar version found")?;
    let download = &version["downloads"]["PAPER"];
    Ok(PluginDownload {
        url: download["downloadUrl"].as_str().ok_or("This Hangar release uses an external download")?.into(),
        file_name: download["fileInfo"]["name"].as_str().unwrap_or(&format!("{id}.jar")).to_string(),
        version: version["name"].as_str().unwrap_or("Unknown").into(),
    })
}

pub async fn install_plugin(app: &tauri::AppHandle, id: &str, name: &str, server_path: &str, download: PluginDownload, replace: Option<String>, project_type: &str) -> Result<(), String> {
    if download.file_name.contains(['/', '\\']) { return Err("Invalid plugin filename".into()); }
    let directory = Path::new(server_path).join("plugins");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let mut response = reqwest::Client::builder().user_agent(USER_AGENT).build().map_err(|e| e.to_string())?
        .get(&download.url).send().await.and_then(reqwest::Response::error_for_status).map_err(|e| e.to_string())?;
    let total = response.content_length().unwrap_or(0);
    let temporary = directory.join(format!("{}.part", download.file_name));
    let mut file = File::create(&temporary).map_err(|e| e.to_string())?;
    let mut downloaded = 0_u64;
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        std::io::Write::write_all(&mut file, &chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let _ = app.emit("plugin-download-progress", serde_json::json!({
            "id": id, "name": name, "downloaded": downloaded, "total": total, "state": "downloading"
        }));
    }
    drop(file);
    let valid_plugin = File::open(&temporary).ok()
        .and_then(|file| zip::ZipArchive::new(file).ok())
        .is_some_and(|mut jar| {
            if project_type == "mod" || project_type == "modpack" {
                jar.by_name("fabric.mod.json").is_ok() || jar.by_name("quilt.mod.json").is_ok() || jar.by_name("META-INF/mods.toml").is_ok() || jar.by_name("mcmod.info").is_ok()
            } else {
                jar.by_name("plugin.yml").is_ok() || jar.by_name("paper-plugin.yml").is_ok() || jar.by_name("bungee.yml").is_ok() || jar.by_name("velocity-plugin.json").is_ok()
            }
        });
    if !valid_plugin {
        let _ = std::fs::remove_file(&temporary);
        let msg = if project_type == "mod" || project_type == "modpack" { "Downloaded file is not a valid Mod JAR" } else { "Downloaded file is not a valid Plugin JAR" };
        return Err(msg.into());
    }
    let target = directory.join(&download.file_name);
    if let Some(old) = replace {
        if old.contains(['/', '\\']) { return Err("Invalid plugin filename".into()); }
        let old = directory.join(old);
        if old == target && old.exists() {
            let backup = directory.join(format!("{}.minedock-backup", download.file_name));
            std::fs::rename(&old, &backup).map_err(|e| e.to_string())?;
            if let Err(error) = std::fs::rename(&temporary, &target) {
                let _ = std::fs::rename(backup, old);
                return Err(error.to_string());
            }
            let _ = std::fs::remove_file(backup);
            return Ok(());
        }
        std::fs::rename(&temporary, &target).map_err(|e| e.to_string())?;
        if old.exists() { std::fs::remove_file(old).map_err(|e| e.to_string())?; }
        return Ok(());
    }
    std::fs::rename(temporary, target).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::yaml_value;

    #[test]
    fn reads_plugin_descriptor_values() {
        let yaml = "name: Example\nversion: '1.2.3'\ndescription: Test plugin\n";
        assert_eq!(yaml_value(yaml, "name").as_deref(), Some("Example"));
        assert_eq!(yaml_value(yaml, "version").as_deref(), Some("1.2.3"));
    }
}



#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MrpackIndex {
    pub dependencies: std::collections::HashMap<String, String>,
    pub files: Vec<MrpackFile>,
}

#[derive(serde::Deserialize)]
pub struct MrpackFile {
    pub path: String,
    pub downloads: Vec<String>,
    pub env: Option<MrpackEnv>,
}

#[derive(serde::Deserialize)]
pub struct MrpackEnv {
    pub server: Option<String>,
}

pub async fn install_modpack(
    app: tauri::AppHandle,
    server_path: &str,
    server_id: i64,
    project_id: &str,
    version_id: &str,
) -> Result<(), String> {
    let client = reqwest::Client::builder().user_agent(USER_AGENT).build().map_err(|e| e.to_string())?;
    
    // 1. Get version details (support both version ID or project+version number)
    let url = format!("https://api.modrinth.com/v2/project/{project_id}/version/{version_id}");
    let version_info: serde_json::Value = client.get(&url).send().await
        .and_then(reqwest::Response::error_for_status).map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;
        
    let file = version_info["files"].as_array().and_then(|f| f.first()).ok_or("No files found in version")?;
    let download_url = file["url"].as_str().ok_or("No URL found")?;
    
    // 2. Download the .mrpack file to memory
    let mrpack_bytes = client.get(download_url).send().await
        .and_then(reqwest::Response::error_for_status).map_err(|e| e.to_string())?
        .bytes().await.map_err(|e| e.to_string())?;
        
    let cursor = std::io::Cursor::new(mrpack_bytes);
    let mut archive = ZipArchive::new(cursor).map_err(|e| format!("Failed to read mrpack: {e}"))?;
    
    // 3. Extract and parse modrinth.index.json
    let index: MrpackIndex = {
        let index_file = archive.by_name("modrinth.index.json").map_err(|_| "Missing modrinth.index.json".to_string())?;
        serde_json::from_reader(index_file).map_err(|e| format!("Invalid index: {e}"))?
    };
    
    let mc_version = index.dependencies.get("minecraft").ok_or("Missing minecraft version in modpack")?;
    
    // 4. Determine Modloader
    let mut loader_type = "vanilla".to_string();
    let mut loader_version = "".to_string();
    
    if let Some(fabric) = index.dependencies.get("fabric-loader") {
        loader_type = "fabric".to_string();
        loader_version = fabric.clone();
    } else if let Some(quilt) = index.dependencies.get("quilt-loader") {
        loader_type = "quilt".to_string();
        loader_version = quilt.clone();
    } else if index.dependencies.get("forge").is_some() || index.dependencies.get("neoforge").is_some() {
        return Err("Forge/NeoForge modpacks are not yet supported by the automated installer. Please install a Fabric or Quilt modpack.".into());
    }
    
    // 5. Download Modloader Server Jar if Fabric/Quilt
    if loader_type == "fabric" || loader_type == "quilt" {
        let domain = if loader_type == "fabric" { "meta.fabricmc.net/v2" } else { "meta.quiltmc.org/v3" };
        
        let installer_url = format!("https://{domain}/versions/installer");
        let installers: serde_json::Value = client.get(&installer_url).send().await
            .and_then(reqwest::Response::error_for_status).map_err(|e| e.to_string())?
            .json().await.map_err(|e| e.to_string())?;
        
        let installer_version = installers.as_array()
            .and_then(|arr| arr.first())
            .and_then(|first| first["version"].as_str())
            .unwrap_or(if loader_type == "fabric" { "1.0.1" } else { "0.9.0" });

        let jar_url = format!("https://{domain}/versions/loader/{mc_version}/{loader_version}/{installer_version}/server/jar");
        let jar_bytes = client.get(&jar_url).send().await
            .and_then(reqwest::Response::error_for_status).map_err(|e| e.to_string())?
            .bytes().await.map_err(|e| e.to_string())?;
        std::fs::write(std::path::Path::new(server_path).join("server.jar"), jar_bytes).map_err(|e| format!("Failed to write server.jar: {e}"))?;
        
        use tauri::Manager;
        let db_state = app.state::<crate::database::DbState>();
        let conn = db_state.db.lock().map_err(|e| e.to_string())?;
        crate::database::update_server_type_and_version(&conn, server_id, &loader_type, mc_version, "server.jar")
            .map_err(|e| format!("Failed to update database: {e}"))?;
    }
    
    // 6. Download Mod Jars
    let mods_dir = std::path::Path::new(server_path).join("mods");
    std::fs::create_dir_all(&mods_dir).map_err(|e| e.to_string())?;
    
    let mut tasks = tokio::task::JoinSet::new();
    
    for file in index.files {
        if let Some(env) = &file.env {
            if env.server.as_deref() == Some("unsupported") {
                continue; // Skip client-only mods
            }
        }
        if let Some(url) = file.downloads.first().cloned() {
            let path = std::path::Path::new(server_path).join(&file.path);
            let c = client.clone();
            tasks.spawn(async move {
                if let Some(parent) = path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if let Ok(res) = c.get(&url).send().await.and_then(|r| r.error_for_status()) {
                    if let Ok(bytes) = res.bytes().await {
                        let _ = std::fs::write(&path, bytes);
                    }
                }
            });
        }
    }
    
    while let Some(res) = tasks.join_next().await {
        if let Err(e) = res {
            println!("Failed to download mod: {}", e);
        }
    }
    
    // 7. Extract overrides
    let server_path_obj = std::path::Path::new(server_path);
    for i in 0..archive.len() {
        if let Ok(mut file) = archive.by_index(i) {
            let name = file.name().to_string();
            if name.starts_with("overrides/") || name.starts_with("server-overrides/") {
                let strip_prefix = if name.starts_with("overrides/") { "overrides/" } else { "server-overrides/" };
                let target_path = server_path_obj.join(name.strip_prefix(strip_prefix).unwrap());
                if file.is_dir() {
                    let _ = std::fs::create_dir_all(&target_path);
                } else {
                    if let Some(parent) = target_path.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    if let Ok(mut out) = std::fs::File::create(&target_path) {
                        let _ = std::io::copy(&mut file, &mut out);
                    }
                }
            }
        }
    }
    
    Ok(())
}
