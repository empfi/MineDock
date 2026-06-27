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
    pub release_time: String,
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
