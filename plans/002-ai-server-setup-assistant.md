# Plan 002: Add an optional AI server setup assistant with constrained tool calls

> **Executor instructions**: Execute only after Plan 001 is DONE. Run every verification gate. The assistant must never receive arbitrary shell, SQL, command-dispatch, or unrestricted filesystem tools. Stop on any condition listed below.
>
> **Drift check (run first)**:
>
> ```powershell
> git diff --stat 4cad8b8..HEAD -- src src-tauri package.json package-lock.json
> git diff --stat -- src src-tauri package.json package-lock.json
> ```

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH — AI suggestions can trigger downloads and filesystem mutations
- **Depends on**: `plans/001-finish-core-ux-workflows.md`
- **Category**: direction
- **Planned at**: commit `4cad8b8`, 2026-07-01

## Why this matters

Yes, MineDock can support a full conversational setup assistant. Existing Rust commands already cover version discovery, Java detection/installation, server software download, loader installation, properties writing, EULA acceptance, and server creation. The safe architecture is not “AI controls the app”; it is “AI proposes calls to a strict allowlist, MineDock validates them, shows a plan, and the user approves every mutation.”

OpenAI’s Responses API supports function tools described with JSON schemas and a multi-step tool-call loop. Use strict schemas and return tool results to the model; keep execution authority in MineDock’s Rust backend. Reference: [OpenAI function calling guide](https://developers.openai.com/api/docs/guides/function-calling) and [safety best practices](https://developers.openai.com/api/docs/guides/safety-best-practices).

## Product scope

The assistant’s v1 job:

1. Ask what server the user wants.
2. Inspect machine/server prerequisites through read-only tools.
3. Recommend software, Minecraft version, loader, Java, RAM, port, and additions.
4. Produce a complete reviewable setup plan.
5. Apply approved steps using existing bounded MineDock commands.
6. Stream progress through ProgressHub.
7. Stop on errors and offer retry/edit/rollback.

It is not a general Minecraft chatbot, shell, file editor, moderation bot, or autonomous administrator.

## Current state

- `src/pages/Wizard.tsx` is the existing deterministic setup flow and remains the non-AI fallback.
- `src/components/ProgressHub.tsx` already aggregates install and backup progress.
- `src/lib/safeApply.ts` already provides restore-point and rollback semantics for risky changes.
- `src-tauri/src/commands.rs` exposes bounded commands for Java, downloads, loaders, files, settings, backups, modpacks, and server creation.
- `src-tauri/src/lib.rs` owns the Tauri command allowlist.
- `reqwest` and `serde_json` are already Rust dependencies; use them instead of adding a frontend OpenAI SDK.
- No AI credential or provider settings exist.
- MineDock targets Windows first.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Frontend | `npm.cmd run build` | exit 0 |
| Backend | `cargo test --manifest-path src-tauri/Cargo.toml` | all pass |
| Secret scan | `rg -n "OPENAI_API_KEY|sk-" src src-tauri --glob "!*.test.*"` | no embedded key/value |
| Tool audit | `rg -n "shell|Command::new|std::process::Command" src-tauri/src/ai*` | no AI-controlled arbitrary command path |

## Scope

**In scope**

- New `src/pages/SetupAssistant.tsx`
- New focused UI components under `src/components/assistant/`
- `src/components/AppRoutes.tsx`
- `src/App.tsx` navigation/entry point
- `src/components/ProgressHub.tsx`
- New `src-tauri/src/ai.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml` and lockfile only for OS credential storage if required
- `src-tauri/src/commands.rs` only for thin reuse wrappers where existing functions are inaccessible
- Tests adjacent to AI backend/frontend pure logic

**Out of scope**

- General shell or arbitrary command execution
- Arbitrary filesystem read/write
- Silent EULA acceptance
- Automatic server deletion, backup deletion, world deletion, downgrade, or overwrite
- Sending console logs, file contents, player data, tunnel tokens, paths, or API keys unless the user explicitly chooses the relevant diagnostic context
- Background autonomous runs
- Voice, image input, web search, RAG, MCP, or multi-agent orchestration
- Replacing the deterministic Wizard

## Architecture

### Trust boundary

- React displays chat, plan, approvals, and progress.
- Rust owns credentials, API requests, tool schemas, argument validation, permission classification, and execution.
- The model returns tool-call proposals only.
- Rust validates every argument again. Never dispatch by arbitrary Tauri command name.

### Credential handling

- Add an AI settings section with `Connect OpenAI`, model choice, and `Forget key`.
- Store API key in Windows Credential Manager through a maintained Rust keyring crate. Never place it in SQLite, localStorage, logs, frontend state after submission, or model context.
- If credential storage cannot be made reliable in the supported Windows build, use session-only memory and clearly label it; do not fall back to plaintext persistence.

### Tool classes

Read-only tools can run immediately:

- `inspect_system`: memory, OS, available disk
- `detect_java`: available paths and majors
- `list_server_software`
- `list_minecraft_versions`
- `check_port`
- `inspect_existing_directory` with user-selected path only
- `search_compatible_additions`

Mutating tools require a visible approval card:

- `install_managed_java`
- `create_server_directory`
- `download_server_software`
- `install_mod_loader`
- `write_server_properties`
- `accept_minecraft_eula`
- `create_server_profile`
- `install_addition`
- `create_restore_point`

Each schema uses `additionalProperties: false`, explicit enums, bounded integers, and required fields. The backend maps each tool name with an exhaustive Rust `match`.

## Implementation steps

### 1. Build and test the backend tool registry

Create `src-tauri/src/ai.rs` with:

- `AiToolDefinition`
- `AiToolCall`
- `AiToolRisk::{ReadOnly, Mutating, Destructive}`
- a static schema list
- `validate_tool_call`
- `execute_read_only_tool`
- `execute_approved_tool`

No string-based invoke bridge. Call existing Rust functions directly or expose narrow shared helpers.

Add unit tests for:

- unknown tool rejection
- extra argument rejection
- invalid server type/version/port/RAM rejection
- path outside user-selected root rejection
- mutating tool rejected without approval token
- approval token bound to exact tool name and canonicalized arguments

**Verification**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml ai
```

Expected: all AI registry tests pass.

### 2. Add Responses API tool loop in Rust

Use `reqwest` to call `POST /v1/responses`. Do not add a frontend SDK. Implement:

1. Send system instructions, minimal conversation context, and strict tool schemas.
2. Parse text and function-call output items.
3. Execute read-only calls.
4. Return function outputs to the next response.
5. Pause and emit an approval request for mutation.
6. After approval, execute the exact validated call and continue.
7. Cap each turn at 12 tool calls and 3 retries.
8. Support cancellation and request timeout.

Default model must be configurable rather than hardcoded throughout the code. Select one current function-calling model in one Rust constant and expose it in settings.

Never log request headers, API key, full prompts, or tool outputs containing local paths.

**Verification**

Use a mocked HTTP server in Rust tests. Cover text-only response, one read tool, mutation pause, multi-tool response, malformed arguments, API error, timeout, and cancellation.

### 3. Build plan-then-apply UI

Add Setup Assistant as a secondary action beside deterministic Create Server.

UI states:

- disconnected credential setup
- conversation
- gathering requirements
- proposed plan
- awaiting approval
- applying with step progress
- completed
- failed with retry/edit/rollback

The proposed plan must show exact:

- server name/path
- Minecraft/software/loader versions
- Java source/version
- RAM and port
- EULA acceptance
- additions
- files to create/change
- estimated downloads

Buttons: `Edit plan`, `Approve next step`, `Approve all safe setup steps`, `Cancel`. “Approve all” excludes destructive/overwrite actions and expires if any argument changes.

Reuse Plan 001 actionable errors, inline validation, unsaved protection, loading primitives, and server terminology.

### 4. Connect progress and rollback

- Emit each approved tool’s stages to ProgressHub.
- Create restore point before modifying an existing directory.
- Record completed steps locally for the active run.
- Retry only idempotent/read/download steps.
- On failure, show completed, failed, and pending steps.
- Offer rollback only when a restore point exists.
- Never claim rollback succeeded until the existing backend confirms it.

### 5. Add privacy and safety controls

Before first use, show:

- what data is sent
- that paths and secrets are excluded
- that AI can make mistakes
- that mutations need approval
- API usage may incur cost

Add `Copy diagnostic context` preview so the user can inspect optional logs before sending. Redact tunnel tokens and credential-like strings.

### 6. Evaluate setup quality

Create deterministic fixtures for at least:

- Paper 1.21 server, Java missing
- Fabric server with compatible loader
- Forge server requiring different Java
- port conflict
- insufficient RAM
- existing non-empty directory
- unsupported modpack/server-type request
- ambiguous request
- model proposes unknown tool
- model proposes unsafe path

Tests assert tool calls and approval boundaries, not exact prose.

Run full verification:

```powershell
npm.cmd run build
cargo test --manifest-path src-tauri/Cargo.toml
rg -n "OPENAI_API_KEY|sk-" src src-tauri --glob "!*.test.*"
```

Expected: builds/tests pass; no embedded secret.

## Done criteria

- MineDock works unchanged without AI configured.
- User can describe a server and receive a complete setup plan.
- Read-only inspection can run without mutation approval.
- Every mutation is schema-validated and explicitly approved.
- No arbitrary shell/filesystem/database tool exists.
- API key never reaches React or plaintext persistence.
- Progress, cancellation, errors, retry, and rollback are visible.
- Deterministic Wizard remains available.
- Tool-loop and safety fixtures pass.

## STOP conditions

- Product owner requests autonomous mutation without approvals: stop; do not weaken boundary.
- API key cannot be kept out of React/plaintext storage: stop.
- Existing Rust functions require unrestricted shell text or arbitrary paths: refactor into bounded helpers before exposing; do not wrap unsafe behavior.
- OpenAI Responses API schema differs from current official documentation: stop and refresh official docs before coding.
- Tool arguments cannot be represented with strict JSON schemas: remove that tool from v1.
- Supporting another provider would require a provider abstraction before one provider works: defer it; ship one provider first.

## Maintenance note

Treat tool schemas as a public security boundary. Any new tool requires risk classification, strict schema, backend validation, approval policy, tests, privacy review, and a UI description. Model output is untrusted input even when it came from a successful API call.
