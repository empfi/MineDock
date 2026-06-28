use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Debug)]
pub struct FileInfo {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64, // unix timestamp
}

#[derive(Serialize, Deserialize, Clone)]
pub struct LogSummary {
    pub name: String,
    pub modified: u64,
    pub infos: usize,
    pub warnings: usize,
    pub errors: usize,
}

// Ensures the requested path doesn't escape the base server directory
fn sanitize_path(base_dir: &str, requested_path: &str) -> Result<PathBuf, String> {
    let base_path = Path::new(base_dir);
    if !base_path.exists() {
        return Err("Base directory does not exist".to_string());
    }
    let base = base_path.canonicalize().map_err(|_| "Invalid base directory")?;
    let req = Path::new(requested_path);
    
    // We join the base with the requested, but we need to ensure it's safe
    // Since req could be absolute or have "..", we do a strict check
    let mut combined = base.clone();
    
    // Iterate over components of requested_path safely
    for comp in req.components() {
        match comp {
            std::path::Component::Normal(c) => combined.push(c),
            std::path::Component::ParentDir => {
                if !combined.pop() {
                    return Err("Path traversal attempt detected".to_string());
                }
            },
            std::path::Component::CurDir => {},
            _ => return Err("Invalid path component".to_string()),
        }
    }

    // After resolution, check if it still starts with base
    let final_path = if combined.exists() {
        combined.canonicalize().map_err(|_| "Failed to resolve path")?
    } else {
        // If it doesn't exist yet (e.g. for creating files), we can't canonicalize it directly.
        // We can canonicalize the parent.
        if let Some(parent) = combined.parent() {
            let p = parent.canonicalize().map_err(|_| "Failed to resolve parent path")?;
            if !p.starts_with(&base) {
                return Err("Path escapes base directory".to_string());
            }
        }
        combined
    };

    if final_path.exists() && !final_path.starts_with(&base) {
        return Err("Path escapes base directory".to_string());
    }

    Ok(final_path)
}

pub fn list_directory(base_dir: &str, sub_path: &str) -> Result<Vec<FileInfo>, String> {
    let full_path = sanitize_path(base_dir, sub_path)?;
    
    let mut files = Vec::new();
    if full_path.is_dir() {
        let entries = fs::read_dir(full_path).map_err(|e| e.to_string())?;
        for entry in entries {
            if let Ok(entry) = entry {
                if entry.file_name().to_string_lossy().starts_with(".minedock-") {
                    continue;
                }
                let metadata = entry.metadata().map_err(|e| e.to_string())?;
                let modified = metadata.modified()
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                    .duration_since(std::time::SystemTime::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();

                files.push(FileInfo {
                    name: entry.file_name().to_string_lossy().to_string(),
                    is_dir: metadata.is_dir(),
                    size: metadata.len(),
                    modified,
                });
            }
        }
    } else {
        return Err("Not a directory".to_string());
    }

    // Sort: directories first, then alphabetically
    files.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name))
    });

    Ok(files)
}

pub fn read_text_file(base_dir: &str, sub_path: &str) -> Result<String, String> {
    let full_path = sanitize_path(base_dir, sub_path)?;
    
    // basic size limit to prevent loading huge files (e.g. 5MB)
    if let Ok(meta) = fs::metadata(&full_path) {
        if meta.len() > 5 * 1024 * 1024 {
            return Err("File is too large to edit".to_string());
        }
    }
    
    fs::read_to_string(full_path).map_err(|e| e.to_string())
}

pub fn read_log_file(base_dir: &str, name: &str) -> Result<String, String> {
    let path = sanitize_path(base_dir, &format!("logs/{name}"))?;
    let mut content = String::new();
    if name.ends_with(".gz") {
        flate2::read::GzDecoder::new(fs::File::open(path).map_err(|e| e.to_string())?)
            .take(5 * 1024 * 1024)
            .read_to_string(&mut content)
            .map_err(|e| e.to_string())?;
    } else {
        fs::File::open(path).map_err(|e| e.to_string())?
            .take(5 * 1024 * 1024)
            .read_to_string(&mut content)
            .map_err(|e| e.to_string())?;
    }
    Ok(content)
}

pub fn list_log_summaries(base_dir: &str) -> Result<Vec<LogSummary>, String> {
    let cache_path = Path::new(base_dir).join("logs").join(".minedock-logs-cache.json");
    let mut cache: std::collections::HashMap<String, LogSummary> = if let Ok(content) = fs::read_to_string(&cache_path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };

    let files = list_directory(base_dir, "logs")?
        .into_iter()
        .filter(|file| !file.is_dir && (file.name.ends_with(".log") || file.name.ends_with(".log.gz")))
        .collect::<Vec<_>>();

    let mut logs = Vec::with_capacity(files.len());
    let mut cache_dirty = false;

    for file in files {
        if let Some(cached) = cache.get(&file.name) {
            if cached.modified == file.modified {
                logs.push(cached.clone());
                continue;
            }
        }

        // Cache miss: read, decompress and scan file
        let content = read_log_file(base_dir, &file.name)?;
        let mut summary = LogSummary {
            name: file.name.clone(),
            modified: file.modified,
            infos: 0,
            warnings: 0,
            errors: 0,
        };
        for line in content.lines() {
            let upper = line.to_ascii_uppercase();
            if upper.contains("ERROR") || upper.contains("SEVERE") || upper.contains("FATAL") || upper.contains("EXCEPTION") {
                summary.errors += 1;
            } else if upper.contains("WARN") {
                summary.warnings += 1;
            } else if upper.contains("INFO") {
                summary.infos += 1;
            }
        }
        cache.insert(file.name.clone(), summary.clone());
        logs.push(summary);
        cache_dirty = true;
    }

    if cache_dirty {
        if let Ok(serialized) = serde_json::to_string(&cache) {
            let _ = fs::write(cache_path, serialized);
        }
    }

    logs.sort_by(|a, b| {
        match (a.name == "latest.log", b.name == "latest.log") {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => b.modified.cmp(&a.modified).then_with(|| b.name.cmp(&a.name)),
        }
    });

    Ok(logs)
}

pub fn write_text_file(base_dir: &str, sub_path: &str, content: &str) -> Result<(), String> {
    let full_path = sanitize_path(base_dir, sub_path)?;
    fs::write(full_path, content).map_err(|e| e.to_string())
}

pub fn delete_file(base_dir: &str, sub_path: &str) -> Result<(), String> {
    let full_path = sanitize_path(base_dir, sub_path)?;
    let meta = fs::metadata(&full_path).map_err(|e| e.to_string())?;
    
    if meta.is_dir() {
        fs::remove_dir_all(full_path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(full_path).map_err(|e| e.to_string())
    }
}

const PENDING_DELETES: &str = ".minedock-pending-deletes.json";

pub fn delete_or_schedule(base_dir: &str, sub_path: &str) -> Result<bool, String> {
    let full_path = sanitize_path(base_dir, sub_path)?;
    let result = if full_path.is_dir() { fs::remove_dir_all(&full_path) } else { fs::remove_file(&full_path) };
    match result {
        Ok(()) => Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            let queue_path = Path::new(base_dir).join(PENDING_DELETES);
            let mut queue: Vec<String> = fs::read_to_string(&queue_path)
                .ok().and_then(|content| serde_json::from_str(&content).ok()).unwrap_or_default();
            if !queue.iter().any(|path| path == sub_path) {
                queue.push(sub_path.to_string());
                fs::write(queue_path, serde_json::to_string_pretty(&queue).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            }
            Ok(true)
        }
        Err(error) => Err(error.to_string()),
    }
}

pub fn apply_pending_deletes(base_dir: &str) {
    let queue_path = Path::new(base_dir).join(PENDING_DELETES);
    let queue: Vec<String> = fs::read_to_string(&queue_path)
        .ok().and_then(|content| serde_json::from_str(&content).ok()).unwrap_or_default();
    let remaining: Vec<String> = queue.into_iter().filter(|path| delete_file(base_dir, path).is_err()).collect();
    if remaining.is_empty() {
        let _ = fs::remove_file(queue_path);
    } else if let Ok(content) = serde_json::to_string_pretty(&remaining) {
        let _ = fs::write(queue_path, content);
    }
}

pub fn create_folder(base_dir: &str, sub_path: &str) -> Result<(), String> {
    if sub_path == "." && !Path::new(base_dir).exists() {
        let base = Path::new(base_dir);
        if !base.is_absolute() {
            return Err("Base directory must be absolute".to_string());
        }
        return fs::create_dir_all(base).map_err(|e| e.to_string());
    }
    let full_path = sanitize_path(base_dir, sub_path)?;
    fs::create_dir_all(full_path).map_err(|e| e.to_string())
}

pub fn import_paths(base_dir: &str, sub_path: &str, paths: &[String]) -> Result<usize, String> {
    let destination = sanitize_path(base_dir, sub_path)?;
    if !destination.is_dir() {
        return Err("Upload destination is not a directory".to_string());
    }

    let mut copied = 0;
    for source in paths.iter().map(Path::new) {
        let name = source.file_name().ok_or("Invalid source path")?;
        let target = destination.join(name);
        if source.is_dir() {
            for entry in walkdir::WalkDir::new(source) {
                let entry = entry.map_err(|e| e.to_string())?;
                let relative = entry.path().strip_prefix(source).map_err(|e| e.to_string())?;
                let output = target.join(relative);
                if entry.file_type().is_dir() {
                    fs::create_dir_all(output).map_err(|e| e.to_string())?;
                } else {
                    if let Some(parent) = output.parent() {
                        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    fs::copy(entry.path(), output).map_err(|e| e.to_string())?;
                    copied += 1;
                }
            }
        } else if source.is_file() {
            fs::copy(source, target).map_err(|e| e.to_string())?;
            copied += 1;
        } else {
            return Err(format!("Source does not exist: {}", source.display()));
        }
    }
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::{apply_pending_deletes, create_folder, import_paths, PENDING_DELETES};

    #[test]
    fn creates_missing_absolute_base_directory() {
        let path = std::env::temp_dir().join(format!("minedock-create-folder-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        create_folder(path.to_str().unwrap(), ".").unwrap();
        assert!(path.is_dir());
        std::fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn imports_dropped_file() {
        let root = std::env::temp_dir().join(format!("minedock-import-{}", std::process::id()));
        let source = std::env::temp_dir().join(format!("minedock-source-{}.txt", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&source, "test").unwrap();
        assert_eq!(import_paths(root.to_str().unwrap(), ".", &[source.to_string_lossy().to_string()]).unwrap(), 1);
        assert_eq!(std::fs::read_to_string(root.join(source.file_name().unwrap())).unwrap(), "test");
        std::fs::remove_file(source).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn applies_queued_delete_before_start() {
        let root = std::env::temp_dir().join(format!("minedock-delete-queue-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("plugins")).unwrap();
        std::fs::write(root.join("plugins").join("old.jar"), "test").unwrap();
        std::fs::write(root.join(PENDING_DELETES), r#"["plugins/old.jar"]"#).unwrap();
        apply_pending_deletes(root.to_str().unwrap());
        assert!(!root.join("plugins").join("old.jar").exists());
        assert!(!root.join(PENDING_DELETES).exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
