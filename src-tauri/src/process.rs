use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::process::{ChildStdin, Command};
use tokio::io::{AsyncBufReadExt, BufReader, AsyncWriteExt};
use tauri::{AppHandle, Manager, Emitter};
use crate::database::{DbState, update_server_status, update_server_last_started, get_server};

#[derive(Clone, serde::Serialize)]
struct ConsoleLine {
    server_id: i64,
    line: String,
    is_error: bool,
}

pub struct ProcessManager {
    // Store only the stdin handle in the map, so the background watcher can own the Child itself
    processes: Arc<Mutex<HashMap<i64, ChildStdin>>>,
    app: AppHandle,
}

impl ProcessManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            app,
        }
    }

    pub async fn start_server(&self, server_id: i64) -> Result<(), String> {
        // 1. Get server details
        let server = {
            let state = self.app.state::<DbState>();
            let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
            get_server(&conn, server_id)
                .map_err(|e| e.to_string())?
                .ok_or("Server not found")?
        };

        // 2. Check if already running
        let mut processes = self.processes.lock().await;
        if processes.contains_key(&server_id) {
            return Err("Server is already running".to_string());
        }

        // 3. Update status to starting
        {
            let state = self.app.state::<DbState>();
            let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
            update_server_status(&conn, server_id, "starting").map_err(|e| e.to_string())?;
            let now = chrono::Local::now().to_rfc3339();
            update_server_last_started(&conn, server_id, &now).map_err(|e| e.to_string())?;
        }
        self.app.emit("server-status-changed", (server_id, "starting")).unwrap_or_default();


        // 4. Spawn process
        let mut child = Command::new(&server.java_path)
            .current_dir(&server.install_path)
            .arg(format!("-Xms{}M", server.ram_min))
            .arg(format!("-Xmx{}M", server.ram_max))
            .arg("-jar")
            .arg(&server.jar_path)
            .arg("nogui")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start process: {}", e))?;

        let stdout = child.stdout.take().expect("Failed to capture stdout");
        let stderr = child.stderr.take().expect("Failed to capture stderr");
        let stdin = child.stdin.take().expect("Failed to capture stdin");

        processes.insert(server_id, stdin);
        drop(processes); // Drop lock before entering wait state

        // Update status to online (we could be smarter about this by parsing logs)
        {
            let state = self.app.state::<DbState>();
            let conn = state.db.lock();
            if let Ok(conn) = conn {
                let _ = update_server_status(&conn, server_id, "online");
            }
        }
        self.app.emit("server-status-changed", (server_id, "online")).unwrap_or_default();


        // 5. Stream logs
        let app_clone1 = self.app.clone();
        let app_clone2 = self.app.clone();
        
        let stdout_reader = BufReader::new(stdout);
        let mut stdout_lines = stdout_reader.lines();
        tokio::spawn(async move {
            while let Ok(Some(line)) = stdout_lines.next_line().await {
                app_clone1.emit("console-log", ConsoleLine {
                    server_id,
                    line,
                    is_error: false,
                }).unwrap_or_default();
            }
        });

        let stderr_reader = BufReader::new(stderr);
        let mut stderr_lines = stderr_reader.lines();
        tokio::spawn(async move {
            while let Ok(Some(line)) = stderr_lines.next_line().await {
                app_clone2.emit("console-log", ConsoleLine {
                    server_id,
                    line,
                    is_error: true,
                }).unwrap_or_default();
            }
        });

        // 6. Monitor process exit
        let processes_clone = self.processes.clone();
        let app_clone = self.app.clone();
        tokio::spawn(async move {
            // We own the child process here, no map lock held while waiting.
            if let Ok(status) = child.wait().await {
                let new_status = if status.success() { "offline" } else { "crashed" };
                let state = app_clone.state::<DbState>();
                let conn = state.db.lock();
                if let Ok(conn) = conn {
                    let _ = update_server_status(&conn, server_id, new_status);
                }
                app_clone.emit("server-status-changed", (server_id, new_status)).unwrap_or_default();
            }
            
            // Only acquire lock momentarily to remove the stdin handle
            let mut processes_lock = processes_clone.lock().await;
            processes_lock.remove(&server_id);
        });

        Ok(())
    }

    pub async fn stop_server(&self, server_id: i64) -> Result<(), String> {
        let stop_command = {
            let state = self.app.state::<DbState>();
            let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
            let server = get_server(&conn, server_id).map_err(|e| e.to_string())?.ok_or("Server not found")?;
            if server.server_type == "velocity" { b"end\n".as_slice() } else { b"stop\n".as_slice() }
        };
        let mut processes = self.processes.lock().await;
        if let Some(stdin) = processes.get_mut(&server_id) {
            
            {
                let state = self.app.state::<DbState>();
                let conn = state.db.lock();
                if let Ok(conn) = conn {
                    let _ = update_server_status(&conn, server_id, "stopping");
                }
            }
            self.app.emit("server-status-changed", (server_id, "stopping")).unwrap_or_default();

            let _ = stdin.write_all(stop_command).await;
            let _ = stdin.flush().await;
            
        } else {
            return Err("Server not running".to_string());
        }
        Ok(())
    }

    pub async fn send_command(&self, server_id: i64, command: String) -> Result<(), String> {
        let mut processes = self.processes.lock().await;
        if let Some(stdin) = processes.get_mut(&server_id) {
            let cmd = format!("{}\n", command);
            stdin.write_all(cmd.as_bytes()).await.map_err(|e| e.to_string())?;
            stdin.flush().await.map_err(|e| e.to_string())?;
        } else {
            return Err("Server not running".to_string());
        }
        Ok(())
    }
}
