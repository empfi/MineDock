use serde::{Deserialize, Serialize};
use reqwest::Client;
use std::fs::File;
use std::io::Write;
use std::path::Path;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Deserialize, Debug)]
pub struct VersionManifest {
    pub latest: LatestVersions,
    pub versions: Vec<VersionInfo>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct LatestVersions {
    pub release: String,
    pub snapshot: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct VersionInfo {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub url: String,
    pub time: String,
    #[serde(rename = "releaseTime")]
    pub release_time: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct SoftwareVersionInfo {
    pub id: String,
    pub release_time: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct VersionDetail {
    pub downloads: Downloads,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Downloads {
    pub server: Option<DownloadFile>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct DownloadFile {
    pub sha1: String,
    pub size: u64,
    pub url: String,
}

pub async fn fetch_versions() -> Result<VersionManifest, String> {
    let client = Client::new();
    let url = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
    let manifest = client.get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<VersionManifest>()
        .await
        .map_err(|e| e.to_string())?;
    
    Ok(manifest)
}

const USER_AGENT: &str = "MineDock/0.1.0 (https://github.com/empfi/MineDock)";

fn version_numbers(version: &str) -> Vec<u32> {
    version.split(|c: char| !c.is_ascii_digit())
        .filter_map(|part| part.parse().ok())
        .collect()
}

pub async fn fetch_software_versions(server_type: &str) -> Result<Vec<String>, String> {
    if server_type == "vanilla" {
        return Ok(fetch_versions().await?.versions.into_iter()
            .filter(|version| version.version_type == "release")
            .map(|version| version.id)
            .collect());
    }

    let client = Client::builder().user_agent(USER_AGENT).build().map_err(|e| e.to_string())?;
    let url = match server_type {
        "paper" | "velocity" => format!("https://fill.papermc.io/v3/projects/{server_type}"),
        "purpur" => "https://api.purpurmc.org/v2/purpur".to_string(),
        _ => return Err(format!("Unsupported server type: {server_type}")),
    };
    let json: serde_json::Value = client.get(url).send().await
        .and_then(reqwest::Response::error_for_status).map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;

    let mut versions: Vec<String> = if server_type == "purpur" {
        json["versions"].as_array().into_iter().flatten()
            .filter_map(|version| version.as_str().map(str::to_owned)).collect()
    } else {
        json["versions"].as_object().into_iter().flat_map(|groups| groups.values())
            .filter_map(|group| group.as_array()).flatten()
            .filter_map(|version| version.as_str().map(str::to_owned)).collect()
    };
    versions.sort_by_key(|version| std::cmp::Reverse(version_numbers(version)));
    versions.dedup();
    Ok(versions)
}

pub async fn fetch_software_version_info(server_type: &str) -> Result<Vec<SoftwareVersionInfo>, String> {
    let versions = fetch_software_versions(server_type).await?;
    let release_times: std::collections::HashMap<String, String> = fetch_versions().await?
        .versions.into_iter()
        .map(|version| (version.id, version.release_time))
        .collect();
    Ok(versions.into_iter().map(|id| SoftwareVersionInfo {
        release_time: release_times.get(&id).cloned(),
        id,
    }).collect())
}

fn papermc_download_url(builds: &serde_json::Value) -> Option<&str> {
    let builds = builds.as_array()?;
    builds.iter().find(|build| build["channel"] == "STABLE")
        .or_else(|| builds.first())?["downloads"]["server:default"]["url"].as_str()
}

pub async fn download_server_software(
    app: AppHandle,
    server_type: String,
    version: String,
    dest_path: String,
) -> Result<(), String> {
    let client = Client::builder().user_agent(USER_AGENT).build().map_err(|e| e.to_string())?;
    let jar_url = match server_type.as_str() {
        "vanilla" => {
            let version_url = fetch_versions().await?.versions.into_iter()
                .find(|item| item.id == version).ok_or(format!("Vanilla version not found: {version}"))?.url;
            let detail = client.get(version_url).send().await
                .and_then(reqwest::Response::error_for_status).map_err(|e| e.to_string())?
                .json::<VersionDetail>().await.map_err(|e| e.to_string())?;
            detail.downloads.server.ok_or("No Vanilla server download found")?.url
        }
        "purpur" => format!("https://api.purpurmc.org/v2/purpur/{version}/latest/download"),
        "paper" | "velocity" => {
            let builds: serde_json::Value = client.get(format!(
                "https://fill.papermc.io/v3/projects/{server_type}/versions/{version}/builds"
            )).send().await.and_then(reqwest::Response::error_for_status)
                .map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
            papermc_download_url(&builds).ok_or(format!("No {server_type} build found for {version}"))?.to_string()
        }
        _ => return Err(format!("Unsupported server type: {server_type}")),
    };

    let mut response = client.get(jar_url).send().await
        .and_then(reqwest::Response::error_for_status).map_err(|e| e.to_string())?;
    let total = response.content_length().unwrap_or(0);
    let path = Path::new(&dest_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = File::create(path).map_err(|e| e.to_string())?;
    let mut downloaded = 0;
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let _ = app.emit("download-progress", DownloadProgress { downloaded, total });
    }
    Ok(())
}
#[derive(Clone, Serialize)]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
}

pub async fn download_server_jar(app: AppHandle, version_url: String, dest_path: String) -> Result<(), String> {
    let client = Client::new();
    
    // Fetch version details to get the actual server.jar URL
    let detail = client.get(&version_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<VersionDetail>()
        .await
        .map_err(|e| e.to_string())?;

    let server_download = detail.downloads.server.ok_or("No server download found for this version")?;
    let jar_url = server_download.url;
    let total_size = server_download.size;

    let mut response = client.get(&jar_url).send().await.map_err(|e| e.to_string())?;
    
    let path = Path::new(&dest_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    
    let mut file = File::create(path).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;

    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        
        let _ = app.emit("download-progress", DownloadProgress {
            downloaded,
            total: total_size,
        });
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{VersionManifest, papermc_download_url};

    #[test]
    fn parses_mojang_manifest_field_names() {
        let json = r#"{"latest":{"release":"1.21","snapshot":"1.21"},"versions":[{"id":"1.21","type":"release","url":"https://example.com","time":"2024-01-01","releaseTime":"2024-01-01"}]}"#;
        assert!(serde_json::from_str::<VersionManifest>(json).is_ok());
    }
    #[test]
    fn selects_stable_papermc_download() {
        let json = serde_json::json!([
            {"channel":"ALPHA","downloads":{"server:default":{"url":"alpha"}}},
            {"channel":"STABLE","downloads":{"server:default":{"url":"stable"}}}
        ]);
        assert_eq!(papermc_download_url(&json), Some("stable"));
    }
}
