use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::{collections::HashMap, sync::{Arc, OnceLock}};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::TcpStream,
    sync::{Mutex, Notify},
    task::JoinSet,
    time::{sleep, Duration},
};

use crate::database::{get_servers, get_settings, DbState};
use tauri::{AppHandle, Manager};

type HmacSha256 = Hmac<Sha256>;
static CONFIG_CHANGED: OnceLock<Notify> = OnceLock::new();

pub fn notify_config_changed() {
    CONFIG_CHANGED.get_or_init(Notify::new).notify_one();
}

async fn read_varint(stream: &mut TcpStream) -> Result<i32, String> {
    let mut value = 0i32;
    for position in 0..5 {
        let byte = stream.read_u8().await.map_err(|e| e.to_string())?;
        value |= ((byte & 0x7f) as i32) << (position * 7);
        if byte & 0x80 == 0 { return Ok(value); }
    }
    Err("Invalid Minecraft packet".into())
}

fn write_varint(mut value: usize, output: &mut Vec<u8>) {
    loop {
        if value & !0x7f == 0 {
            output.push(value as u8);
            break;
        }
        output.push(((value & 0x7f) | 0x80) as u8);
        value >>= 7;
    }
}

async fn read_packet(stream: &mut TcpStream) -> Result<Vec<u8>, String> {
    let length = usize::try_from(read_varint(stream).await?).map_err(|_| "Invalid packet length")?;
    if length > 4096 { return Err("Minecraft packet too large".into()); }
    let mut packet = vec![0; length];
    stream.read_exact(&mut packet).await.map_err(|e| e.to_string())?;
    Ok(packet)
}

async fn write_packet(stream: &mut TcpStream, packet: &[u8]) -> Result<(), String> {
    let mut framed = Vec::with_capacity(packet.len() + 5);
    write_varint(packet.len(), &mut framed);
    framed.extend_from_slice(packet);
    stream.write_all(&framed).await.map_err(|e| e.to_string())
}

async fn send_offline_status(stream: &mut TcpStream) -> Result<(), String> {
    let _handshake = read_packet(stream).await?;
    let _request = read_packet(stream).await?;
    let message = "This Host is offline or does not exist";
    let start = (0xE6u8, 0x36u8, 0x36u8);
    let end = (0xC4u8, 0x11u8, 0x11u8);
    let extra: Vec<serde_json::Value> = message.chars().enumerate().map(|(index, character)| {
        let ratio = index as f32 / (message.len().saturating_sub(1) as f32);
        let channel = |from: u8, to: u8| (from as f32 + (to as f32 - from as f32) * ratio).round() as u8;
        serde_json::json!({
            "text": character.to_string(),
            "color": format!("#{:02X}{:02X}{:02X}", channel(start.0, end.0), channel(start.1, end.1), channel(start.2, end.2))
        })
    }).collect();
    let status = serde_json::json!({
        "version": { "name": "Offline", "protocol": 767 },
        "players": { "max": 0, "online": 0 },
        "description": { "text": "", "extra": extra }
    }).to_string();
    let mut response = vec![0];
    write_varint(status.len(), &mut response);
    response.extend_from_slice(status.as_bytes());
    write_packet(stream, &response).await?;
    if let Ok(ping) = read_packet(stream).await {
        write_packet(stream, &ping).await?;
    }
    Ok(())
}

fn signature(token: &str, message: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(token.as_bytes()).expect("HMAC accepts any key");
    mac.update(message.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

async fn handshake(stream: TcpStream, token: &str, command: &str) -> Result<BufReader<TcpStream>, String> {
    let mut stream = BufReader::new(stream);
    
    let mut nonce = String::new();
    tokio::time::timeout(Duration::from_secs(2), stream.read_line(&mut nonce))
        .await
        .map_err(|_| "Reading nonce timed out".to_string())?
        .map_err(|e| e.to_string())?;
    let nonce = nonce.trim();
    
    let auth = signature(token, &format!("{nonce}:{command}"));
    tokio::time::timeout(Duration::from_secs(2), stream.get_mut().write_all(format!("{command} {auth}\n").as_bytes()))
        .await
        .map_err(|_| "Writing signature timed out".to_string())?
        .map_err(|e| e.to_string())?;
        
    let mut response = String::new();
    tokio::time::timeout(Duration::from_secs(2), stream.read_line(&mut response))
        .await
        .map_err(|_| "Reading response timed out".to_string())?
        .map_err(|e| e.to_string())?;
        
    if response.trim() != "OK" { return Err(response.trim().to_string()); }
    Ok(stream)
}

pub async fn test_relay(relay: &str, token: &str) -> Result<(), String> {
    let stream = tokio::time::timeout(Duration::from_secs(5), TcpStream::connect(relay))
        .await.map_err(|_| "Relay connection timed out".to_string())?
        .map_err(|e| format!("Could not connect to relay: {e}"))?;
    let test_port = 1;
    let _ = handshake(stream, token, &format!("CONTROL {test_port}")).await?;
    Ok(())
}

async fn client_session(relay: String, token: String, port: u16) -> Result<(), String> {
    let addrs: Vec<std::net::SocketAddr> = tokio::net::lookup_host(&relay)
        .await
        .map_err(|e| format!("DNS resolution failed for {relay}: {e}"))?
        .collect();
    if addrs.is_empty() {
        return Err(format!("Could not resolve relay address: {relay}"));
    }

    let stream = TcpStream::connect(&addrs[..]).await.map_err(|e| e.to_string())?;
    stream.set_nodelay(true).map_err(|e| e.to_string())?;
    let mut control = handshake(stream, &token, &format!("CONTROL {port}")).await?;
    let mut data_sessions = JoinSet::new();
    loop {
        while data_sessions.try_join_next().is_some() {}
        let mut line = String::new();
        if control.read_line(&mut line).await.map_err(|e| e.to_string())? == 0 {
            return Err("relay disconnected".into());
        }
        let Some(session) = line.trim().strip_prefix("OPEN ") else { continue };
        let addrs = addrs.clone();
        let token = token.clone();
        let session = session.to_string();
        data_sessions.spawn(async move {
            let Ok(stream) = TcpStream::connect(&addrs[..]).await else { return };
            let _ = stream.set_nodelay(true);
            let Ok(mut remote) = handshake(stream, &token, &format!("DATA {port} {session}")).await else { return };
            let Ok(mut local) = TcpStream::connect(("127.0.0.1", port)).await else {
                let _ = send_offline_status(remote.get_mut()).await;
                return;
            };
            let _ = local.set_nodelay(true);
            let _ = tokio::io::copy_bidirectional(remote.get_mut(), &mut local).await;
        });
    }
}

pub fn start_client(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let sessions = Arc::new(Mutex::new(HashMap::<u16, tokio::task::JoinHandle<()>>::new()));
        let config_changed = CONFIG_CHANGED.get_or_init(Notify::new);
        loop {
            tokio::select! {
                _ = sleep(Duration::from_secs(3)) => {}
                _ = config_changed.notified() => {}
            }
            let config = app.try_state::<DbState>().and_then(|state| {
                let conn = state.db.lock().ok()?;
                Some((get_settings(&conn).ok()?, get_servers(&conn).ok()?))
            });
            let Some((settings, servers)) = config else { continue };
            let mut active = sessions.lock().await;
            if !settings.tunnel_enabled || settings.tunnel_relay.is_empty() || settings.tunnel_token.is_empty() {
                for (_, task) in active.drain() { task.abort(); }
                continue;
            }
            let mut wanted: Vec<u16> = servers.into_iter()
                .filter(|server| server.share_enabled)
                .filter_map(|server| u16::try_from(server.port).ok())
                .collect();
            wanted.sort_unstable();
            wanted.dedup();
            active.retain(|port, task| {
                if !wanted.contains(port) {
                    task.abort();
                    false
                } else {
                    !task.is_finished()
                }
            });
            for port in wanted {
                if active.contains_key(&port) { continue; }
                let relay = settings.tunnel_relay.clone();
                let token = settings.tunnel_token.clone();
                active.insert(port, tokio::spawn(async move {
                    loop {
                        let _ = client_session(relay.clone(), token.clone(), port).await;
                        sleep(Duration::from_secs(5)).await;
                    }
                }));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::signature;

    #[test]
    fn signatures_are_stable_and_message_bound() {
        assert_eq!(signature("token", "nonce:CONTROL 25565"), signature("token", "nonce:CONTROL 25565"));
        assert_ne!(signature("token", "a"), signature("token", "b"));
    }
}
