use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Debug)]
pub struct FileInfo {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64, // unix timestamp
}

// Ensures the requested path doesn't escape the base server directory
fn sanitize_path(base_dir: &str, requested_path: &str) -> Result<PathBuf, String> {
    let base = Path::new(base_dir).canonicalize().map_err(|_| "Invalid base directory")?;
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

pub fn create_folder(base_dir: &str, sub_path: &str) -> Result<(), String> {
    let full_path = sanitize_path(base_dir, sub_path)?;
    fs::create_dir_all(full_path).map_err(|e| e.to_string())
}
