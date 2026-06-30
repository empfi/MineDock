use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::Path;
use tauri::Emitter;
use walkdir::WalkDir;
use zip::write::{ExtendedFileOptions, FileOptions};

#[derive(Serialize, Deserialize)]
pub struct BackupInfo {
    pub name: String,
    pub size: u64,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct BackupVerification {
    pub files: usize,
    pub uncompressed_size: u64,
}

fn backup_path(server_path: &str, backup_name: &str) -> Result<std::path::PathBuf, String> {
    if backup_name.is_empty()
        || backup_name
            != Path::new(backup_name)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("")
    {
        return Err("Invalid backup name".into());
    }
    Ok(Path::new(server_path)
        .join(".minedock")
        .join("backups")
        .join(backup_name))
}

pub fn create_backup(
    app: &tauri::AppHandle,
    server_path: &str,
    backup_name: &str,
) -> Result<(), String> {
    let source_dir = Path::new(server_path);
    if !source_dir.exists() {
        return Err("Server path does not exist".to_string());
    }

    let backup_dir = source_dir.join(".minedock").join("backups");
    std::fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;

    let backup_file_path = backup_path(server_path, &format!("{backup_name}.zip"))?;
    let file = File::create(&backup_file_path).map_err(|e| e.to_string())?;

    let mut zip = zip::ZipWriter::new(file);
    let options: FileOptions<'_, ExtendedFileOptions> = FileOptions::default()
        .compression_method(zip::CompressionMethod::Stored) // Store method is 50x faster!
        .unix_permissions(0o755);

    // 1. Scan directory first to count total files for progress tracking
    let mut entries = Vec::new();
    for entry in WalkDir::new(source_dir) {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        // Skip the .minedock backup folder itself to avoid recursive backups
        if path.starts_with(&backup_dir) {
            continue;
        }

        entries.push(entry);
    }

    let total_files = entries.len();
    let mut processed_files = 0;

    // Report initial progress
    let _ = app.emit("backup-progress", 0);

    // 2. Add files to zip
    for entry in entries {
        let path = entry.path();
        let name = path.strip_prefix(source_dir).unwrap();

        if path.is_file() {
            zip.start_file(name.to_string_lossy(), options.clone())
                .map_err(|e| e.to_string())?;
            let mut f = File::open(path).map_err(|e| e.to_string())?;
            std::io::copy(&mut f, &mut zip).map_err(|e| e.to_string())?;
        } else if !name.as_os_str().is_empty() {
            zip.add_directory(name.to_string_lossy(), options.clone())
                .map_err(|e| e.to_string())?;
        }

        processed_files += 1;
        if total_files > 0 {
            let progress = (processed_files * 100) / total_files;
            // Emit progress event every 5% change or if complete
            if processed_files % 10 == 0 || progress == 100 {
                let _ = app.emit("backup-progress", progress);
            }
        }
    }

    zip.finish().map_err(|e| e.to_string())?;

    // Report final progress
    let _ = app.emit("backup-progress", 100);

    Ok(())
}

pub fn list_backups(server_path: &str) -> Result<Vec<BackupInfo>, String> {
    let backup_dir = Path::new(server_path).join(".minedock").join("backups");
    let mut backups = Vec::new();

    if backup_dir.exists() && backup_dir.is_dir() {
        for entry in std::fs::read_dir(backup_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("zip") {
                let metadata = entry.metadata().map_err(|e| e.to_string())?;
                let modified = metadata
                    .modified()
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                    .duration_since(std::time::SystemTime::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();

                // Simple formatting, could use chrono
                let created_at = format!("{}", modified);

                backups.push(BackupInfo {
                    name: entry.file_name().to_string_lossy().to_string(),
                    size: metadata.len(),
                    created_at,
                });
            }
        }
    }

    // sort by newest
    backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(backups)
}

pub fn verify_backup(server_path: &str, backup_name: &str) -> Result<BackupVerification, String> {
    let file = File::open(backup_path(server_path, backup_name)?).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Invalid ZIP: {e}"))?;
    let mut report = BackupVerification { files: 0, uncompressed_size: 0 };
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        if entry.enclosed_name().is_none() {
            return Err(format!("Unsafe path in backup: {}", entry.name()));
        }
        if entry.is_file() {
            report.files += 1;
            report.uncompressed_size += entry.size();
            std::io::copy(&mut entry, &mut std::io::sink())
                .map_err(|e| format!("Corrupt entry {}: {e}", entry.name()))?;
        }
    }
    Ok(report)
}

pub fn restore_backup(
    app: &tauri::AppHandle,
    server_path: &str,
    backup_name: &str,
) -> Result<(), String> {
    verify_backup(server_path, backup_name)?;
    let source_dir = Path::new(server_path);
    let backup_file_path = backup_path(server_path, backup_name)?;

    if !backup_file_path.exists() {
        return Err("Backup file not found".to_string());
    }

    let file = File::open(&backup_file_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    let total_files = archive.len();
    let _ = app.emit("backup-progress", 0);

    // Cache already created parent directories to avoid thousands of slow NTFS exists/create checks
    let mut created_dirs = std::collections::HashSet::new();

    for i in 0..total_files {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = match file.enclosed_name() {
            Some(path) => source_dir.join(path),
            None => continue,
        };

        if (*file.name()).ends_with('/') {
            std::fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
            created_dirs.insert(outpath);
        } else {
            if let Some(p) = outpath.parent() {
                if !created_dirs.contains(p) {
                    if !p.exists() {
                        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
                    }
                    created_dirs.insert(p.to_path_buf());
                }
            }
            let mut outfile = File::create(&outpath).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
        }

        if total_files > 0 {
            let progress = ((i + 1) * 100) / total_files;
            if (i + 1) % 10 == 0 || progress == 100 {
                let _ = app.emit("backup-progress", progress);
            }
        }
    }

    let _ = app.emit("backup-progress", 100);
    Ok(())
}

pub fn restore_backup_clean(
    app: &tauri::AppHandle,
    server_path: &str,
    backup_name: &str,
) -> Result<(), String> {
    verify_backup(server_path, backup_name)?;
    let source_dir = Path::new(server_path);
    let backup_file_path = backup_path(server_path, backup_name)?;
    let file = File::open(&backup_file_path).map_err(|e| e.to_string())?;
    zip::ZipArchive::new(file).map_err(|e| format!("Restore point is invalid: {e}"))?;

    for entry in std::fs::read_dir(source_dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.file_name().and_then(|name| name.to_str()) == Some(".minedock") {
            continue;
        }
        if path.is_dir() {
            std::fs::remove_dir_all(path).map_err(|e| e.to_string())?;
        } else {
            std::fs::remove_file(path).map_err(|e| e.to_string())?;
        }
    }

    restore_backup(app, server_path, backup_name)
}

pub fn delete_backup(server_path: &str, backup_name: &str) -> Result<(), String> {
    let backup_file_path = backup_path(server_path, backup_name)?;
    if backup_file_path.exists() {
        for attempt in 0..10 {
            match std::fs::remove_file(&backup_file_path) {
                Ok(_) => return Ok(()),
                Err(e) => {
                    if attempt == 9 {
                        return Err(format!("Failed to delete backup after 10 attempts: {}", e));
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::verify_backup;
    use std::io::Write;

    #[test]
    fn verifies_every_backup_entry() {
        let root = std::env::temp_dir().join(format!("minedock-backup-verify-{}", std::process::id()));
        let backup_dir = root.join(".minedock").join("backups");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&backup_dir).unwrap();
        let file = std::fs::File::create(backup_dir.join("test.zip")).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("world/level.dat", zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(b"level").unwrap();
        zip.finish().unwrap();
        let result = verify_backup(root.to_str().unwrap(), "test.zip").unwrap();
        assert_eq!(result.files, 1);
        assert_eq!(result.uncompressed_size, 5);
        std::fs::remove_dir_all(root).unwrap();
    }
}
