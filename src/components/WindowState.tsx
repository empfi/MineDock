import { useEffect } from 'react';
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';

const KEY = 'minedock-window-state';

export default function WindowState() {
  useEffect(() => {
    const window = getCurrentWindow();
    const saved = localStorage.getItem(KEY);
    if (saved) {
      const state = JSON.parse(saved) as { x: number; y: number; width: number; height: number; maximized: boolean };
      window.setPosition(new PhysicalPosition(state.x, state.y))
        .then(() => window.setSize(new PhysicalSize(state.width, state.height)))
        .then(() => state.maximized ? window.maximize() : undefined)
        .catch(console.error);
    }

    const save = async () => {
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
    };

    const listeners = Promise.all([window.onMoved(save), window.onResized(save)]);
    return () => { listeners.then(unlisten => unlisten.forEach(remove => remove())); };
  }, []);
  return null;
}
