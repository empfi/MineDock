use crate::database::{add_server, get_server, get_servers, get_settings, DbState};
use crate::downloader::download_server_software;
use crate::models::Server;
use crate::plugins::{install_plugin, resolve_download, search_marketplace};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone)]
pub struct AiCredential {
    pub provider: String,
    pub key: String,
}

pub struct AiState(pub Mutex<Option<AiCredential>>);
pub struct AiCancelState(pub std::sync::atomic::AtomicBool);

#[derive(Clone, Deserialize)]
pub struct ChatMessage { pub role: String, pub content: String }

#[derive(Serialize)]
pub struct AiWidget {
    pub kind: String,
    pub title: String,
    pub fields: serde_json::Value,
}

#[derive(Serialize)]
pub struct AiReply {
    pub message: String,
    pub widgets: Vec<AiWidget>,
    pub sources: Vec<serde_json::Value>,
    pub activities: Vec<String>,
    pub created_server_id: Option<i64>,
}

fn user_authorized(messages: &[ChatMessage], action: &str) -> bool {
    let text = messages.iter().filter(|message| message.role == "user").map(|message| message.content.to_lowercase()).collect::<Vec<_>>().join("\n");
    match action {
        "install" => text.contains("install") || text.contains("download"),
        "create" => (text.contains("create") || text.contains("set up") || text.contains("setup") || text.contains("configure") || text.contains("server_name:"))
            && (text.contains("eula_accepted: true") || text.contains("accept the eula") || text.contains("accept eula") || text.contains("eula_accepted: 'true'") || text.contains("eula: true") || text.contains("agree")),
        _ => false,
    }
}

fn wants_server_creation(messages: &[ChatMessage]) -> bool {
    messages.iter().rev().find(|message| message.role == "user").is_some_and(|message| {
        let text = message.content.to_lowercase();
        (text.contains("create") || text.contains("set up") || text.contains("setup") || text.contains("configure")) && text.contains("server")
    })
}

fn extract_structured_field(text: &str, field_name: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        (name.trim().eq_ignore_ascii_case(field_name)).then(|| value.trim().trim_matches('"').trim_matches('\'').to_string())
    })
}

fn extract_name_after_keyword(text: &str, keyword: &str) -> Option<String> {
    let lower = text.to_lowercase();
    let start = lower.find(keyword)? + keyword.len();
    let rest = text[start..].trim_start();
    if let Some(quoted) = rest.strip_prefix('"') {
        return quoted.split_once('"').map(|(value, _)| value.trim().to_string()).filter(|value| !value.is_empty());
    }
    if let Some(quoted) = rest.strip_prefix('\'') {
        return quoted.split_once('\'').map(|(value, _)| value.trim().to_string()).filter(|value| !value.is_empty());
    }
    let end = rest.find(['\n', ',', '.', '!', '?']).unwrap_or(rest.len());
    let candidate = rest[..end]
        .split(" with ")
        .next()
        .unwrap_or("")
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string();
    (!candidate.is_empty()).then_some(candidate)
}

fn infer_server_name(messages: &[ChatMessage]) -> Option<String> {
    for message in messages.iter().rev().filter(|message| message.role == "user") {
        if let Some(name) = extract_structured_field(&message.content, "server_name") {
            return Some(name);
        }
        if let Some(name) = extract_name_after_keyword(&message.content, "called") {
            return Some(name);
        }
        if let Some(name) = extract_name_after_keyword(&message.content, "named") {
            return Some(name);
        }
    }
    None
}

fn latest_setup_submission(messages: &[ChatMessage]) -> Option<serde_json::Value> {
    let latest_user = messages.iter().rev().find(|message| message.role == "user")?;
    let mut args = serde_json::Map::new();
    for line in latest_user.content.lines() {
        let Some((name, raw_value)) = line.split_once(':') else { continue; };
        let key = name.trim();
        let value = raw_value.trim().trim_matches('"').trim_matches('\'');
        match key {
            "server_name" | "minecraft_version" | "server_type" => {
                if !value.is_empty() {
                    args.insert(key.to_string(), serde_json::Value::String(value.to_string()));
                }
            }
            "ram_min_mb" | "ram_max_mb" | "port" => {
                if let Ok(parsed) = value.parse::<i64>() {
                    args.insert(key.to_string(), serde_json::json!(parsed));
                }
            }
            "eula_accepted" => {
                let normalized = value.eq_ignore_ascii_case("true");
                args.insert(key.to_string(), serde_json::json!(normalized));
            }
            _ => {}
        }
    }
    (!args.is_empty()).then_some(serde_json::Value::Object(args))
}

fn complete_setup_submission(args: &serde_json::Value) -> bool {
    let Some(obj) = args.as_object() else { return false; };
    ["server_name", "minecraft_version", "server_type", "ram_min_mb", "ram_max_mb", "port", "eula_accepted"]
        .into_iter()
        .all(|field| obj.contains_key(field))
}

fn setup_widget_with_args(args: &serde_json::Value) -> AiWidget {
    let mut fields = serde_json::json!([
        {"name":"server_name","label":"Server Name","type":"text"},
        {"name":"minecraft_version","label":"Minecraft Version","type":"text"},
        {"name":"server_type","label":"Server Type","type":"select","options":["vanilla","paper","purpur","velocity","fabric","forge","neoforge"]},
        {"name":"ram_min_mb","label":"Minimum RAM (MB)","type":"number"},
        {"name":"ram_max_mb","label":"Maximum RAM (MB)","type":"number"},
        {"name":"port","label":"Port","type":"number"},
        {"name":"eula_accepted","label":"Accept EULA","type":"checkbox"}
    ]);
    if let (Some(field_arr), Some(obj)) = (fields.as_array_mut(), args.as_object()) {
        for field in field_arr {
            if let Some(name) = field.get("name").and_then(|value| value.as_str()) {
                if let Some(value) = obj.get(name) {
                    field["value"] = value.clone();
                }
            }
        }
    }
    AiWidget {
        kind: "form".into(),
        title: "New server setup".into(),
        fields,
    }
}

fn setup_widget(messages: &[ChatMessage]) -> AiWidget {
    let mut args = latest_setup_submission(messages).unwrap_or_else(|| serde_json::json!({}));
    if let Some(server_name) = infer_server_name(messages) {
        if let Some(obj) = args.as_object_mut() {
            obj.entry("server_name").or_insert_with(|| serde_json::Value::String(server_name));
        }
    }
    setup_widget_with_args(&args)
}

enum AwsAuth {
    DefaultChain,
    StaticCredentials { access_key: String, secret_key: String },
    BedrockApiKey(String),
}

fn parse_aws_credentials(cred_str: &str) -> Result<AwsAuth, String> {
    let trimmed = cred_str.trim();
    if trimmed.is_empty() {
        return Ok(AwsAuth::DefaultChain);
    }

    if let Some((access_key, secret_key)) = trimmed.split_once(':') {
        let access_key = access_key.trim();
        let secret_key = secret_key.trim();
        if access_key.is_empty() || secret_key.is_empty() {
            return Err("AWS credentials must be a full access_key_id:secret_access_key pair.".into());
        }
        return Ok(AwsAuth::StaticCredentials {
            access_key: access_key.to_string(),
            secret_key: secret_key.to_string(),
        });
    }

    Ok(AwsAuth::BedrockApiKey(trimmed.to_string()))
}

fn append_bedrock_response_text(message_content: &mut String, content: &serde_json::Value) {
    if let Some(blocks) = content.as_array() {
        for block in blocks {
            if let Some(text) = block.get("text").and_then(|value| value.as_str()) {
                message_content.push_str(text);
            }
        }
    }
}

fn normalize_setup_fields(title: &str, fields: &serde_json::Value) -> AiWidget {
    let has_setup = fields.as_array().is_some_and(|arr| {
        arr.iter().any(|f| f["name"] == "server_name" || f["name"] == "eula_accepted")
    });
    if !has_setup {
        return AiWidget {
            kind: "form".into(),
            title: title.into(),
            fields: fields.clone(),
        };
    }
    
    // It's a server setup form, construct full fields
    let mut full_fields = serde_json::json!([
        {"name":"server_name","label":"Server Name","type":"text"},
        {"name":"minecraft_version","label":"Minecraft Version","type":"text"},
        {"name":"server_type","label":"Server Type","type":"select","options":["vanilla","paper","purpur","velocity","fabric","forge","neoforge"]},
        {"name":"ram_min_mb","label":"Minimum RAM (MB)","type":"number"},
        {"name":"ram_max_mb","label":"Maximum RAM (MB)","type":"number"},
        {"name":"port","label":"Port","type":"number"},
        {"name":"eula_accepted","label":"Accept EULA","type":"checkbox"}
    ]);
    
    // Pre-populate value from fields if present
    if let (Some(full_arr), Some(orig_arr)) = (full_fields.as_array_mut(), fields.as_array()) {
        for full_field in full_arr {
            if let Some(orig_field) = orig_arr.iter().find(|f| f["name"] == full_field["name"]) {
                if let Some(val) = orig_field.get("value") {
                    full_field["value"] = val.clone();
                }
            }
        }
    }
    
    AiWidget {
        kind: "form".into(),
        title: title.into(),
        fields: full_fields,
    }
}

fn tool_arguments(value: &serde_json::Value) -> Option<serde_json::Value> {
    if value.is_object() { return Some(value.clone()); }
    value.as_str().and_then(|text| serde_json::from_str(text).ok())
}

async fn create_server_from_args(app: &AppHandle, args: &serde_json::Value) -> Result<(i64, String), String> {
    let name = args["server_name"].as_str().ok_or("Missing server name")?.trim();
    if name.is_empty() || name.contains(['/', '\\']) || name == "." || name == ".." {
        return Err("Invalid server name".into());
    }
    let ram_min = args["ram_min_mb"].as_i64().ok_or("Invalid minimum RAM")? as i32;
    let ram_max = args["ram_max_mb"].as_i64().ok_or("Invalid maximum RAM")? as i32;
    if ram_min > ram_max {
        return Err("Minimum RAM cannot exceed maximum RAM".into());
    }
    if !args["eula_accepted"].as_bool().unwrap_or(false) {
        return Err("Minecraft EULA must be accepted by the user".into());
    }
    let server_type = args["server_type"].as_str().ok_or("Missing server type")?;
    let version = args["minecraft_version"].as_str().ok_or("Missing Minecraft version")?;
    let port = args["port"].as_i64().ok_or("Invalid port")? as i32;
    let (root, java, exists) = {
        let db = app.state::<DbState>();
        let conn = db.db.lock().map_err(|_| "Database unavailable")?;
        let settings = get_settings(&conn).map_err(|e| e.to_string())?;
        let exists = get_servers(&conn)
            .map_err(|e| e.to_string())?
            .iter()
            .any(|item| item.port == port || item.name.eq_ignore_ascii_case(name));
        (settings.default_server_dir, settings.default_java_path, exists)
    };
    if exists {
        return Err("Server name or port is already in use".into());
    }
    if root.trim().is_empty() {
        return Err("Set a default server directory in Settings first".into());
    }
    let path = std::path::Path::new(&root).join(name);
    if path.exists() && path.read_dir().map(|mut entries| entries.next().is_some()).unwrap_or(true) {
        return Err("Target server directory is not empty".into());
    }
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let jar = "server.jar";
    download_server_software(app.clone(), server_type.to_string(), version.to_string(), path.join(jar).to_string_lossy().to_string()).await?;
    std::fs::write(path.join("eula.txt"), "eula=true\n").map_err(|e| e.to_string())?;
    std::fs::write(path.join("server.properties"), format!("server-port={port}\nmotd={name}\n")).map_err(|e| e.to_string())?;
    let profile = Server {
        id: None,
        name: name.into(),
        minecraft_version: version.into(),
        server_type: server_type.into(),
        run_in_container: false,
        install_path: path.to_string_lossy().into(),
        jar_path: jar.into(),
        status: "offline".into(),
        ram_min,
        ram_max,
        java_path: java,
        created_at: chrono::Local::now().to_rfc3339(),
        last_started_at: None,
        port,
        share_enabled: false,
        install_path_exists: None,
        backups_path_exists: None,
    };
    let id = {
        let db = app.state::<DbState>();
        let conn = db.db.lock().map_err(|_| "Database unavailable")?;
        add_server(&conn, &profile).map_err(|e| e.to_string())?
    };
    Ok((id, name.to_string()))
}

fn inline_tool(content: &str) -> Option<(&str, serde_json::Value)> {
    let start = content.find("<ask_user>")? + "<ask_user>".len();
    let json = content[start..].trim();
    let mut depth = 0;
    let mut quoted = false;
    let mut escaped = false;
    for (index, character) in json.char_indices() {
        if quoted {
            if escaped { escaped = false; }
            else if character == '\\' { escaped = true; }
            else if character == '"' { quoted = false; }
            continue;
        }
        match character {
            '"' => quoted = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return serde_json::from_str(&json[..=index]).ok().map(|args| ("ask_user", args));
                }
            }
            _ => {}
        }
    }
    None
}

const TOOLS: &str = r#"[
{"type":"function","function":{"name":"ask_user","description":"Ask the user for structured server setup information using an inline form.","parameters":{"type":"object","properties":{"title":{"type":"string"},"fields":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string","enum":["server_name","minecraft_version","server_type","ram_min_mb","ram_max_mb","port","search_query","eula_accepted"]},"label":{"type":"string"},"type":{"type":"string","enum":["text","number","select","checkbox"]},"value":{"type":["string","number","boolean"]},"options":{"type":"array","items":{"type":"string"}}},"required":["name","label","type"],"additionalProperties":false}}},"required":["title","fields"],"additionalProperties":false}}},
{"type":"function","function":{"name":"search_marketplace","description":"Search compatible Minecraft plugins or mods for the selected registered server.","parameters":{"type":"object","properties":{"query":{"type":"string","minLength":1,"maxLength":80},"project_type":{"type":"string","enum":["plugin","mod","modpack"]}},"required":["query","project_type"],"additionalProperties":false}}},
{"type":"function","function":{"name":"create_server","description":"Create and download a complete Vanilla, Paper, Purpur, or Velocity server inside MineDock's configured server directory after collecting all fields.","parameters":{"type":"object","properties":{"server_name":{"type":"string","minLength":1,"maxLength":48},"server_type":{"type":"string","enum":["vanilla","paper","purpur","velocity"]},"minecraft_version":{"type":"string","minLength":3,"maxLength":24},"ram_min_mb":{"type":"integer","minimum":512,"maximum":65536},"ram_max_mb":{"type":"integer","minimum":512,"maximum":65536},"port":{"type":"integer","minimum":1024,"maximum":65535},"eula_accepted":{"type":"boolean"}},"required":["server_name","server_type","minecraft_version","ram_min_mb","ram_max_mb","port","eula_accepted"],"additionalProperties":false}}},
{"type":"function","function":{"name":"install_marketplace","description":"Install a marketplace plugin or mod into the selected registered server. Use only after showing search results and receiving user intent.","parameters":{"type":"object","properties":{"source":{"type":"string","enum":["Modrinth","Hangar"]},"project_id":{"type":"string","minLength":1,"maxLength":160},"name":{"type":"string","minLength":1,"maxLength":120},"project_type":{"type":"string","enum":["plugin","mod"]}},"required":["source","project_id","name","project_type"],"additionalProperties":false}}}
]"#;

#[tauri::command]
pub async fn set_ai_key(state: State<'_, AiState>, provider: String, key: String) -> Result<(), String> {
    let key = key.trim();
    let provider = provider.to_lowercase();
    
    match provider.as_str() {
        "openrouter" => {
            let valid_format = key.strip_prefix("sk-or-v1-").is_some_and(|secret| secret.len() == 64 && secret.chars().all(|character| character.is_ascii_hexdigit()));
            if !valid_format { return Err("OpenRouter key must use the sk-or-v1- format".into()); }
            reqwest::Client::new()
                .get("https://openrouter.ai/api/v1/key")
                .bearer_auth(key)
                .send().await
                .map_err(|_| "Could not reach OpenRouter")?
                .error_for_status()
                .map_err(|_| "OpenRouter rejected this API key")?;
        }
        "aws" => {
            if key.contains(':') {
                let valid_format = key
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == ':' || c == '+' || c == '/' || c == '=' || c == '-' || c == '_');
                if !valid_format || key.split_once(':').is_none_or(|(left, right)| left.trim().is_empty() || right.trim().is_empty()) {
                    return Err("AWS credentials must be a full access_key_id:secret_access_key pair, or a single Bedrock API key.".into());
                }
            }
        }
        _ => return Err("Unknown provider".into()),
    }
    
    *state.0.lock().map_err(|_| "AI state unavailable")? = Some(AiCredential {
        provider: provider.clone(),
        key: key.to_string(),
    });
    Ok(())
}

#[tauri::command]
pub fn has_ai_key(state: State<'_, AiState>) -> bool {
    state.0.lock().map(|cred| cred.is_some()).unwrap_or(false)
}

#[tauri::command]
pub fn cancel_ai(state: State<'_, AiCancelState>) {
    state.0.store(true, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
pub async fn ai_chat(app: AppHandle, state: State<'_, AiState>, messages: Vec<ChatMessage>, server_id: Option<i64>, model: String) -> Result<AiReply, String> {
    let cred = state.0.lock().map_err(|_| "AI state unavailable")?.clone().ok_or("Connect an AI provider first")?;
    let is_groq = cred.provider == "groq";
    let is_aws = cred.provider == "aws";
    
    let models_to_try = if is_aws {
        let mut models = vec![model.clone()];
        let default_model = "openai.gpt-oss-20b-1:0".to_string();
        let fallback_model = "anthropic.claude-haiku-4-5-20251001-v1:0".to_string();
        if model != default_model {
            models.push(default_model);
        }
        if model != fallback_model && (models.len() == 1 || models[1] != fallback_model) {
            models.push(fallback_model);
        }
        models
    } else if is_groq {
        vec!["openai/gpt-oss-20b".to_string()]
    } else if model == "openrouter/free" {
        vec![
            "meta-llama/llama-3.3-70b-instruct:free".to_string(),
            "meta-llama/llama-3-8b-instruct:free".to_string(),
            "openrouter/free".to_string(),
        ]
    } else {
        vec![model.clone()]
    };
    let mut active_model = models_to_try[0].clone();
    let mut model_index = 0;
    let install_authorized = user_authorized(&messages, "install");
    let create_authorized = user_authorized(&messages, "create");
    let create_requested = wants_server_creation(&messages);
    let latest_setup_args = latest_setup_submission(&messages);

    if create_authorized
        && latest_setup_args.as_ref().is_some_and(complete_setup_submission)
    {
        let (created_id, created_name) = create_server_from_args(&app, latest_setup_args.as_ref().unwrap()).await?;
        return Ok(AiReply {
            message: format!("Server created: {created_name}"),
            widgets: vec![],
            sources: vec![],
            activities: vec![format!("Created server {created_name}")],
            created_server_id: Some(created_id),
        });
    }

    let mut conversation = vec![serde_json::json!({"role":"system","content":"You are DockAI, MineDock's server setup assistant. Help configure Minecraft Java servers with minimal user effort. Infer safe defaults instead of making users choose every setting. For server creation, call ask_user once with every create_server field so MineDock can prefill version, type, RAM, and an available port; never include search_query. If the user has already specified or implied a value for any field (e.g. they provided a name like 'walter' after a previous attempt failed), prefill it using the 'value' field in the ask_user tool call. The UI keeps inferred fields collapsed and asks the user only for server_name and explicit eula_accepted=true unless they choose Customize. Use marketplace search before recommending additions. You have no PC, shell, arbitrary file, or network access beyond provided tools. Never invent tool results. Keep answers concise and action-oriented."})];
    conversation.extend(messages.clone().into_iter().take(30).map(|message| serde_json::json!({"role":message.role,"content":message.content})));
    let tools: serde_json::Value = serde_json::from_str(TOOLS).map_err(|e| e.to_string())?;
    let client = reqwest::Client::new();
    let mut sources = Vec::new();
    let mut activities = Vec::new();
    let mut created_server_id = None;
    for step in 0..8 {
        let mut response_data = None;
        for attempt in 0..3 {
            if is_aws {
                // AWS Bedrock integration via Converse API
                let parsed_auth = parse_aws_credentials(&cred.key)?;

                // Convert conversation to Bedrock format
                let mut bedrock_messages = Vec::new();
                let mut bedrock_messages_json = Vec::new();
                let mut system_prompt = String::new();
                
                for msg in &conversation {
                    match msg["role"].as_str() {
                        Some("system") => {
                            if let Some(content) = msg["content"].as_str() {
                                system_prompt = content.to_string();
                            }
                        }
                        Some("user") => {
                            let text = msg["content"].as_str().unwrap_or("").to_string();
                            bedrock_messages.push(
                                aws_sdk_bedrockruntime::types::Message::builder()
                                    .role(aws_sdk_bedrockruntime::types::ConversationRole::User)
                                    .content(
                                        aws_sdk_bedrockruntime::types::ContentBlock::Text(
                                            text.clone()
                                        )
                                    )
                                    .build()
                                    .map_err(|e| e.to_string())?
                            );
                            bedrock_messages_json.push(serde_json::json!({
                                "role": "user",
                                "content": [{ "text": text }]
                            }));
                        }
                        Some("assistant") => {
                            let text = msg["content"].as_str().unwrap_or("").to_string();
                            bedrock_messages.push(
                                aws_sdk_bedrockruntime::types::Message::builder()
                                    .role(aws_sdk_bedrockruntime::types::ConversationRole::Assistant)
                                    .content(
                                        aws_sdk_bedrockruntime::types::ContentBlock::Text(
                                            text.clone()
                                        )
                                    )
                                    .build()
                                    .map_err(|e| e.to_string())?
                            );
                            bedrock_messages_json.push(serde_json::json!({
                                "role": "assistant",
                                "content": [{ "text": text }]
                            }));
                        }
                        Some("tool") => {
                            // Tool results as user messages
                            let text = msg["content"].as_str().unwrap_or("").to_string();
                            bedrock_messages.push(
                                aws_sdk_bedrockruntime::types::Message::builder()
                                    .role(aws_sdk_bedrockruntime::types::ConversationRole::User)
                                    .content(
                                        aws_sdk_bedrockruntime::types::ContentBlock::Text(
                                            text.clone()
                                        )
                                    )
                                    .build()
                                    .map_err(|e| e.to_string())?
                            );
                            bedrock_messages_json.push(serde_json::json!({
                                "role": "user",
                                "content": [{ "text": text }]
                            }));
                        }
                        _ => {}
                    }
                }

                // Convert Bedrock response to OpenAI format for consistency
                let mut message_content = String::new();
                let mut tool_calls = Vec::new();

                match parsed_auth {
                    AwsAuth::BedrockApiKey(token) => {
                        let mut request_body = serde_json::json!({
                            "messages": bedrock_messages_json,
                        });
                        if !system_prompt.is_empty() {
                            request_body["system"] = serde_json::json!([{ "text": system_prompt }]);
                        }

                        let endpoint = format!(
                            "https://bedrock-runtime.us-east-1.amazonaws.com/model/{}/converse",
                            active_model
                        );
                        let res = client
                            .post(&endpoint)
                            .bearer_auth(token)
                            .header("Content-Type", "application/json")
                            .json(&request_body)
                            .send()
                            .await
                            .map_err(|e| format!("AWS Bedrock request failed: {e}"))?;

                        let status = res.status();
                        if !status.is_success() {
                            let err_text = res.text().await.unwrap_or_default();
                            return Err(format!("AWS Bedrock error {status}: {err_text}"));
                        }

                        let res_json = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
                        append_bedrock_response_text(
                            &mut message_content,
                            &res_json["output"]["message"]["content"],
                        );
                    }
                    AwsAuth::DefaultChain | AwsAuth::StaticCredentials { .. } => {
                        let mut config_loader = aws_config::defaults(aws_config::BehaviorVersion::latest())
                            .region(aws_config::Region::new("us-east-1"));

                        if let AwsAuth::StaticCredentials { access_key, secret_key } = &parsed_auth {
                            config_loader = config_loader.credentials_provider(aws_credential_types::Credentials::new(
                                access_key.clone(),
                                secret_key.clone(),
                                None,
                                None,
                                "minedock",
                            ));
                        }

                        let config = config_loader.load().await;
                        let bedrock_client = aws_sdk_bedrockruntime::Client::new(&config);
                        let res = bedrock_client
                            .converse()
                            .model_id(&active_model)
                            .set_messages(Some(bedrock_messages))
                            .system(aws_sdk_bedrockruntime::types::SystemContentBlock::Text(system_prompt))
                            .send()
                            .await
                            .map_err(|e| format!("AWS Bedrock request failed: {e}"))?;

                        if let Some(output) = res.output() {
                            if let aws_sdk_bedrockruntime::types::ConverseOutput::Message(msg) = output {
                                for content_block in msg.content() {
                                    if let aws_sdk_bedrockruntime::types::ContentBlock::Text(text) = content_block {
                                        message_content.push_str(text);
                                    }
                                }
                            }
                        }
                    }
                }
                
                // Parse tool use from Bedrock response
                if message_content.contains("<function_calls>") {
                    if let Some((_, after)) = message_content.split_once("<function_calls>") {
                        if let Some((func_part, _)) = after.split_once("</function_calls>") {
                            // Parse tool calls from response
                            for line in func_part.lines() {
                                if let Ok(tool_call) = serde_json::from_str::<serde_json::Value>(line.trim()) {
                                    tool_calls.push(tool_call);
                                }
                            }
                        }
                    }
                }
                
                response_data = Some(serde_json::json!({
                    "choices": [{
                        "message": {
                            "content": message_content,
                            "tool_calls": tool_calls
                        }
                    }]
                }));
            } else {
                // OpenRouter via OpenAI API
                let endpoint = "https://openrouter.ai/api/v1/chat/completions";
                let mut req = client.post(endpoint).bearer_auth(&cred.key);
                req = req.header("HTTP-Referer", "https://minedock.local").header("X-Title", "MineDock");
                
                let res = req.json(&serde_json::json!({"model":active_model,"messages":conversation,"tools":tools,"tool_choice":"auto","parallel_tool_calls":false}))
                    .send().await.map_err(|e| format!("AI API request failed: {e}"))?;
                
                let status = res.status();
                if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                    if step == 0 && model_index + 1 < models_to_try.len() {
                        model_index += 1;
                        active_model = models_to_try[model_index].clone();
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        continue;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(1500 * (attempt + 1) as u64)).await;
                    continue;
                }
                
                if !status.is_success() {
                    if step == 0 && model_index + 1 < models_to_try.len() {
                        model_index += 1;
                        active_model = models_to_try[model_index].clone();
                        continue;
                    }
                    let err_text = res.text().await.unwrap_or_default();
                    return Err(format!("OpenRouter error {status}: {err_text}"));
                }
                
                response_data = Some(res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?);
            }
            break;
        }
        let response = response_data.ok_or("Rate limit exceeded. Please retry later.")?;
        let message = response["choices"][0]["message"].clone();
        let calls = message["tool_calls"].as_array().cloned().unwrap_or_default();
        if calls.is_empty() {
            let content = message["content"].as_str().unwrap_or("").trim();
            if let Some(("ask_user", args)) = inline_tool(content) {
                return Ok(AiReply { message: "I need a few details before continuing.".into(), widgets: vec![normalize_setup_fields(args["title"].as_str().unwrap_or("Server details"), &args["fields"])], sources, activities, created_server_id });
            }
            if content.is_empty() && create_requested {
                return Ok(AiReply { message: "Choose a name and accept the EULA. I filled in the rest.".into(), widgets: vec![setup_widget(&messages)], sources, activities, created_server_id });
            }
            if content.is_empty() {
                if !sources.is_empty() {
                    return Ok(AiReply { message: "Plugins found:".into(), widgets: vec![], sources, activities, created_server_id });
                }
                if created_server_id.is_some() {
                    return Ok(AiReply { message: "Server created!".into(), widgets: vec![], sources, activities, created_server_id });
                }
                return Err("DockAI returned an empty response. Retry or choose another model.".into());
            }
            return Ok(AiReply { message: content.to_string(), widgets: vec![], sources, activities, created_server_id });
        }
        conversation.push(message);
        for call in calls {
            let call_id = call["id"].as_str().ok_or("Missing tool call ID")?;
            let name = call["function"]["name"].as_str().ok_or("Missing tool name")?;
            let Some(args) = tool_arguments(&call["function"]["arguments"]) else {
                if name == "ask_user" && create_requested {
                    return Ok(AiReply { message: "Choose a name and accept the EULA. I filled in the rest.".into(), widgets: vec![setup_widget(&messages)], sources, activities, created_server_id });
                }
                conversation.push(serde_json::json!({"role":"tool","tool_call_id":call_id,"content":"Invalid JSON arguments. Call this tool again with valid arguments matching its schema."}));
                continue;
            };
            if name == "ask_user" {
                return Ok(AiReply { message: "I need a few details before continuing.".into(), widgets: vec![normalize_setup_fields(args["title"].as_str().unwrap_or("Server details"), &args["fields"])], sources, activities, created_server_id });
            }
            let server = if name != "create_server" {
                let db = app.state::<DbState>();
                let conn = db.db.lock().map_err(|_| "Database unavailable")?;
                let id = match server_id {
                    Some(id) => id,
                    None => {
                        conversation.push(serde_json::json!({
                            "role": "tool",
                            "tool_call_id": call_id,
                            "content": "Error: No server is currently selected in MineDock. Please tell the user to select one of their servers in the left sidebar first."
                        }));
                        continue;
                    }
                };
                match get_server(&conn, id).map_err(|e| e.to_string())? {
                    Some(s) => Some(s),
                    None => {
                        conversation.push(serde_json::json!({
                            "role": "tool",
                            "tool_call_id": call_id,
                            "content": "Error: Selected server not found. Tell the user to select a valid server from the sidebar."
                        }));
                        continue;
                    }
                }
            } else { None };
            let result = match name {
                "search_marketplace" => {
                    activities.push(format!("Searching {} sources", args["project_type"].as_str().unwrap_or("marketplace")));
                    let _ = app.emit("ai-activity", activities.last().unwrap());
                    let server = server.as_ref().unwrap();
                    let found = search_marketplace(args["query"].as_str().unwrap_or(""), &server.minecraft_version, 0, args["project_type"].as_str()).await?;
                    sources = found.iter().take(8).map(|item| serde_json::to_value(item).unwrap_or_default()).collect();
                    serde_json::to_value(found).map_err(|e| e.to_string())?
                }
                "install_marketplace" => {
                    if !install_authorized { return Err("Installation requires explicit user intent".into()); }
                    let server = server.as_ref().unwrap();
                    let project_type = args["project_type"].as_str().ok_or("Missing project type")?;
                    if project_type == "mod" && !["fabric","forge","neoforge"].contains(&server.server_type.as_str()) { return Err("Mods require Fabric, Forge, or NeoForge".into()); }
                    if project_type == "plugin" && !["paper","purpur","velocity"].contains(&server.server_type.as_str()) { return Err("Plugins require Paper, Purpur, or Velocity".into()); }
                    let source = args["source"].as_str().ok_or("Missing source")?;
                    let id = args["project_id"].as_str().ok_or("Missing project ID")?;
                    let display = args["name"].as_str().ok_or("Missing name")?;
                    activities.push(format!("Installing {display}"));
                    let _ = app.emit("ai-activity", activities.last().unwrap());
                    let download = resolve_download(source, id, &server.minecraft_version, None, project_type, &server.server_type).await?;
                    install_plugin(&app, &format!("{source}:{id}"), display, &server.install_path, download, None, project_type).await?;
                    serde_json::json!({"installed":true,"name":display})
                }
                "create_server" => {
                    if !create_authorized { return Err("Server creation requires explicit user intent and EULA acceptance".into()); }
                    let (id, name) = create_server_from_args(&app, &args).await?;
                    created_server_id = Some(id);
                    activities.push(format!("Created server {name}"));
                    let _ = app.emit("ai-activity", activities.last().unwrap());
                    serde_json::json!({"created":true,"server_id":id,"name":name})
                }
                _ => return Err("Model requested an unavailable tool".into()),
            };
            conversation.push(serde_json::json!({"role":"tool","tool_call_id":call_id,"content":result.to_string()}));
        }
    }
    Err("AI stopped after too many tool calls".into())
}

#[tauri::command]
pub fn get_ai_logo() -> Result<String, String> {
    let dev_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/logo.txt");
    std::fs::read_to_string(dev_path)
        .or_else(|_| std::fs::read_to_string("src-tauri/src/logo.txt"))
        .or_else(|_| std::fs::read_to_string("src/logo.txt"))
        .or_else(|_| Ok(include_str!("logo.txt").to_string()))
        .map_err(|e: std::io::Error| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{complete_setup_submission, infer_server_name, inline_tool, latest_setup_submission, parse_aws_credentials, tool_arguments, user_authorized, wants_server_creation, AwsAuth, ChatMessage};

    #[test]
    fn binds_mutations_to_user_intent() {
        let install = vec![ChatMessage { role: "user".into(), content: "Install Spark".into() }];
        assert!(user_authorized(&install, "install"));
        assert!(!user_authorized(&install, "create"));
        let create = vec![ChatMessage { role: "user".into(), content: "Create server\neula_accepted: true".into() }];
        assert!(user_authorized(&create, "create"));
    }

    #[test]
    fn parses_inline_tool_from_free_models() {
        let (_, args) = inline_tool(r#"<ask_user>{"title":"Server","fields":[{"name":"server_name","label":"Name","type":"text"}]}</ask_user>"#).unwrap();
        assert_eq!(args["title"], "Server");
        assert_eq!(args["fields"][0]["name"], "server_name");
    }

    #[test]
    fn detects_server_creation_request() {
        assert!(wants_server_creation(&[ChatMessage { role: "user".into(), content: "Set up a new survival server".into() }]));
    }

    #[test]
    fn accepts_string_and_object_tool_arguments() {
        assert_eq!(tool_arguments(&serde_json::json!(r#"{"query":"spark"}"#)).unwrap()["query"], "spark");
        assert_eq!(tool_arguments(&serde_json::json!({"query":"spark"})).unwrap()["query"], "spark");
        assert!(tool_arguments(&serde_json::json!("{broken")).is_none());
    }

    #[test]
    fn parses_aws_auth_modes() {
        assert!(matches!(parse_aws_credentials("").unwrap(), AwsAuth::DefaultChain));
        assert!(matches!(
            parse_aws_credentials("AKIA123:secret").unwrap(),
            AwsAuth::StaticCredentials { .. }
        ));
        assert!(matches!(
            parse_aws_credentials("bedrock_api_key_value").unwrap(),
            AwsAuth::BedrockApiKey(_)
        ));
    }

    #[test]
    fn infers_server_name_from_called_phrase() {
        let messages = vec![ChatMessage {
            role: "user".into(),
            content: r#"Create me a server called "Skypixel" with the skyblock modpack"#.into(),
        }];
        assert_eq!(infer_server_name(&messages).as_deref(), Some("Skypixel"));
    }

    #[test]
    fn parses_structured_setup_submission() {
        let messages = vec![ChatMessage {
            role: "user".into(),
            content: "New server setup:\nserver_name: Skypixel\nminecraft_version: 1.21.1\nserver_type: paper\nram_min_mb: 1024\nram_max_mb: 4096\nport: 25565\neula_accepted: true".into(),
        }];
        let args = latest_setup_submission(&messages).unwrap();
        assert_eq!(args["server_name"], "Skypixel");
        assert_eq!(args["port"], 25565);
        assert_eq!(args["eula_accepted"], true);
        assert!(complete_setup_submission(&args));
    }
}
