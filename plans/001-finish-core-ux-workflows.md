# Plan 001: Finish MineDock core UX workflows

> **Executor instructions**: Follow each step in order. Run every verification gate. If a STOP condition occurs, stop and report instead of improvising. When complete, update this plan’s row in `plans/README.md`.
>
> **Drift check (run first)**:
>
> ```powershell
> git diff --stat 4cad8b8..HEAD -- src
> git diff --stat -- src
> ```
>
> The second command is mandatory because this plan was written from a dirty working tree. Compare live symbols and behavior with “Current state” before editing.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED — shared navigation and form behavior can block legitimate actions if dirty/error states are wrong
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `4cad8b8`, 2026-07-01

## Why this matters

MineDock has functional workflows but inconsistent failure recovery, loading transitions, validation placement, terminology, and list controls. Users can lose edits when switching pages or servers, many failures only appear in transient notifications, and several lists cannot be sorted or filtered. This plan completes those UX foundations without changing server-management behavior or adding a new UI framework.

## Current state

- `src/components/Notifications.tsx:33` exports `notify()`. Many operations report errors only through this transient channel.
- `src/components/EmptyState.tsx:11` provides the current visual empty-state pattern.
- `src/components/UnsavedChangesBar.tsx:12` exposes save/reset UI, but it does not block route, server-tab, or window-close navigation.
- `src/components/CommandPalette.tsx:7-70` supports filtering, click selection, Escape, and Enter on the first result. It lacks arrow selection, grouping, recent commands, and server actions.
- `src/components/AppRoutes.tsx:39` centralizes the “server required” state and is the correct place to preserve consistent route-level behavior.
- `src/pages/Settings.tsx:40-48` computes dirty state and validation errors, but errors are rendered as one page-level banner rather than next to fields.
- `src/pages/Properties.tsx:204` computes dirty state independently.
- `src/pages/Files.tsx:53-116` owns load/error state and already preserves file search state locally.
- `src/pages/Additions.tsx:152-166` prevents stale marketplace requests with a request ID; retain this pattern.
- Empty/list states remain bespoke at `src/pages/Logs.tsx:168`, `src/pages/Worlds.tsx:299`, `src/pages/Servers.tsx:347`, and `src/pages/Additions.tsx:328`.
- User-facing copy mixes “host” and “server”, especially in `src/App.tsx`, `src/pages/Additions.tsx`, and notifications.
- Existing visual language: `#0f0f11` page background, `#1c1d21` surfaces, `#2a2b2f` borders, blue primary actions, Lucide icons, rounded-md/rounded-lg geometry. Preserve it.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Type/build | `npm.cmd run build` | exit 0 |
| Rust regression | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0; all tests pass |
| Copy audit | `rg -n -i "\\bhost(s|ing)?\\b" src --glob "*.tsx" --glob "*.ts"` | no user-facing “host”; internal protocol names may remain |
| Dirty-state audit | `rg -n "useUnsavedChanges|UnsavedChangesBar" src/pages src/components` | Files, Properties, Settings, and Wizard are covered |

## Scope

**In scope**

- `src/App.tsx`
- `src/store.ts`
- `src/styles.css`
- `src/components/AppRoutes.tsx`
- `src/components/CommandPalette.tsx`
- `src/components/EmptyState.tsx`
- `src/components/Notifications.tsx`
- `src/components/ProgressHub.tsx`
- `src/components/UnsavedChangesBar.tsx`
- New focused components/hooks under `src/components/` and `src/lib/`
- `src/pages/*.tsx` where needed for the seven requested UX changes

**Out of scope**

- Rust command behavior and database schema
- New server-management features
- Authentication
- Replacing React Router, Zustand, Tailwind, or Monaco
- Visual redesign outside existing MineDock styles
- AI assistant; handled by Plan 002

## Implementation steps

### 1. Add shared actionable error state

Create `src/components/ErrorState.tsx` using the same dimensions and tokens as `EmptyState`. Required props:

- `title`
- `description`
- optional `primaryAction: { label, onClick }`
- optional `secondaryAction`
- optional compact mode for inline page sections

Do not parse raw errors inside the component. Page code maps known failures to plain language and actions. Retain technical detail behind a collapsible “Details” affordance with selectable text.

Adopt it first in:

- Logs: retry `loadLogs`
- Files: retry current directory load
- Additions: retry search/update check
- Backups: retry list load
- Versions: retry version manifest load
- Wizard: return to failed step and retry

Toasts may still record failure history, but a failed primary load must remain visible until retry or success.

**Verification**

```powershell
rg -n "ErrorState" src/pages
npm.cmd run build
```

Expected: at least six page integrations; build exits 0.

### 2. Add one unsaved-change registry and navigation guard

Create a small Zustand-backed or module-local registry in `src/lib/unsavedChanges.ts`; do not add a dependency. It must support:

- register/update `{ id, label, dirty, saving, save?, reset? }`
- query whether any surface is dirty
- remove registration on unmount
- request navigation with destination callback

Create `useUnsavedChanges()` hook and one confirmation dialog mounted in `App.tsx`. Protect:

- React Router navigation
- sidebar links
- command-palette navigation
- server-tab selection and close
- leaving a server
- Tauri window close

Apply registration to:

- `Settings.tsx`
- `Properties.tsx`
- `Files.tsx` while an editor buffer differs from original
- `Wizard.tsx` after meaningful input exists

Dialog actions: `Stay`, `Discard and continue`, and `Save and continue` only when the active surface supplies a save callback. Never discard automatically.

**Verification**

Manual:

1. Edit Properties, then click Logs: dialog appears.
2. Choose Stay: remains on Properties with edits intact.
3. Choose Discard: navigation completes.
4. Edit a file, click another server tab: dialog appears.
5. Close MineDock with dirty Settings: dialog appears.

Then run:

```powershell
npm.cmd run build
```

Expected: exit 0.

### 3. Complete command-palette keyboard behavior

Extend `CommandPalette.tsx` without adding a command library:

- keep an integer active index
- ArrowDown/ArrowUp wrap through results
- Enter runs active item
- Home/End jump
- Escape closes and restores focus to the opener
- active row uses `aria-selected`, `role="option"`, and scrolls into view
- results grouped as Actions, Pages, Servers
- remember the last five successful commands in localStorage
- include selected-server actions: Start, Stop, Restart, Open Console, Create Backup; reuse existing invoke/store behavior and status guards
- show disabled reason instead of hiding unavailable actions

Reset active index when query/result set changes. Do not run mutations from typed free-form text.

**Verification**

Manual keyboard-only test: open with Ctrl+K, traverse every result, run a page command, reopen, confirm recent result, run an allowed server action, close with Escape.

```powershell
npm.cmd run build
```

Expected: exit 0.

### 4. Standardize loading and refresh states

Create only two reusable primitives:

- `ListSkeleton` for table/list rows
- `InlineSpinner` for buttons/refresh labels

Rules:

- First load: use layout-matched skeleton.
- Background refresh: retain content and show a small refresh indicator.
- Mutation: retain row and disable only conflicting actions.
- Empty state appears only after a successful completed request.
- Error state is distinct from empty state.

Apply to Servers, Logs, Files, Worlds, Backups, Versions, Additions, Players, Settings, and Health. Keep button dimensions stable through `action-button`.

**Verification**

Throttle network and refresh Additions/Versions. Existing content must remain during refresh. Open empty server directories: empty state must not flash before loading completes.

```powershell
npm.cmd run build
```

Expected: exit 0.

### 5. Move validation beside fields

Create `src/components/FieldError.tsx`. Render a stable reserved error line and apply `aria-invalid` plus `aria-describedby`.

Validate as the user edits, but do not show untouched required-field errors until blur or submit. Cover:

- Settings: min/max RAM, relay address, relay token, server directory, Java path
- Properties profile: non-empty name, JAR filename, Java path, min RAM ≤ max RAM, max RAM ≤ system memory, valid port
- Wizard: name, path, port uniqueness/range, RAM, Java compatibility, EULA
- Servers import: name, port, detected JAR/version/type
- Worlds: safe folder name and dimension prerequisites
- Players: Minecraft username format

Remove duplicated page-level validation banners once every error has a field placement. Keep a compact summary only after submit if multiple fields fail; clicking an item focuses its field.

**Verification**

Keyboard-test every invalid field. Screen-reader attributes must reference existing IDs.

```powershell
rg -n "aria-invalid|FieldError" src/pages
npm.cmd run build
```

Expected: requested forms use shared field errors; build exits 0.

### 6. Add useful list controls

Use native React state and existing controls. Persist choices in localStorage by page.

- Servers: search, status filter, software filter, sort by name/status/recently started.
- Backups: search, sort by created/name/size.
- Worlds: search, sort by name/size/last modified if available; do not invent missing backend fields.
- Logs: search filenames, filter errors/warnings, sort newest/name.
- Versions: text search and release/snapshot filter; preserve current filter.
- Additions: preserve project type, query, and sort where source API supports it. Do not claim client-side global sorting across paginated remote results.

Each list shows result count and a one-click `Clear filters`. Filtered-empty copy differs from truly empty copy.

**Verification**

Reload each page after changing controls; choices persist. Clear filters restores full list.

```powershell
npm.cmd run build
```

Expected: exit 0.

### 7. Normalize user-facing terminology to “server”

Replace user-visible “host”, “hosting”, and “hosts” with “server”, “running”, or “servers”. Do not rename:

- network host variables
- URLs
- tunnel protocol fields
- internal API identifiers where “host” is technically correct

Update notifications, placeholders, headings, tooltips, command-palette copy, and progress labels.

**Verification**

```powershell
rg -n -i "\\bhost(s|ing)?\\b" src --glob "*.tsx" --glob "*.ts"
```

Expected: only technical/internal references remain; each remaining match is reviewed.

### 8. Add focused tests and complete regression pass

Use the lightest current-compatible test setup. If no frontend test runner exists, add Vitest plus React Testing Library only for:

- unsaved registry transition decisions
- command-palette keyboard index behavior
- validation pure functions
- list filtering/sorting pure functions

Keep logic as exported pure functions where that avoids DOM-heavy tests.

Run:

```powershell
npm.cmd run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: both exit 0.

## Done criteria

- Primary-load failures remain visible and offer retry/recovery.
- Dirty edits cannot be lost through routes, tabs, command palette, or window close without confirmation.
- Command palette is fully operable by keyboard.
- Refreshes preserve existing content; empty state never substitutes for loading/error.
- Requested forms show inline accessible validation.
- Major lists support useful persistent search/filter/sort controls.
- User-facing UI uses “server”.
- Editing/mutation buttons do not resize during progress.
- Frontend build and Rust tests pass.

## STOP conditions

- React Router version lacks a safe blocker API and window-close interception cannot defer closing: stop and report the exact API limitation before inventing unload hacks.
- A requested list sort needs data not returned by its backend command: omit only that sort and report the missing field.
- Existing uncommitted changes conflict with any current-state symbol: stop for that file and report the overlap.
- Frontend tests require replacing the build tool or adding an end-to-end browser stack: stop; keep pure tests only.

## Maintenance note

Future forms and editors must register dirty state through the shared hook. Future primary list loads must model four states separately: initial loading, content, error, and empty. Keep command definitions data-driven in one file so the palette and future AI assistant can share labels and permission checks without sharing execution authority.
