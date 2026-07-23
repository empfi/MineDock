use crate::database::{
    get_server, get_settings, update_server_last_started, update_server_status, DbState,
};
use crate::files::apply_pending_deletes;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::Mutex;

#[derive(Clone, serde::Serialize)]
struct ConsoleLine {
    server_id: i64,
    line: String,
    is_error: bool,
}

pub struct ActiveProcessInfo {
    pub stdin: ChildStdin,
    pub pid: u32,
}

pub struct ProcessManager {
    // Store both stdin and process PID
    processes: Arc<Mutex<HashMap<i64, ActiveProcessInfo>>>,
    crash_history: Arc<Mutex<HashMap<i64, VecDeque<std::time::Instant>>>>,
    app: AppHandle,
}

fn required_java_version(minecraft: &str) -> u32 {
    let mut parts = minecraft.split('.').map(|part| {
        part.chars()
            .take_while(|character| character.is_ascii_digit())
            .collect::<String>()
            .parse::<u32>()
            .ok()
    });
    let Some(major) = parts.next().flatten() else {
        return 21;
    };
    if major != 1 {
        return 21;
    }
    let minor = parts.next().flatten().unwrap_or(0);
    let patch = parts.next().flatten().unwrap_or(0);
    if (major, minor, patch) >= (1, 20, 5) {
        21
    } else if (major, minor, patch) >= (1, 18, 0) {
        17
    } else if (major, minor, patch) >= (1, 17, 0) {
        16
    } else {
        8
    }
}

pub(crate) fn java_major(java_path: &str) -> Result<u32, String> {
    let output = std::process::Command::new(java_path)
        .arg("-version")
        .output()
        .map_err(|e| format!("Could not run Java: {e}"))?;
    let text = String::from_utf8_lossy(&output.stderr);
    let version = text
        .split('"')
        .nth(1)
        .ok_or("Could not detect Java version")?;
    let first = version
        .split('.')
        .next()
        .and_then(|value| value.parse::<u32>().ok())
        .ok_or("Invalid Java version")?;
    if first == 1 {
        version
            .split('.')
            .nth(1)
            .and_then(|value| value.parse().ok())
            .ok_or("Invalid Java version".to_string())
    } else {
        Ok(first)
    }
}

pub fn is_docker_available() -> bool {
    std::process::Command::new("docker")
        .arg("info")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

pub fn get_container_running_state(server_id: i64) -> (bool, bool) {
    let container_name = format!("minedock-server-{}", server_id);
    let output = std::process::Command::new("docker")
        .args(&["inspect", "-f", "{{.State.Running}}", &container_name])
        .output();
    match output {
        Ok(out) => {
            if out.status.success() {
                let running_str = String::from_utf8_lossy(&out.stdout).trim().to_string();
                (true, running_str == "true")
            } else {
                (false, false)
            }
        }
        Err(_) => (false, false),
    }
}

fn is_server_ready(line: &str) -> bool {
    line.to_ascii_lowercase().contains("done (")
}

#[cfg(test)]
mod readiness_tests {
    use super::is_server_ready;

    #[test]
    fn detects_minecraft_ready_line_only() {
        assert!(is_server_ready(
            "[Server thread/INFO]: Done (12.34s)! For help, type \"help\""
        ));
        assert!(!is_server_ready(
            "[ReobfServer] Done remapping server in 3366ms."
        ));
    }
}

impl ProcessManager {
    pub fn new(app: AppHandle) -> Self {
        let processes: Arc<Mutex<HashMap<i64, ActiveProcessInfo>>> =
            Arc::new(Mutex::new(HashMap::new()));

        // Spawn stats monitoring task using Tauri's managed runtime (safe to call before full tokio init)
        let processes_clone = processes.clone();
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            use sysinfo::{Pid, System};
            let mut sys = System::new_all();

            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

                let active_targets: Vec<(i64, u32)> = {
                    let lock = processes_clone.lock().await;
                    lock.iter().map(|(&sid, info)| (sid, info.pid)).collect()
                };

                if active_targets.is_empty() {
                    continue;
                }

                sys.refresh_all();

                for (server_id, pid) in active_targets {
                    let run_in_container = {
                        if let Some(state) = app_clone.try_state::<DbState>() {
                            if let Ok(conn) = state.db.lock() {
                                crate::database::get_server(&conn, server_id)
                                    .ok()
                                    .flatten()
                                    .map(|s| s.run_in_container)
                                    .unwrap_or(false)
                            } else {
                                false
                            }
                        } else {
                            false
                        }
                    };

                    if run_in_container {
                        let container_name = format!("minedock-server-{}", server_id);
                        if let Ok(output) = std::process::Command::new("docker")
                            .args(&["stats", "--no-stream", "--format", "{{.CPUPerc}} {{.MemUsage}}", &container_name])
                            .output()
                        {
                            let text = String::from_utf8_lossy(&output.stdout);
                            let parts: Vec<&str> = text.split_whitespace().collect();
                            if parts.len() >= 2 {
                                let cpu_str = parts[0].replace('%', "");
                                let cpu: f32 = cpu_str.parse().unwrap_or(0.0);

                                let mem_str = parts[1];
                                let mut mem_val: f64 = 0.0;
                                if mem_str.to_lowercase().contains("gib") {
                                    let clean = mem_str.to_lowercase().replace("gib", "");
                                    if let Ok(val) = clean.parse::<f64>() {
                                        mem_val = val * 1024.0;
                                    }
                                } else if mem_str.to_lowercase().contains("mib") {
                                    let clean = mem_str.to_lowercase().replace("mib", "");
                                    if let Ok(val) = clean.parse::<f64>() {
                                        mem_val = val;
                                    }
                                } else if mem_str.to_lowercase().contains("kib") {
                                    let clean = mem_str.to_lowercase().replace("kib", "");
                                    if let Ok(val) = clean.parse::<f64>() {
                                        mem_val = val / 1024.0;
                                    }
                                }
                                let _ = app_clone.emit("server-stats", (server_id, cpu, mem_val as u64));
                            }
                        }
                    } else {
                        if let Some(process) = sys.process(Pid::from(pid as usize)) {
                            let cpu = process.cpu_usage();
                            let memory = process.memory() / 1024 / 1024; // MB
                            let _ = app_clone.emit("server-stats", (server_id, cpu, memory));
                        }
                    }
                }
            }
        });

        Self {
            processes,
            crash_history: Arc::new(Mutex::new(HashMap::new())),
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
        let run_in_container = server.run_in_container;
        if run_in_container {
            if !is_docker_available() {
                return Err("Docker is not running or not installed on this machine".to_string());
            }
        } else {
            let required = required_java_version(&server.minecraft_version);
            let installed = java_major(&server.java_path)?;
            if installed < required {
                return Err(format!(
                    "Minecraft {} requires Java {} or newer, but {} uses Java {}",
                    server.minecraft_version, required, server.java_path, installed
                ));
            }
        }

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
        self.app
            .emit("server-status-changed", (server_id, "starting"))
            .unwrap_or_default();

        // Verify folder and jar file exist
        let install_path = std::path::Path::new(&server.install_path);
        if !install_path.exists() {
            // Update status back to offline if folder check fails
            if let Some(state) = self.app.try_state::<DbState>() {
                if let Ok(conn) = state.db.lock() {
                    let _ = update_server_status(&conn, server_id, "offline");
                }
            }
            self.app
                .emit("server-status-changed", (server_id, "offline"))
                .unwrap_or_default();
            return Err("Server installation directory does not exist! Please restore the directory or delete the server profile.".to_string());
        }
        apply_pending_deletes(&server.install_path);
        let jar_path = install_path.join(&server.jar_path);
        if !jar_path.exists() {
            if let Some(state) = self.app.try_state::<DbState>() {
                if let Ok(conn) = state.db.lock() {
                    let _ = update_server_status(&conn, server_id, "offline");
                }
            }
            self.app
                .emit("server-status-changed", (server_id, "offline"))
                .unwrap_or_default();
            return Err(format!(
                "Server jar file ({}) does not exist in the installation directory!",
                server.jar_path
            ));
        }

        // 4. Spawn process
        let mut command = if run_in_container {
            let mut cmd = Command::new("docker");
            let container_name = format!("minedock-server-{}", server_id);
            let (exists, running) = get_container_running_state(server_id);
            if running {
                cmd.args(&["attach", "--sig-proxy=false", &container_name]);
            } else if exists {
                cmd.args(&["start", "-i", "-a", &container_name]);
            } else {
                let java_version = required_java_version(&server.minecraft_version);
                let docker_image = format!("eclipse-temurin:{}", java_version);
                cmd.args(&[
                    "run",
                    "-i",
                    "--name",
                    &container_name,
                    "--restart",
                    "unless-stopped",
                    "-v",
                    &format!("{}:/data", server.install_path),
                    "-p",
                    &format!("{}:{}", server.port, server.port),
                    "-w",
                    "/data",
                    &docker_image,
                    "java",
                    "-Dterminal.jline=false",
                    "-Dlog4j.skipJansi=true",
                    "-Dfile.encoding=UTF-8",
                    &format!("-Xms{}M", server.ram_min),
                    &format!("-Xmx{}M", server.ram_max),
                ]);
                if server.jar_path.starts_with('@') {
                    cmd.arg(&server.jar_path);
                } else {
                    cmd.args(&["-jar", &server.jar_path]);
                }
                cmd.arg("nogui");
            }
            cmd
        } else {
            let mut cmd = Command::new(&server.java_path);
            cmd.current_dir(&server.install_path)
                .arg("-Dterminal.jline=false")
                .arg("-Dlog4j.skipJansi=true")
                .arg("-Dfile.encoding=UTF-8")
                .arg(format!("-Xms{}M", server.ram_min))
                .arg(format!("-Xmx{}M", server.ram_max));
            if server.jar_path.starts_with('@') {
                cmd.arg(&server.jar_path);
            } else {
                cmd.arg("-jar").arg(&server.jar_path);
            }
            cmd.arg("nogui");
            cmd
        };
        let mut child = command
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start process: {}", e))?;

        let stdout = child.stdout.take().expect("Failed to capture stdout");
        let stderr = child.stderr.take().expect("Failed to capture stderr");
        let stdin = child.stdin.take().expect("Failed to capture stdin");

        let pid = child.id().unwrap_or(0);
        processes.insert(server_id, ActiveProcessInfo { stdin, pid });
        drop(processes); // Drop lock before entering wait state

        // 5. Stream logs
        let app_clone1 = self.app.clone();
        let app_clone2 = self.app.clone();

        let stdout_reader = BufReader::new(stdout);
        let mut stdout_lines = stdout_reader.lines();
        tokio::spawn(async move {
            let mut ready = false;
            while let Ok(Some(line)) = stdout_lines.next_line().await {
                if !ready && is_server_ready(&line) {
                    ready = true;
                    if let Some(state) = app_clone1.try_state::<DbState>() {
                        if let Ok(conn) = state.db.lock() {
                            let _ = update_server_status(&conn, server_id, "online");
                        }
                    }
                    app_clone1
                        .emit("server-status-changed", (server_id, "online"))
                        .unwrap_or_default();
                }
                app_clone1
                    .emit(
                        "console-log",
                        ConsoleLine {
                            server_id,
                            line,
                            is_error: false,
                        },
                    )
                    .unwrap_or_default();
            }
        });

        let stderr_reader = BufReader::new(stderr);
        let mut stderr_lines = stderr_reader.lines();
        tokio::spawn(async move {
            while let Ok(Some(line)) = stderr_lines.next_line().await {
                app_clone2
                    .emit(
                        "console-log",
                        ConsoleLine {
                            server_id,
                            line,
                            is_error: true,
                        },
                    )
                    .unwrap_or_default();
            }
        });

        // 6. Monitor process exit
        let processes_clone = self.processes.clone();
        let crash_history = self.crash_history.clone();
        let app_clone = self.app.clone();
        tokio::spawn(async move {
            // We own the child process here, no map lock held while waiting.
            if let Ok(status) = child.wait().await {
                let mut restart = {
                    let state = app_clone.state::<DbState>();
                    let conn = state.db.lock();
                    let mut restart = false;
                    if let Ok(conn) = conn {
                        let intentional = get_server(&conn, server_id)
                            .ok()
                            .flatten()
                            .is_some_and(|server| server.status == "stopping");
                        restart = !status.success()
                            && !intentional
                            && get_settings(&conn).is_ok_and(|settings| settings.auto_restart);
                        let new_status = if restart {
                            "restarting"
                        } else if status.success() || intentional {
                            "offline"
                        } else {
                            "crashed"
                        };
                        let _ = update_server_status(&conn, server_id, new_status);
                        app_clone
                            .emit("server-status-changed", (server_id, new_status))
                            .unwrap_or_default();
                    }
                    restart
                };
                if restart {
                    let mut history = crash_history.lock().await;
                    let crashes = history.entry(server_id).or_default();
                    let cutoff = std::time::Instant::now() - std::time::Duration::from_secs(60);
                    while crashes.front().is_some_and(|time| *time < cutoff) {
                        crashes.pop_front();
                    }
                    crashes.push_back(std::time::Instant::now());
                    if crashes.len() > 3 {
                        restart = false;
                        if let Some(state) = app_clone.try_state::<DbState>() {
                            if let Ok(conn) = state.db.lock() {
                                let _ = update_server_status(&conn, server_id, "crash-loop");
                            }
                        }
                        app_clone
                            .emit("server-status-changed", (server_id, "crash-loop"))
                            .unwrap_or_default();
                        app_clone.emit("console-log", ConsoleLine {
                            server_id,
                            line: "Auto-restart stopped: server crashed more than 3 times in 60 seconds.".into(),
                            is_error: true,
                        }).unwrap_or_default();
                    }
                }

                processes_clone.lock().await.remove(&server_id);
                if restart {
                    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                    app_clone
                        .emit("server-auto-restart", server_id)
                        .unwrap_or_default();
                }
            } else {
                processes_clone.lock().await.remove(&server_id);
            }
        });

        Ok(())
    }

    pub async fn stop_server(&self, server_id: i64) -> Result<(), String> {
        let server = {
            let state = self.app.state::<DbState>();
            let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
            get_server(&conn, server_id)
                .map_err(|e| e.to_string())?
                .ok_or("Server not found")?
        };

        {
            let state = self.app.state::<DbState>();
            let conn = state.db.lock();
            if let Ok(conn) = conn {
                let _ = update_server_status(&conn, server_id, "stopping");
            }
        }
        self.app
            .emit("server-status-changed", (server_id, "stopping"))
            .unwrap_or_default();

        let stop_command = if server.server_type == "velocity" {
            b"end\n".as_slice()
        } else {
            b"stop\n".as_slice()
        };

        let mut processes = self.processes.lock().await;
        if let Some(info) = processes.get_mut(&server_id) {
            let _ = info.stdin.write_all(stop_command).await;
            let _ = info.stdin.flush().await;
        } else if server.run_in_container {
            let _ = std::process::Command::new("docker")
                .args(&["stop", &format!("minedock-server-{}", server_id)])
                .spawn();
        } else {
            return Err("Server not running".to_string());
        }
        Ok(())
    }

    pub async fn kill_server(&self, server_id: i64) -> Result<(), String> {
        let server = {
            let state = self.app.state::<DbState>();
            let conn = state.db.lock().map_err(|_| "Failed to lock database")?;
            get_server(&conn, server_id)
                .map_err(|e| e.to_string())?
                .ok_or("Server not found")?
        };

        {
            let state = self.app.state::<DbState>();
            let conn = state.db.lock();
            if let Ok(conn) = conn {
                let _ = update_server_status(&conn, server_id, "stopping");
            }
        }
        self.app
            .emit("server-status-changed", (server_id, "stopping"))
            .unwrap_or_default();

        let mut processes = self.processes.lock().await;
        if let Some(info) = processes.remove(&server_id) {
            if server.run_in_container {
                let _ = std::process::Command::new("docker")
                    .args(&["kill", &format!("minedock-server-{}", server_id)])
                    .spawn();
            } else {
                let pid = info.pid;
                #[cfg(target_os = "windows")]
                {
                    let _ = std::process::Command::new("taskkill")
                        .args(&["/F", "/PID", &pid.to_string()])
                        .spawn();
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = std::process::Command::new("kill")
                        .args(&["-9", &pid.to_string()])
                        .spawn();
                }
            }
        } else if server.run_in_container {
            let _ = std::process::Command::new("docker")
                .args(&["kill", &format!("minedock-server-{}", server_id)])
                .spawn();
        } else {
            return Err("Server not running".to_string());
        }
        Ok(())
    }

    pub async fn send_command(&self, server_id: i64, command: String) -> Result<(), String> {
        let mut processes = self.processes.lock().await;
        if let Some(info) = processes.get_mut(&server_id) {
            let cmd = format!("{}\n", command);
            info.stdin
                .write_all(cmd.as_bytes())
                .await
                .map_err(|e| e.to_string())?;
            info.stdin.flush().await.map_err(|e| e.to_string())?;
        } else {
            return Err("Server not running".to_string());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::required_java_version;

    #[test]
    fn maps_minecraft_to_required_java() {
        assert_eq!(required_java_version("1.16.5"), 8);
        assert_eq!(required_java_version("1.17.1"), 16);
        assert_eq!(required_java_version("1.20.4"), 17);
        assert_eq!(required_java_version("1.20.5"), 21);
        assert_eq!(required_java_version("1.20.5-rc1"), 21);
        assert_eq!(required_java_version("1.21.11"), 21);
        assert_eq!(required_java_version("latest"), 21);
        assert_eq!(required_java_version("3.4.0"), 21);
    }
}
