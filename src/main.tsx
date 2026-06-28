import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

document.addEventListener("contextmenu", event => event.preventDefault());
document.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();
  if (event.ctrlKey && key === "f") {
    event.preventDefault();
    window.dispatchEvent(new Event("minedock-find"));
  }
  if (
    event.key === "F12" ||
    (event.ctrlKey && ["r", "p", "s", "u"].includes(key)) ||
    (event.ctrlKey && event.shiftKey && ["i", "j", "c"].includes(key)) ||
    (event.altKey && ["arrowleft", "arrowright"].includes(key))
  ) {
    event.preventDefault();
  }
});

import { getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";

async function renderApp() {
  const win = getCurrentWindow();
  const saved = localStorage.getItem("minedock-window-state");
  
  if (saved) {
    try {
      const state = JSON.parse(saved);
      // Safety check: ignore coordinates if offscreen (e.g. minimized state on Windows)
      const isValid = 
        typeof state.x === 'number' && state.x > -10000 &&
        typeof state.y === 'number' && state.y > -10000 &&
        typeof state.width === 'number' && state.width > 200 &&
        typeof state.height === 'number' && state.height > 200;

      if (isValid) {
        win.setPosition(new PhysicalPosition(state.x, state.y))
          .then(() => win.setSize(new PhysicalSize(state.width, state.height)))
          .then(() => state.maximized ? win.maximize() : undefined)
          .catch(err => console.error("Failed to position window:", err))
          .finally(() => {
            win.show().catch(err => console.error("Failed to show window:", err));
          });
      } else {
        localStorage.removeItem("minedock-window-state"); // Clear corrupted state
        win.show().catch(err => console.error("Failed to show window:", err));
      }
    } catch (e) {
      console.error("Failed to parse window state:", e);
      win.show().catch(err => console.error("Failed to show window:", err));
    }
  } else {
    win.show().catch(err => console.error("Failed to show window:", err));
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

renderApp();
