use tokio::sync::mpsc::UnboundedSender;
use tauri::{State, command};
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};

pub enum RpcMessage {
    Update {
        details: Option<String>,
        state_str: Option<String>,
        players_cur: Option<i32>,
        players_max: Option<i32>,
        install_path: Option<String>,
        start_time: Option<i64>,
    },
    Clear,
}

pub struct DiscordState {
    pub tx: UnboundedSender<RpcMessage>,
}

fn get_max_players(install_path: &str) -> i32 {
    let path = std::path::Path::new(install_path).join("server.properties");
    if let Ok(content) = std::fs::read_to_string(path) {
        for line in content.lines() {
            if line.trim().starts_with("max-players") {
                if let Some(val) = line.split('=').nth(1) {
                    if let Ok(max) = val.trim().parse::<i32>() {
                        return max;
                    }
                }
            }
        }
    }
    20 // fallback default
}

pub fn start_rpc_worker(mut rx: tokio::sync::mpsc::UnboundedReceiver<RpcMessage>) {
    println!("[Discord RPC] Background worker started.");
    tauri::async_runtime::spawn(async move {
        let mut client: Option<DiscordIpcClient> = None;

        // Track the last successfully set presence fields to deduplicate updates
        let mut last_details: Option<String> = None;
        let mut last_state_str: Option<String> = None;
        let mut last_players_cur: Option<i32> = None;
        let mut last_players_max: Option<i32> = None;
        let mut last_install_path: Option<String> = None;
        let mut last_start_time: Option<i64> = None;
        let mut last_was_clear = false;

        while let Some(msg) = rx.recv().await {
            match msg {
                RpcMessage::Update {
                    details,
                    state_str,
                    players_cur,
                    players_max,
                    install_path,
                    start_time,
                } => {
                    // Check if this update is identical to the last successfully set one
                    if !last_was_clear
                        && client.is_some()
                        && details == last_details
                        && state_str == last_state_str
                        && players_cur == last_players_cur
                        && players_max == last_players_max
                        && install_path == last_install_path
                        && start_time == last_start_time
                    {
                        // Skip duplicate update to avoid rate limiting
                        continue;
                    }

                    let details_clone = details.clone();
                    let state_str_clone = state_str.clone();
                    let players_cur_clone = players_cur;
                    let players_max_clone = players_max;
                    let install_path_clone = install_path.clone();
                    let start_time_clone = start_time;

                    let c_temp = client.take();
                    let set_res = tokio::task::spawn_blocking(move || {
                        // 1. Get or connect client
                        let mut c = match c_temp {
                            Some(c) => c,
                            None => {
                                println!("[Discord RPC] Connecting to Discord...");
                                let mut client = DiscordIpcClient::new("1520578080664719450").map_err(|e| e.to_string())?;
                                client.connect().map(|_| client).map_err(|e| e.to_string())?
                            }
                        };

                        // 2. Build activity
                        let mut act = activity::Activity::new();

                        if let Some(ref d) = details_clone {
                            act = act.details(d);
                        }
                        if let Some(ref s) = state_str_clone {
                            act = act.state(s);
                        }

                        let assets = activity::Assets::new()
                            .large_image("minedock")
                            .large_text("MineDock");
                        act = act.assets(assets);

                        let mut final_max = players_max_clone;
                        if final_max.is_none() {
                            if let Some(ref path) = install_path_clone {
                                final_max = Some(get_max_players(path));
                            }
                        }

                        if let Some(cur) = players_cur_clone {
                            let max = final_max.unwrap_or(20);
                            let party = activity::Party::new()
                                .size([cur, max]);
                            act = act.party(party);
                        }

                        if let Some(start) = start_time_clone {
                            let timestamps = activity::Timestamps::new()
                                .start(start);
                            act = act.timestamps(timestamps);
                        }

                        // 3. Set activity
                        c.set_activity(act).map(|_| c).map_err(|e| e.to_string())
                    }).await;

                    match set_res {
                        Ok(Ok(c_back)) => {
                            println!("[Discord RPC] Presence updated successfully.");
                            client = Some(c_back);

                            // Save these fields as the last set ones
                            last_details = details;
                            last_state_str = state_str;
                            last_players_cur = players_cur;
                            last_players_max = players_max;
                            last_install_path = install_path;
                            last_start_time = start_time;
                            last_was_clear = false;
                        }
                        Ok(Err(e)) => {
                            println!("[Discord RPC] Failed to update presence: {}", e);
                            client = None;
                            // Invalidate cache so we retry next time
                            last_details = None;
                        }
                        Err(e) => {
                            println!("[Discord RPC] Background thread panicked: {:?}", e);
                            client = None;
                            last_details = None;
                        }
                    }
                }
                RpcMessage::Clear => {
                    println!("[Discord RPC] Clearing presence.");
                    last_was_clear = true;
                    if let Some(mut c) = client.take() {
                        let _ = tokio::task::spawn_blocking(move || {
                            let _ = c.close();
                        }).await;
                    }
                }
            }
        }
    });
}

#[command]
pub fn update_discord_rpc(
    state: State<'_, DiscordState>,
    details: Option<String>,
    state_str: Option<String>,
    players_cur: Option<i32>,
    players_max: Option<i32>,
    install_path: Option<String>,
    start_time: Option<i64>,
) -> Result<(), String> {
    state.tx.send(RpcMessage::Update {
        details,
        state_str,
        players_cur,
        players_max,
        install_path,
        start_time,
    }).map_err(|e| e.to_string())
}

#[command]
pub fn clear_discord_rpc(state: State<'_, DiscordState>) -> Result<(), String> {
    state.tx.send(RpcMessage::Clear).map_err(|e| e.to_string())
}
