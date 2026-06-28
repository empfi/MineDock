import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

const KEY = 'minedock-window-state';

export default function WindowState() {
  useEffect(() => {
    const window = getCurrentWindow();
    // Window restoration is now handled in main.tsx before React mounts

    const save = async () => {
      try {
        const minimized = await window.isMinimized();
        if (minimized) return; // Do not save state if minimized (positions are offscreen on Windows)

        const maximized = await window.isMaximized();
        const previous = JSON.parse(localStorage.getItem(KEY) || '{}');
        const position = maximized ? previous : await window.outerPosition();
        const size = maximized ? previous : await window.outerSize();
        localStorage.setItem(KEY, JSON.stringify({
          x: position.x ?? 0,
          y: position.y ?? 0,
          width: size.width ?? 800,
          height: size.height ?? 600,
          maximized,
        }));
      } catch (err) {
        console.error("Failed to save window state:", err);
      }
    };

    const listeners = Promise.all([window.onMoved(save), window.onResized(save)]);
    return () => { listeners.then(unlisten => unlisten.forEach(remove => remove())); };
  }, []);
  return null;
}
