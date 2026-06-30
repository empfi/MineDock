use serde::Serialize;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use zip::write::{ExtendedFileOptions, FileOptions};

#[derive(Serialize)]
pub struct WorldInfo {
    pub name: String,
    pub size: u64,
    pub modified: u64,
    pub active: bool,
    pub ready: bool,
    pub kind: String,
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name
            .chars()
            .any(|c| matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'))
}

fn properties_path(root: &Path) -> PathBuf {
    root.join("server.properties")
}

fn property(root: &Path, key: &str) -> Option<String> {
    fs::read_to_string(properties_path(root))
        .ok()?
        .lines()
        .find_map(|line| line.strip_prefix(&format!("{key}=")).map(str::to_string))
}

fn set_property(root: &Path, key: &str, value: &str) -> Result<(), String> {
    let path = properties_path(root);
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let prefix = format!("{key}=");
    let mut found = false;
    let mut lines: Vec<String> = content
        .lines()
        .map(|line| {
            if line.starts_with(&prefix) {
                found = true;
                format!("{prefix}{value}")
            } else {
                line.to_string()
            }
        })
        .collect();
    if !found {
        lines.push(format!("{prefix}{value}"));
    }
    fs::write(path, format!("{}\n", lines.join("\n"))).map_err(|e| e.to_string())
}

fn dir_stats(path: &Path) -> (u64, u64) {
    WalkDir::new(path)
        .into_iter()
        .filter_map(Result::ok)
        .fold((0, 0), |(size, modified), entry| {
            let metadata = entry.metadata().ok();
            let bytes = metadata
                .as_ref()
                .filter(|meta| meta.is_file())
                .map_or(0, |meta| meta.len());
            let timestamp = metadata
                .and_then(|meta| meta.modified().ok())
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |duration| duration.as_secs());
            (size + bytes, modified.max(timestamp))
        })
}

pub fn list_worlds(server_path: &str) -> Result<Vec<WorldInfo>, String> {
    let root = Path::new(server_path);
    let active = property(root, "level-name").unwrap_or_else(|| "world".to_string());
    let mut worlds = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if !path.is_dir()
            || (!path.join("level.dat").is_file() && !path.join(".minedock-pending").is_file())
        {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let kind = if name.ends_with("_nether") {
            "nether"
        } else if name.ends_with("_the_end") {
            "end"
        } else {
            "overworld"
        };
        let (size, modified) = dir_stats(&path);
        worlds.push(WorldInfo {
            active: kind == "overworld" && name == active,
            ready: path.join("level.dat").is_file(),
            kind: kind.to_string(),
            name,
            size,
            modified,
        });
    }
    worlds.sort_by(|a, b| b.active.cmp(&a.active).then(a.name.cmp(&b.name)));
    Ok(worlds)
}

pub fn create_world(server_path: &str, name: &str, seed: &str, kind: &str) -> Result<(), String> {
    if !valid_name(name) {
        return Err("Invalid world name".to_string());
    }
    let root = Path::new(server_path);
    let folder_name = match kind {
        "overworld" => name.to_string(),
        "nether" => {
            if !root.join(name).is_dir() {
                return Err("Create the matching overworld first".to_string());
            }
            format!("{name}_nether")
        }
        "end" => {
            if !root.join(name).is_dir() {
                return Err("Create the matching overworld first".to_string());
            }
            format!("{name}_the_end")
        }
        _ => return Err("Invalid world type".to_string()),
    };
    let path = root.join(&folder_name);
    if path.exists() {
        return Err("This dimension already exists".to_string());
    }
    fs::create_dir(&path).map_err(|e| e.to_string())?;
    fs::write(path.join(".minedock-pending"), "").map_err(|e| e.to_string())?;
    if kind == "overworld" {
        set_property(root, "level-name", name)?;
        set_property(root, "level-seed", seed)?;
    }
    Ok(())
}

pub fn activate_world(server_path: &str, name: &str) -> Result<(), String> {
    if !valid_name(name) || !Path::new(server_path).join(name).is_dir() {
        return Err("World does not exist".to_string());
    }
    set_property(Path::new(server_path), "level-name", name)
}

pub fn rename_world(server_path: &str, old_name: &str, new_name: &str) -> Result<(), String> {
    if !valid_name(old_name) || !valid_name(new_name) {
        return Err("Invalid world name".to_string());
    }
    let root = Path::new(server_path);
    if root.join(new_name).exists() {
        return Err("A world with this name already exists".to_string());
    }
    for suffix in ["", "_nether", "_the_end"] {
        let from = root.join(format!("{old_name}{suffix}"));
        if from.exists() {
            fs::rename(from, root.join(format!("{new_name}{suffix}")))
                .map_err(|e| e.to_string())?;
        }
    }
    if property(root, "level-name").as_deref() == Some(old_name) {
        set_property(root, "level-name", new_name)?;
    }
    Ok(())
}

pub fn delete_world(server_path: &str, name: &str) -> Result<(), String> {
    if !valid_name(name) {
        return Err("Invalid world name".to_string());
    }
    let root = Path::new(server_path);
    if property(root, "level-name").as_deref().unwrap_or("world") == name {
        return Err("Primary world cannot be deleted".to_string());
    }
    for suffix in ["", "_nether", "_the_end"] {
        let path = root.join(format!("{name}{suffix}"));
        if path.exists() {
            fs::remove_dir_all(path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Export a world (and its nether/end dimensions) to a ZIP file.
/// Returns the absolute path of the created ZIP.
pub fn export_world(server_path: &str, name: &str) -> Result<String, String> {
    if !valid_name(name) {
        return Err("Invalid world name".to_string());
    }
    let root = Path::new(server_path);
    let export_dir = root.join(".minedock").join("world-exports");
    fs::create_dir_all(&export_dir).map_err(|e| e.to_string())?;

    let zip_path = export_dir.join(format!("{name}.zip"));
    let file = File::create(&zip_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options: FileOptions<'_, ExtendedFileOptions> = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o755);

    for suffix in ["", "_nether", "_the_end"] {
        let folder_name = format!("{name}{suffix}");
        let world_path = root.join(&folder_name);
        if !world_path.exists() {
            continue;
        }
        for entry in WalkDir::new(&world_path) {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let relative = path.strip_prefix(root).unwrap();
            if path.is_file() {
                zip.start_file(relative.to_string_lossy(), options.clone())
                    .map_err(|e| e.to_string())?;
                let mut f = File::open(path).map_err(|e| e.to_string())?;
                io::copy(&mut f, &mut zip).map_err(|e| e.to_string())?;
            } else if !relative.as_os_str().is_empty() {
                zip.add_directory(relative.to_string_lossy(), options.clone())
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(zip_path.to_string_lossy().to_string())
}

/// Import a world from a ZIP file into the server directory.
/// Returns the name of the world that was imported.
pub fn import_world(server_path: &str, zip_path: &str) -> Result<String, String> {
    let root = Path::new(server_path);
    let zip_file = File::open(zip_path).map_err(|e| format!("Cannot open ZIP: {e}"))?;
    let mut archive = zip::ZipArchive::new(zip_file).map_err(|e| e.to_string())?;

    // Determine the top-level overworld folder name from the ZIP entries
    let mut world_name: Option<String> = None;
    for i in 0..archive.len() {
        if let Ok(f) = archive.by_index(i) {
            let entry_name = f.name().to_string();
            let top = entry_name.splitn(2, '/').next().unwrap_or("").to_string();
            if !top.is_empty() && !top.ends_with("_nether") && !top.ends_with("_the_end") {
                world_name = Some(top);
                break;
            }
        }
    }
    let world_name = world_name.ok_or("Could not determine world name from ZIP")?;

    if !valid_name(&world_name) {
        return Err("Invalid world name in ZIP".to_string());
    }
    if root.join(&world_name).exists() {
        return Err(format!("A world named '{}' already exists", world_name));
    }

    // Re-open archive for extraction
    let zip_file2 = File::open(zip_path).map_err(|e| format!("Cannot open ZIP: {e}"))?;
    let mut archive2 = zip::ZipArchive::new(zip_file2).map_err(|e| e.to_string())?;

    for i in 0..archive2.len() {
        let mut file = archive2.by_index(i).map_err(|e| e.to_string())?;
        let outpath = match file.enclosed_name() {
            Some(p) => root.join(p),
            None => continue,
        };
        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out = File::create(&outpath).map_err(|e| e.to_string())?;
            io::copy(&mut file, &mut out).map_err(|e| e.to_string())?;
        }
    }

    Ok(world_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_server(id: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("minedock-worlds-{}-{}", std::process::id(), id));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("server.properties"), "level-name=world\n").unwrap();
        root
    }

    #[test]
    fn creates_and_lists_pending_world() {
        let root = setup_server("basic");
        create_world(root.to_str().unwrap(), "new_world", "123", "overworld").unwrap();
        let worlds = list_worlds(root.to_str().unwrap()).unwrap();
        assert_eq!(worlds[0].name, "new_world");
        assert!(worlds[0].active);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn creates_nether_dimension() {
        let root = setup_server("nether");
        // Create overworld first
        create_world(root.to_str().unwrap(), "myworld", "", "overworld").unwrap();
        // Create matching nether
        create_world(root.to_str().unwrap(), "myworld", "", "nether").unwrap();
        let worlds = list_worlds(root.to_str().unwrap()).unwrap();
        let nether = worlds.iter().find(|w| w.kind == "nether");
        assert!(nether.is_some(), "Nether dimension should be listed");
        assert_eq!(nether.unwrap().name, "myworld_nether");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn creates_end_dimension() {
        let root = setup_server("end");
        create_world(root.to_str().unwrap(), "myworld", "", "overworld").unwrap();
        create_world(root.to_str().unwrap(), "myworld", "", "end").unwrap();
        let worlds = list_worlds(root.to_str().unwrap()).unwrap();
        let end = worlds.iter().find(|w| w.kind == "end");
        assert!(end.is_some(), "End dimension should be listed");
        assert_eq!(end.unwrap().name, "myworld_the_end");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn switches_active_world() {
        let root = setup_server("switch");
        create_world(root.to_str().unwrap(), "world_a", "", "overworld").unwrap();
        create_world(root.to_str().unwrap(), "world_b", "", "overworld").unwrap();
        // world_a is active after creation (set by create_world)
        // Now activate world_b
        activate_world(root.to_str().unwrap(), "world_b").unwrap();
        let worlds = list_worlds(root.to_str().unwrap()).unwrap();
        let active = worlds.iter().find(|w| w.active);
        assert!(active.is_some(), "There should be an active world");
        assert_eq!(active.unwrap().name, "world_b");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cannot_delete_primary_world() {
        let root = setup_server("del-primary");
        create_world(root.to_str().unwrap(), "primary", "", "overworld").unwrap();
        let result = delete_world(root.to_str().unwrap(), "primary");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Primary world"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn export_and_import_roundtrip() {
        let root = setup_server("export");
        create_world(root.to_str().unwrap(), "myworld", "42", "overworld").unwrap();
        // Put a fake level.dat so it looks ready
        fs::write(root.join("myworld").join("level.dat"), b"fake").unwrap();

        let zip_path = export_world(root.to_str().unwrap(), "myworld").unwrap();
        assert!(Path::new(&zip_path).exists());

        // Import into a different server directory
        let dest = setup_server("import");
        let imported_name = import_world(dest.to_str().unwrap(), &zip_path).unwrap();
        assert_eq!(imported_name, "myworld");
        assert!(dest.join("myworld").is_dir());

        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(dest).unwrap();
    }
}
