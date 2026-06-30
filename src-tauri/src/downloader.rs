use reqwest::Client;
use serde::{Deserialize, Serialize};
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
    let manifest = client
        .get(url)
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
    version
        .split(|c: char| !c.is_ascii_digit())
        .filter_map(|part| part.parse().ok())
        .collect()
}

pub async fn fetch_software_versions(server_type: &str) -> Result<Vec<String>, String> {
    if server_type == "vanilla" {
        return Ok(fetch_versions()
            .await?
            .versions
            .into_iter()
            .filter(|version| version.version_type == "release")
            .map(|version| version.id)
            .collect());
    }

    let client = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    if server_type == "fabric" {
        let json: serde_json::Value = client
            .get("https://meta.fabricmc.net/v2/versions/game")
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        return Ok(json
            .as_array()
            .into_iter()
            .flatten()
            .filter(|item| item["stable"].as_bool() == Some(true))
            .filter_map(|item| item["version"].as_str().map(str::to_owned))
            .collect());
    }
    if server_type == "forge" || server_type == "neoforge" {
        let url = if server_type == "forge" {
            "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml"
        } else {
            "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml"
        };
        let xml = client
            .get(url)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|e| e.to_string())?
            .text()
            .await
            .map_err(|e| e.to_string())?;
        let mut versions: Vec<String> = xml
            .split("<version>")
            .skip(1)
            .filter_map(|part| part.split("</version>").next())
            .filter_map(|artifact| {
                if server_type == "forge" {
                    artifact
                        .split_once('-')
                        .map(|(minecraft, _)| minecraft.to_string())
                } else {
                    let mut parts = artifact.split('.');
                    Some(format!("1.{}.{}", parts.next()?, parts.next()?))
                }
            })
            .collect();
        versions.sort_by_key(|version| std::cmp::Reverse(version_numbers(version)));
        versions.dedup();
        return Ok(versions);
    }
    let url = match server_type {
        "paper" | "velocity" => format!("https://fill.papermc.io/v3/projects/{server_type}"),
        "purpur" => "https://api.purpurmc.org/v2/purpur".to_string(),
        _ => return Err(format!("Unsupported server type: {server_type}")),
    };
    let json: serde_json::Value = client
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let mut versions: Vec<String> = if server_type == "purpur" {
        json["versions"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|version| version.as_str().map(str::to_owned))
            .collect()
    } else {
        json["versions"]
            .as_object()
            .into_iter()
            .flat_map(|groups| groups.values())
            .filter_map(|group| group.as_array())
            .flatten()
            .filter_map(|version| version.as_str().map(str::to_owned))
            .collect()
    };
    versions.sort_by_key(|version| std::cmp::Reverse(version_numbers(version)));
    versions.dedup();
    Ok(versions)
}

pub async fn install_mod_loader(
    app: AppHandle,
    server_type: String,
    minecraft: String,
    server_path: String,
    java_path: String,
    requested_loader: Option<String>,
) -> Result<String, String> {
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    if server_type == "fabric" {
        let loaders: serde_json::Value = client
            .get(format!(
                "https://meta.fabricmc.net/v2/versions/loader/{minecraft}"
            ))
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        let loader = requested_loader.as_deref().or_else(|| loaders
            .as_array()
            .and_then(|items| items.first())
            .and_then(|item| item["loader"]["version"].as_str()))
            .ok_or("No Fabric loader found")?;
        let installers: serde_json::Value = client
            .get("https://meta.fabricmc.net/v2/versions/installer")
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        let installer = installers
            .as_array()
            .and_then(|items| {
                items
                    .iter()
                    .find(|item| item["stable"].as_bool() == Some(true))
            })
            .and_then(|item| item["version"].as_str())
            .ok_or("No Fabric installer found")?;
        let url = format!("https://meta.fabricmc.net/v2/versions/loader/{minecraft}/{loader}/{installer}/server/jar");
        download_url(
            app,
            &client,
            &url,
            &Path::new(&server_path).join("server.jar"),
        )
        .await?;
        return Ok("server.jar".into());
    }

    let (metadata_url, base, artifact) = if server_type == "forge" {
        (
            "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml",
            "https://maven.minecraftforge.net/net/minecraftforge/forge",
            "forge",
        )
    } else {
        (
            "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml",
            "https://maven.neoforged.net/releases/net/neoforged/neoforge",
            "neoforge",
        )
    };
    let xml = client
        .get(metadata_url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let candidates: Vec<&str> = xml
        .split("<version>")
        .skip(1)
        .filter_map(|part| part.split("</version>").next())
        .filter(|candidate| {
            if server_type == "forge" {
                candidate.starts_with(&format!("{minecraft}-"))
            } else {
                let suffix = minecraft.strip_prefix("1.").unwrap_or(&minecraft);
                candidate.starts_with(&format!("{suffix}."))
            }
        })
        .collect();
    let requested_artifact = requested_loader.map(|version| {
        if server_type == "forge" && !version.starts_with(&format!("{minecraft}-")) {
            format!("{minecraft}-{version}")
        } else {
            version
        }
    });
    let version = match requested_artifact.as_deref() {
        Some(requested) => candidates.iter().copied().find(|candidate| *candidate == requested)
            .ok_or_else(|| format!("{server_type} loader {requested} is unavailable"))?,
        None => candidates.last().copied().ok_or_else(|| format!(
            "No {server_type} build found for Minecraft {minecraft}"
        ))?,
    };
    let installer = Path::new(&server_path).join(format!("{artifact}-installer.jar"));
    download_url(
        app,
        &client,
        &format!("{base}/{version}/{artifact}-{version}-installer.jar"),
        &installer,
    )
    .await?;
    let status = std::process::Command::new(java_path)
        .current_dir(&server_path)
        .args([
            "-jar",
            installer.to_string_lossy().as_ref(),
            "--installServer",
            &server_path,
        ])
        .status()
        .map_err(|e| format!("Could not run loader installer: {e}"))?;
    if !status.success() {
        return Err(format!("{server_type} installer failed"));
    }
    let _ = std::fs::remove_file(installer);
    let args = walkdir::WalkDir::new(Path::new(&server_path).join("libraries"))
        .into_iter()
        .filter_map(Result::ok)
        .find(|entry| entry.file_name() == "win_args.txt")
        .ok_or("Loader launch arguments were not created")?;
    let relative = args
        .path()
        .strip_prefix(&server_path)
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "@{}",
        relative.to_string_lossy().replace('\\', "/")
    ))
}

async fn download_url(
    app: AppHandle,
    client: &Client,
    url: &str,
    path: &Path,
) -> Result<(), String> {
    let mut response = client
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|e| e.to_string())?;
    let total = response.content_length().unwrap_or(0);
    let mut file = File::create(path).map_err(|e| e.to_string())?;
    let mut downloaded = 0;
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let _ = app.emit("download-progress", DownloadProgress { downloaded, total });
    }
    Ok(())
}

pub async fn fetch_software_version_info(
    server_type: &str,
) -> Result<Vec<SoftwareVersionInfo>, String> {
    let versions = fetch_software_versions(server_type).await?;
    let release_times: std::collections::HashMap<String, String> = fetch_versions()
        .await?
        .versions
        .into_iter()
        .map(|version| (version.id, version.release_time))
        .collect();
    Ok(versions
        .into_iter()
        .map(|id| SoftwareVersionInfo {
            release_time: release_times.get(&id).cloned(),
            id,
        })
        .collect())
}

fn papermc_download_url(builds: &serde_json::Value) -> Option<&str> {
    let builds = builds.as_array()?;
    builds
        .iter()
        .find(|build| build["channel"] == "STABLE")
        .or_else(|| builds.first())?["downloads"]["server:default"]["url"]
        .as_str()
}

pub async fn download_server_software(
    app: AppHandle,
    server_type: String,
    version: String,
    dest_path: String,
) -> Result<(), String> {
    let client = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    let jar_url = match server_type.as_str() {
        "vanilla" => {
            let version_url = fetch_versions()
                .await?
                .versions
                .into_iter()
                .find(|item| item.id == version)
                .ok_or(format!("Vanilla version not found: {version}"))?
                .url;
            let detail = client
                .get(version_url)
                .send()
                .await
                .and_then(reqwest::Response::error_for_status)
                .map_err(|e| e.to_string())?
                .json::<VersionDetail>()
                .await
                .map_err(|e| e.to_string())?;
            detail
                .downloads
                .server
                .ok_or("No Vanilla server download found")?
                .url
        }
        "purpur" => format!("https://api.purpurmc.org/v2/purpur/{version}/latest/download"),
        "paper" | "velocity" => {
            let builds: serde_json::Value = client
                .get(format!(
                    "https://fill.papermc.io/v3/projects/{server_type}/versions/{version}/builds"
                ))
                .send()
                .await
                .and_then(reqwest::Response::error_for_status)
                .map_err(|e| e.to_string())?
                .json()
                .await
                .map_err(|e| e.to_string())?;
            papermc_download_url(&builds)
                .ok_or(format!("No {server_type} build found for {version}"))?
                .to_string()
        }
        _ => return Err(format!("Unsupported server type: {server_type}")),
    };

    let mut response = client
        .get(jar_url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|e| e.to_string())?;
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

pub async fn download_server_jar(
    app: AppHandle,
    version_url: String,
    dest_path: String,
) -> Result<(), String> {
    let client = Client::new();

    // Fetch version details to get the actual server.jar URL
    let detail = client
        .get(&version_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<VersionDetail>()
        .await
        .map_err(|e| e.to_string())?;

    let server_download = detail
        .downloads
        .server
        .ok_or("No server download found for this version")?;
    let jar_url = server_download.url;
    let total_size = server_download.size;

    let mut response = client
        .get(&jar_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let path = Path::new(&dest_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut file = File::create(path).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;

    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        let _ = app.emit(
            "download-progress",
            DownloadProgress {
                downloaded,
                total: total_size,
            },
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{papermc_download_url, VersionManifest};

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
