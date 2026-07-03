# MineDock implementation plans

Planned against commit `4cad8b8` on 2026-07-01. The working tree already contained uncommitted product changes when these plans were written; executors must run both drift checks and compare current excerpts before editing.

| Plan | Outcome | Priority | Effort | Depends on | Status |
|---|---|---:|---:|---|---|
| [001](001-finish-core-ux-workflows.md) | Complete error, draft, loading, validation, list, terminology, and command-palette UX | P1 | L | — | IN PROGRESS |
| [002](002-ai-server-setup-assistant.md) | Add optional AI-guided server setup with constrained tool calls | P2 | L | 001 | TODO |

## Recommended order

1. Execute 001 first. It establishes reusable field errors, actionable errors, loading states, navigation protection, and consistent “server” vocabulary.
2. Execute 002 after 001. The AI assistant must reuse those primitives for validation, confirmation, progress, errors, and unsaved-plan protection.

## Product decisions

- “Server” is the only user-facing term. Do not use “host”.
- Async refreshes retain existing content; first load uses layout-matched skeletons.
- Errors remain near the failed surface and expose a recovery action. Toasts may supplement but not replace them.
- AI is optional. MineDock remains fully usable without an API key or network access.
- AI never receives arbitrary shell or unrestricted filesystem tools.
- AI proposes a complete setup plan before any mutation. Each mutating tool requires explicit user approval.

## Verification baseline

```powershell
npm.cmd run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: both exit `0`; current Rust baseline is 17 passing tests.

## Findings considered and rejected

- Autonomous AI applying changes without confirmation: rejected because server creation downloads binaries, writes files, accepts the EULA, and can overwrite existing configuration.
- General-purpose shell tool for AI: rejected because MineDock already exposes bounded Rust commands for every required setup operation.
- Replacing all page-local state with a new form or query library: rejected; existing React state and Zustand are sufficient.
