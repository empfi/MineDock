# MineDock

**MineDock** is a fast, clean, and local desktop app for creating and managing Minecraft servers.

No complex Docker setups, web panels, or messy batch files required—MineDock gives you a modern server panel directly on your desktop.

---

## ✨ Features

- **Instant Server Creation**: Download and launch Vanilla, Paper, Purpur, or Velocity servers with a few clicks.
- **Live Console & Control**: Real-time console logs, instant command execution, and player management (OP, kick, ban).
- **Built-in File Manager & Properties Editor**: Tweak `server.properties` visually or edit files directly inside the app.
- **Plugin Marketplace**: Search and install plugins from Modrinth and Hangar right from the interface.
- **Backup & Restore**: Easily create `.zip` backups of your worlds, verify archive integrity, and restore whenever needed.
- **DockAI Assistant**: Ask questions, search compatible plugins, or get help configuring your server.
- **Modern & Classic Themes**: Clean UI customization with smooth transitions and customizable theme settings.

---

## 🛠️ Requirements

To run Minecraft servers on your machine, you'll need **Java** installed:

- **Minecraft 1.20.5+**: Requires **Java 21** (Recommended: [Eclipse Temurin Java 21](https://adoptium.net/temurin/releases/)).
- **Older Versions**: Usually require **Java 17** or **Java 8**.

> *Tip: Make sure "Add to PATH" is checked during Java installation.*

---

## 🚀 Development & Building

If you'd like to build MineDock from source or contribute:

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (latest stable)

### Steps

1. **Clone the repository and install dependencies:**
   ```bash
   git clone https://github.com/empfi/MineDock.git
   cd MineDock
   npm install
   ```

2. **Run in Development Mode:**
   ```bash
   npm run tauri dev
   ```

3. **Build Desktop App:**
   ```bash
   npm run tauri build
   ```
   The compiled `.exe` will be generated in `src-tauri/target/release/`.

---

## 💻 Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS, Vite
- **Backend / Desktop**: Tauri v2, Rust (Tokio, Rusqlite, Sysinfo)
- **Database**: SQLite (local storage)

---

## 📄 License

Open-source under the MIT License. Feel free to use, modify, and share!

