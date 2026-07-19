use crate::models::{AppSettings, ScheduleTask, Server, ServerSchedule};
use crate::paths;
use rusqlite::{params, Connection, Result};
use std::sync::Mutex;
use tauri::AppHandle;

pub struct DbState {
    pub db: Mutex<Connection>,
}

pub fn init_db(app: &AppHandle) -> Result<Connection> {
    let legacy_dir = paths::legacy_app_data_dir(app).ok();
    let app_dir = paths::app_data_dir(app).unwrap_or_else(|_| ".Minedock".into());
    std::fs::create_dir_all(&app_dir).unwrap_or_default();

    let db_path = app_dir.join("minedock.db");
    let conn = Connection::open(&db_path)?;

    // Create servers table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS servers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            minecraft_version TEXT NOT NULL,
            server_type TEXT NOT NULL,
            install_path TEXT NOT NULL,
            jar_path TEXT NOT NULL,
            status TEXT NOT NULL,
            ram_min INTEGER NOT NULL,
            ram_max INTEGER NOT NULL,
            java_path TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_started_at TEXT,
            port INTEGER NOT NULL
        )",
        [],
    )?;
    let _ = conn.execute(
        "ALTER TABLE servers ADD COLUMN share_enabled BOOLEAN NOT NULL DEFAULT 1",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE servers ADD COLUMN run_in_container BOOLEAN NOT NULL DEFAULT 0",
        [],
    );

    // Create schedules table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            server_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            cron_expression TEXT NOT NULL,
            action TEXT NOT NULL,
            action_payload TEXT,
            is_active BOOLEAN NOT NULL DEFAULT 1,
            require_online BOOLEAN NOT NULL DEFAULT 0,
            FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
        )",
        [],
    )?;

    let _ = conn.execute(
        "ALTER TABLE schedules ADD COLUMN require_online BOOLEAN NOT NULL DEFAULT 0",
        [],
    );

    // Create schedule tasks table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schedule_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            schedule_id INTEGER NOT NULL,
            sequence_order INTEGER NOT NULL,
            action TEXT NOT NULL,
            payload TEXT,
            time_offset_secs INTEGER NOT NULL DEFAULT 0,
            continue_on_failure BOOLEAN NOT NULL DEFAULT 1,
            FOREIGN KEY(schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Perform data migration from old schedules with action columns to schedule_tasks
    let tasks_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM schedule_tasks", [], |row| row.get(0))
        .unwrap_or(0);
    if tasks_count == 0 {
        let _ = conn.execute(
            "INSERT INTO schedule_tasks (schedule_id, sequence_order, action, payload, time_offset_secs, continue_on_failure)
             SELECT id, 1, action, action_payload, 0, 1 FROM schedules WHERE action IS NOT NULL AND action != ''",
            [],
        );
    }

    // Create settings table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            default_server_dir TEXT NOT NULL,
            default_ram_min INTEGER NOT NULL,
            default_ram_max INTEGER NOT NULL,
            default_java_path TEXT NOT NULL,
            theme TEXT NOT NULL,
            confirm_delete BOOLEAN NOT NULL CHECK (confirm_delete IN (0, 1)),
            confirm_stop BOOLEAN NOT NULL CHECK (confirm_stop IN (0, 1)),
            auto_scroll_console BOOLEAN NOT NULL CHECK (auto_scroll_console IN (0, 1)),
            check_updates_startup BOOLEAN NOT NULL CHECK (check_updates_startup IN (0, 1)),
            auto_restart BOOLEAN NOT NULL DEFAULT 0,
            tunnel_enabled BOOLEAN NOT NULL DEFAULT 0,
            tunnel_relay TEXT NOT NULL DEFAULT '',
            tunnel_token TEXT NOT NULL DEFAULT ''
        )",
        [],
    )?;
    for migration in [
        "ALTER TABLE settings ADD COLUMN auto_restart BOOLEAN NOT NULL DEFAULT 0",
        "ALTER TABLE settings ADD COLUMN tunnel_enabled BOOLEAN NOT NULL DEFAULT 0",
        "ALTER TABLE settings ADD COLUMN tunnel_relay TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE settings ADD COLUMN tunnel_token TEXT NOT NULL DEFAULT ''",
    ] {
        let _ = conn.execute(migration, []);
    }
    if let Some(legacy_dir) = legacy_dir {
        let legacy = legacy_dir.to_string_lossy();
        let current = app_dir.to_string_lossy();
        let _ = conn.execute(
            "UPDATE settings SET default_java_path = REPLACE(default_java_path, ?1, ?2)",
            params![legacy.as_ref(), current.as_ref()],
        );
        let _ = conn.execute(
            "UPDATE servers SET java_path = REPLACE(java_path, ?1, ?2)",
            params![legacy.as_ref(), current.as_ref()],
        );
    }

    // Insert default settings if they don't exist
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0))?;
    if count == 0 {
        let default_settings = AppSettings::default();
        conn.execute(
            "INSERT INTO settings (
                id, default_server_dir, default_ram_min, default_ram_max, default_java_path, theme, confirm_delete, confirm_stop, auto_scroll_console, check_updates_startup
            ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                default_settings.default_server_dir,
                default_settings.default_ram_min,
                default_settings.default_ram_max,
                default_settings.default_java_path,
                default_settings.theme,
                default_settings.confirm_delete,
                default_settings.confirm_stop,
                default_settings.auto_scroll_console,
                default_settings.check_updates_startup
            ],
        )?;
    }

    // Reset any active statuses to offline
    conn.execute(
        "UPDATE servers SET status = 'offline' WHERE status IN ('starting', 'online', 'stopping', 'restarting')",
        [],
    )?;

    Ok(conn)
}

pub fn get_servers(conn: &Connection) -> Result<Vec<Server>> {
    let mut stmt = conn.prepare("SELECT id, name, minecraft_version, server_type, install_path, jar_path, status, ram_min, ram_max, java_path, created_at, last_started_at, port, share_enabled, run_in_container FROM servers")?;
    let server_iter = stmt.query_map([], |row| {
        let install_path: String = row.get(4)?;
        let path = std::path::Path::new(&install_path);
        let install_path_exists = Some(path.exists());
        let backups_path_exists = Some(path.join(".minedock").join("backups").exists());
        Ok(Server {
            id: Some(row.get(0)?),
            name: row.get(1)?,
            minecraft_version: row.get(2)?,
            server_type: row.get(3)?,
            install_path,
            jar_path: row.get(5)?,
            status: row.get(6)?,
            ram_min: row.get(7)?,
            ram_max: row.get(8)?,
            java_path: row.get(9)?,
            created_at: row.get(10)?,
            last_started_at: row.get(11)?,
            port: row.get(12)?,
            share_enabled: row.get(13)?,
            run_in_container: row.get(14)?,
            install_path_exists,
            backups_path_exists,
        })
    })?;

    let mut servers = Vec::new();
    for server in server_iter {
        servers.push(server?);
    }
    Ok(servers)
}

pub fn add_server(conn: &Connection, server: &Server) -> Result<i64> {
    conn.execute(
        "INSERT INTO servers (
            name, minecraft_version, server_type, install_path, jar_path, status, ram_min, ram_max, java_path, created_at, last_started_at, port, share_enabled, run_in_container
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            server.name,
            server.minecraft_version,
            server.server_type,
            server.install_path,
            server.jar_path,
            server.status,
            server.ram_min,
            server.ram_max,
            server.java_path,
            server.created_at,
            server.last_started_at,
            server.port,
            server.share_enabled,
            server.run_in_container
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_server_status(conn: &Connection, server_id: i64, status: &str) -> Result<()> {
    conn.execute(
        "UPDATE servers SET status = ?1 WHERE id = ?2",
        params![status, server_id],
    )?;
    Ok(())
}

pub fn update_server_port(conn: &Connection, server_id: i64, port: i32) -> Result<()> {
    conn.execute(
        "UPDATE servers SET port = ?1 WHERE id = ?2",
        params![port, server_id],
    )?;
    Ok(())
}

pub fn update_server_sharing(conn: &Connection, server_id: i64, enabled: bool) -> Result<()> {
    conn.execute(
        "UPDATE servers SET share_enabled = ?1 WHERE id = ?2",
        params![enabled, server_id],
    )?;
    Ok(())
}

pub fn update_server_version(
    conn: &Connection,
    server_id: i64,
    version: &str,
    jar_path: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE servers SET minecraft_version = ?1, jar_path = ?2 WHERE id = ?3",
        params![version, jar_path, server_id],
    )?;
    Ok(())
}

pub fn update_server_type_and_version(
    conn: &Connection,
    server_id: i64,
    server_type: &str,
    version: &str,
    jar_path: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE servers SET server_type = ?1, minecraft_version = ?2, jar_path = ?3 WHERE id = ?4",
        params![server_type, version, jar_path, server_id],
    )?;
    Ok(())
}

pub fn update_server_profile(
    conn: &Connection,
    server_id: i64,
    name: &str,
    jar_path: &str,
    ram_min: i32,
    ram_max: i32,
    java_path: &str,
    run_in_container: bool,
) -> Result<()> {
    conn.execute(
        "UPDATE servers SET name = ?1, jar_path = ?2, ram_min = ?3, ram_max = ?4, java_path = ?5, run_in_container = ?6 WHERE id = ?7",
        params![name, jar_path, ram_min, ram_max, java_path, run_in_container, server_id],
    )?;
    Ok(())
}

pub fn update_server_last_started(
    conn: &Connection,
    server_id: i64,
    last_started_at: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE servers SET last_started_at = ?1 WHERE id = ?2",
        params![last_started_at, server_id],
    )?;
    Ok(())
}

pub fn delete_server(conn: &Connection, server_id: i64) -> Result<()> {
    conn.execute("DELETE FROM servers WHERE id = ?1", params![server_id])?;
    Ok(())
}

pub fn get_settings(conn: &Connection) -> Result<AppSettings> {
    conn.query_row(
        "SELECT default_server_dir, default_ram_min, default_ram_max, default_java_path, theme, confirm_delete, confirm_stop, auto_scroll_console, check_updates_startup, auto_restart, tunnel_enabled, tunnel_relay, tunnel_token FROM settings WHERE id = 1",
        [],
        |row| {
            Ok(AppSettings {
                default_server_dir: row.get(0)?,
                default_ram_min: row.get(1)?,
                default_ram_max: row.get(2)?,
                default_java_path: row.get(3)?,
                theme: row.get(4)?,
                confirm_delete: row.get(5)?,
                confirm_stop: row.get(6)?,
                auto_scroll_console: row.get(7)?,
                check_updates_startup: row.get(8)?,
                auto_restart: row.get(9)?,
                tunnel_enabled: row.get(10)?,
                tunnel_relay: row.get(11)?,
                tunnel_token: row.get(12)?,
            })
        },
    )
}

pub fn update_settings(conn: &Connection, settings: &AppSettings) -> Result<()> {
    conn.execute(
        "UPDATE settings SET 
            default_server_dir = ?1, 
            default_ram_min = ?2, 
            default_ram_max = ?3, 
            default_java_path = ?4, 
            theme = ?5, 
            confirm_delete = ?6, 
            confirm_stop = ?7, 
            auto_scroll_console = ?8, 
            check_updates_startup = ?9,
            auto_restart = ?10,
            tunnel_enabled = ?11,
            tunnel_relay = ?12,
            tunnel_token = ?13
        WHERE id = 1",
        params![
            settings.default_server_dir,
            settings.default_ram_min,
            settings.default_ram_max,
            settings.default_java_path,
            settings.theme,
            settings.confirm_delete,
            settings.confirm_stop,
            settings.auto_scroll_console,
            settings.check_updates_startup,
            settings.auto_restart,
            settings.tunnel_enabled,
            settings.tunnel_relay,
            settings.tunnel_token
        ],
    )?;
    Ok(())
}

pub fn get_server(conn: &Connection, server_id: i64) -> Result<Option<Server>> {
    let mut stmt = conn.prepare("SELECT id, name, minecraft_version, server_type, install_path, jar_path, status, ram_min, ram_max, java_path, created_at, last_started_at, port, share_enabled, run_in_container FROM servers WHERE id = ?1")?;
    let mut rows = stmt.query(params![server_id])?;

    if let Some(row) = rows.next()? {
        let install_path: String = row.get(4)?;
        let path = std::path::Path::new(&install_path);
        let install_path_exists = Some(path.exists());
        let backups_path_exists = Some(path.join(".minedock").join("backups").exists());
        Ok(Some(Server {
            id: Some(row.get(0)?),
            name: row.get(1)?,
            minecraft_version: row.get(2)?,
            server_type: row.get(3)?,
            install_path,
            jar_path: row.get(5)?,
            status: row.get(6)?,
            ram_min: row.get(7)?,
            ram_max: row.get(8)?,
            java_path: row.get(9)?,
            created_at: row.get(10)?,
            last_started_at: row.get(11)?,
            port: row.get(12)?,
            share_enabled: row.get(13)?,
            run_in_container: row.get(14)?,
            install_path_exists,
            backups_path_exists,
        }))
    } else {
        Ok(None)
    }
}

pub fn get_schedules(conn: &Connection, server_id: i64) -> Result<Vec<ServerSchedule>> {
    let mut stmt = conn.prepare("SELECT id, server_id, name, cron_expression, is_active, require_online FROM schedules WHERE server_id = ?1")?;
    let schedule_iter = stmt.query_map([server_id], |row| {
        Ok(ServerSchedule {
            id: Some(row.get(0)?),
            server_id: row.get(1)?,
            name: row.get(2)?,
            cron_expression: row.get(3)?,
            is_active: row.get(4)?,
            require_online: row.get(5)?,
            tasks: Vec::new(),
        })
    })?;
    let mut schedules = Vec::new();
    for schedule in schedule_iter {
        let mut sched = schedule?;
        sched.tasks = get_schedule_tasks(conn, sched.id.unwrap())?;
        schedules.push(sched);
    }
    Ok(schedules)
}

pub fn get_all_active_schedules(conn: &Connection) -> Result<Vec<ServerSchedule>> {
    let mut stmt = conn.prepare("SELECT id, server_id, name, cron_expression, is_active, require_online FROM schedules WHERE is_active = 1")?;
    let schedule_iter = stmt.query_map([], |row| {
        Ok(ServerSchedule {
            id: Some(row.get(0)?),
            server_id: row.get(1)?,
            name: row.get(2)?,
            cron_expression: row.get(3)?,
            is_active: row.get(4)?,
            require_online: row.get(5)?,
            tasks: Vec::new(),
        })
    })?;
    let mut schedules = Vec::new();
    for schedule in schedule_iter {
        let mut sched = schedule?;
        sched.tasks = get_schedule_tasks(conn, sched.id.unwrap())?;
        schedules.push(sched);
    }
    Ok(schedules)
}

fn get_schedule_tasks(conn: &Connection, schedule_id: i64) -> Result<Vec<ScheduleTask>> {
    let mut stmt = conn.prepare("SELECT id, sequence_order, action, payload, time_offset_secs, continue_on_failure FROM schedule_tasks WHERE schedule_id = ?1 ORDER BY sequence_order ASC")?;
    let task_iter = stmt.query_map([schedule_id], |row| {
        Ok(ScheduleTask {
            id: Some(row.get(0)?),
            schedule_id: Some(schedule_id),
            sequence_order: row.get(1)?,
            action: row.get(2)?,
            payload: row.get(3)?,
            time_offset_secs: row.get(4)?,
            continue_on_failure: row.get(5)?,
        })
    })?;
    let mut tasks = Vec::new();
    for task in task_iter {
        tasks.push(task?);
    }
    Ok(tasks)
}

pub fn add_schedule(conn: &Connection, schedule: &ServerSchedule) -> Result<i64> {
    conn.execute(
        "INSERT INTO schedules (server_id, name, cron_expression, is_active, require_online, action) VALUES (?1, ?2, ?3, ?4, ?5, '')",
        params![
            schedule.server_id,
            schedule.name,
            schedule.cron_expression,
            schedule.is_active,
            schedule.require_online
        ],
    )?;
    let schedule_id = conn.last_insert_rowid();

    for task in &schedule.tasks {
        conn.execute(
            "INSERT INTO schedule_tasks (schedule_id, sequence_order, action, payload, time_offset_secs, continue_on_failure) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                schedule_id,
                task.sequence_order,
                task.action,
                task.payload,
                task.time_offset_secs,
                task.continue_on_failure
            ],
        )?;
    }

    Ok(schedule_id)
}

pub fn update_schedule(conn: &Connection, schedule: &ServerSchedule) -> Result<()> {
    conn.execute(
        "UPDATE schedules SET name = ?1, cron_expression = ?2, is_active = ?3, require_online = ?4 WHERE id = ?5",
        params![
            schedule.name,
            schedule.cron_expression,
            schedule.is_active,
            schedule.require_online,
            schedule.id
        ],
    )?;

    if let Some(schedule_id) = schedule.id {
        conn.execute("DELETE FROM schedule_tasks WHERE schedule_id = ?1", params![schedule_id])?;
        for task in &schedule.tasks {
            conn.execute(
                "INSERT INTO schedule_tasks (schedule_id, sequence_order, action, payload, time_offset_secs, continue_on_failure) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    schedule_id,
                    task.sequence_order,
                    task.action,
                    task.payload,
                    task.time_offset_secs,
                    task.continue_on_failure
                ],
            )?;
        }
    }

    Ok(())
}

pub fn delete_schedule(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM schedules WHERE id = ?1", params![id])?;
    Ok(())
}
