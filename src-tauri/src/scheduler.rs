use crate::database::{get_all_active_schedules, get_server, DbState};
use crate::process::ProcessManager;
use chrono::{Datelike, Local, Timelike};
use tauri::{AppHandle, Manager};

pub fn matches_cron_field(field: &str, val: u32, min_val: u32, max_val: u32) -> bool {
    if field == "*" {
        return true;
    }
    if let Some(step) = field.strip_prefix("*/") {
        if let Ok(step_val) = step.parse::<u32>() {
            return (val - min_val) % step_val == 0;
        }
    }
    for part in field.split(',') {
        if let Some((start, end)) = part.split_once('-') {
            if let (Ok(s), Ok(e)) = (start.parse::<u32>(), end.parse::<u32>()) {
                if val >= s && val <= e {
                    return true;
                }
            }
        } else if let Ok(exact) = part.parse::<u32>() {
            let adjusted_exact = if max_val == 6 && exact == 7 { 0 } else { exact };
            let adjusted_val = if max_val == 6 && val == 7 { 0 } else { val };
            if adjusted_exact == adjusted_val {
                return true;
            }
        }
    }
    false
}

pub fn matches_cron(cron: &str, time: chrono::DateTime<Local>) -> bool {
    let fields: Vec<&str> = cron.split_whitespace().collect();
    if fields.len() != 5 {
        return false;
    }
    let minute = time.minute();
    let hour = time.hour();
    let day = time.day();
    let month = time.month();
    let weekday = time.weekday().num_days_from_sunday(); // 0 = Sunday, 1 = Monday ... 6 = Saturday

    matches_cron_field(fields[0], minute, 0, 59)
        && matches_cron_field(fields[1], hour, 0, 23)
        && matches_cron_field(fields[2], day, 1, 31)
        && matches_cron_field(fields[3], month, 1, 12)
        && matches_cron_field(fields[4], weekday, 0, 6)
}

pub fn start_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Align with the start of the next minute
        let now = Local::now();
        let seconds_to_next_minute = 61 - now.second(); // wait slightly past the minute mark
        tokio::time::sleep(tokio::time::Duration::from_secs(seconds_to_next_minute as u64)).await;

        loop {
            let now = Local::now();
            let app_clone = app.clone();

            // Fetch active schedules
            let schedules = {
                if let Some(state) = app.try_state::<DbState>() {
                    if let Ok(conn) = state.db.lock() {
                        get_all_active_schedules(&conn).unwrap_or_default()
                    } else {
                        Vec::new()
                    }
                } else {
                    Vec::new()
                }
            };

            for schedule in schedules {
                if matches_cron(&schedule.cron_expression, now) {
                    let app_inner = app_clone.clone();
                    tokio::spawn(async move {
                        run_schedule_tasks(app_inner, schedule).await;
                    });
                }
            }

            // Sleep until the next minute boundary
            let sleep_secs = 61 - Local::now().second();
            tokio::time::sleep(tokio::time::Duration::from_secs(sleep_secs as u64)).await;
        }
    });
}

pub async fn run_schedule_tasks(app: AppHandle, schedule: crate::models::ServerSchedule) {
    let server_id = schedule.server_id;
    let pm = app.state::<ProcessManager>();

    if schedule.require_online {
        let is_online = {
            if let Some(state) = app.try_state::<DbState>() {
                if let Ok(conn) = state.db.lock() {
                    get_server(&conn, server_id).ok().flatten().map(|s| s.status) == Some("online".to_string())
                } else { false }
            } else { false }
        };
        if !is_online {
            return; // Skip execution
        }
    }

    for task in schedule.tasks {
        if task.time_offset_secs > 0 {
            tokio::time::sleep(tokio::time::Duration::from_secs(task.time_offset_secs as u64)).await;
        }

        let mut success = true;
        match task.action.as_str() {
            "start" => {
                success = pm.start_server(server_id).await.is_ok();
            }
            "stop" => {
                success = pm.stop_server(server_id).await.is_ok();
            }
            "restart" => {
                success = pm.stop_server(server_id).await.is_ok();
                if success {
                    for _ in 0..60 {
                        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                        let status = {
                            if let Some(state) = app.try_state::<DbState>() {
                                if let Ok(conn) = state.db.lock() {
                                    get_server(&conn, server_id).ok().flatten().map(|s| s.status)
                                } else { None }
                            } else { None }
                        };
                        if status.as_deref() == Some("offline") {
                            break;
                        }
                    }
                    success = pm.start_server(server_id).await.is_ok();
                }
            }
            "command" => {
                if let Some(cmd) = task.payload {
                    success = pm.send_command(server_id, cmd).await.is_ok();
                }
            }
            "backup" => {
                let server = {
                    if let Some(state) = app.try_state::<DbState>() {
                        if let Ok(conn) = state.db.lock() {
                            get_server(&conn, server_id).ok().flatten()
                        } else { None }
                    } else { None }
                };
                if let Some(server) = server {
                    let backup_name = format!("Scheduled_{}", chrono::Local::now().format("%Y-%m-%d_%H-%M-%S"));
                    let app_backup = app.clone();
                    let res = tokio::task::spawn_blocking(move || {
                        crate::backups::create_backup(&app_backup, &server.install_path, &backup_name)
                    }).await;
                    success = res.is_ok() && res.unwrap().is_ok();
                } else {
                    success = false;
                }
            }
            _ => { success = false; }
        }

        if !success && !task.continue_on_failure {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn test_cron_matching() {
        let dt = Local.with_ymd_and_hms(2026, 7, 7, 14, 30, 0).unwrap();
        // every minute
        assert!(matches_cron("* * * * *", dt));
        // specific minute
        assert!(matches_cron("30 * * * *", dt));
        assert!(!matches_cron("15 * * * *", dt));
        // steps
        assert!(matches_cron("*/5 * * * *", dt));
        assert!(matches_cron("*/10 * * * *", dt));
        assert!(!matches_cron("*/7 * * * *", dt));
        // list
        assert!(matches_cron("15,30,45 * * * *", dt));
        // range
        assert!(matches_cron("20-40 * * * *", dt));
        assert!(!matches_cron("0-10 * * * *", dt));
    }
}
