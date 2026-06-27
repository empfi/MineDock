# MineDock

MineDock is a modern, lightweight Minecraft server manager inspired by panels like Pterodactyl and Pelican, but built entirely as a **local desktop application for Windows**.

With MineDock, you can create, download, configure, start, stop, and manage real Minecraft Java Edition servers locally on your machine without relying on external clouds or paid APIs. It features a modern, dark, minimal interface designed for a professional server-hosting experience right on your desktop.

---

### Features

- **Multiple Local Servers**: Manage multiple Minecraft server instances locally.
- **Server Creation Wizard**: A guided setup for naming, configuring RAM, ports, and accepting the EULA.
- **Version Downloader**: Automatically fetches available Vanilla Minecraft versions using Mojang's official API, and downloads the correct server `.jar` seamlessly.
- **Process Management**: A robust backend written in Rust spawns and tracks your Minecraft servers independently. You can view real-time live console output (stdout/stderr) and issue commands directly.
- **File Manager**: Browse, edit, create, and delete server files through a secure, built-in visual file manager.
- **Visual Properties Editor**: An intuitive interface for tweaking `server.properties` alongside a raw configuration editor.
- **Backups**: Compress and restore entire server directories into `.zip` archives.
- **Log Viewer**: View `latest.log` instantly inside the application.
- **Database Driven**: Uses SQLite to persist servers and application settings locally.

---

### Tech Stack

- **Frontend**: React (TypeScript), Tailwind CSS, Zustand, React Router, Vite
- **Backend / Desktop**: Tauri v2, Rust (Tokio, reqwest, rusqlite, zip, sysinfo)
- **Database**: SQLite (via `rusqlite`)

---

### Windows Requirements

To run MineDock successfully on Windows, you must have:

- **Java**: You need to have Java installed on your system. 
  - Minecraft 1.20.5 and newer typically require **Java 21**. 
  - Older modern versions often need Java 17.
  - *Recommendation*: Install Eclipse Temurin / Adoptium Java 21 from [here](https://adoptium.net/temurin/releases/). Ensure you check "Add to PATH" during installation.

---

### Setup and Build Instructions

If you wish to develop or build MineDock from source, ensure you have installed:
- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (latest stable)
- Build tools (Visual Studio C++ Build Tools for Windows)

**1. Clone the repository and install dependencies:**
```bash
git clone <repository_url>
cd minedock
npm install
```

**2. Run in Development Mode:**
This will start both the React frontend (Vite) and the Tauri Rust backend.
```bash
npm run tauri dev
```

**3. Build the Application:**
This compiles the Typescript and builds a production-ready Windows executable.
```bash
npm run tauri build
```
The compiled executable will be located in `src-tauri/target/release/`.

---

### How Features Work

#### Server Creation & EULA
The creation wizard interacts with the Rust backend to dynamically fetch versions, create the server directory, download the jar, and write `eula.txt`. Mojang requires all server operators to accept their EULA before a server can boot; MineDock enforces this agreement explicitly in the UI via the wizard.

#### Version Downloading
MineDock queries the official Mojang version manifest (`piston-meta.mojang.com/mc/game/version_manifest_v2.json`) to populate the version list. Upon selecting a version, the backend locates the correct download URL for the server jar and streams it to the disk while providing progress updates to the frontend via Tauri events.

#### Process Management
MineDock spawns Minecraft using `tokio::process::Command` in the Rust backend. It captures `stdout` and `stderr` pipes, forwarding the live lines to the React frontend. It retains a reference to the `stdin` handle, allowing you to send commands to the console gracefully. It avoids unsafe shell string interpolation.

---

### Known Limitations

- **Java Only**: Currently designed specifically for Minecraft Java Edition. Bedrock is not supported in v1.
- **Vanilla Only**: The automated downloader only fetches Vanilla jars from Mojang.
- **Platform Support**: Built and tested primarily for Windows, though Tauri is cross-platform. 
- **Resource Monitoring**: Advanced CPU/RAM graphing per process is not fully implemented; it currently displays system totals and allocated limits.

---

### Future Roadmap

- [ ] **Paper/Purpur Support**: Add automatic downloading and management of optimized server forks.
- [ ] **Plugin Marketplace**: Browse and install Spigot/Paper plugins directly from the UI.
- [ ] **Scheduled Backups**: Set up cron-like schedules for automated world backups.
- [ ] **Per-Server Resource Graphs**: Granular monitoring of CPU and RAM usage for specific server processes.
- [ ] **Docker/Linux Support**: Run instances inside Docker containers for isolation (pterodactyl-style).
- [ ] **Remote Node Support**: Connect the desktop app to a remote daemon to manage off-site servers.
- [ ] **Auto Java Installer**: Automatically detect missing Java dependencies and offer to download and extract them locally.
