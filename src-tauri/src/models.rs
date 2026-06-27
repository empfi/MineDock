use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Server {
    pub id: Option<i64>,
    pub name: String,
    pub minecraft_version: String,
    pub server_type: String,
    pub install_path: String,
    pub jar_path: String,
    pub status: String, // "offline", "starting", "online", "stopping", "crashed"
    pub ram_min: i32,
    pub ram_max: i32,
    pub java_path: String,
    pub created_at: String,
    pub last_started_at: Option<String>,
    pub port: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub default_server_dir: String,
    pub default_ram_min: i32,
    pub default_ram_max: i32,
    pub default_java_path: String,
    pub theme: String, // "dark"
    pub confirm_delete: bool,
    pub confirm_stop: bool,
    pub auto_scroll_console: bool,
    pub check_updates_startup: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            default_server_dir: "".to_string(), // we'll populate this later
            default_ram_min: 1024,
            default_ram_max: 4096,
            default_java_path: "java".to_string(), // we will try to detect java later
            theme: "dark".to_string(),
            confirm_delete: true,
            confirm_stop: true,
            auto_scroll_console: true,
            check_updates_startup: true,
        }
    }
}
