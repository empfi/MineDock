import { create } from 'zustand';
import { Server, AppSettings, ConsoleLogEntry } from './types';
import { invoke } from '@tauri-apps/api/core';

const CACHE_KEY = 'minedock-console-cache';
let nextLogId = 0;

function loadConsoleLogs(): Record<number, ConsoleLogEntry[]> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
  catch { return {}; }
}

function cacheConsoleLogs(logs: Record<number, ConsoleLogEntry[]>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(logs)); }
  catch (error) { console.warn('Console cache is full:', error); }
}

interface AppState {
  servers: Server[];
  selectedServerId: number | null;
  settings: AppSettings | null;
  consoleLogs: Record<number, ConsoleLogEntry[]>;
  backupJobs: Record<number, string | undefined>;
  backupRevision: Record<number, number>;
  fetchServers: () => Promise<void>;
  fetchSettings: () => Promise<void>;
  setSelectedServer: (id: number | null) => void;
  updateServerStatus: (id: number, status: string) => void;
  appendConsoleLog: (id: number, text: string, isError: boolean) => void;
  clearConsoleLogs: (id: number) => void;
  createBackup: (id: number, path: string) => Promise<void>;
  restoreBackup: (id: number, path: string, name: string) => Promise<void>;
  deleteBackup: (id: number, path: string, name: string) => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  servers: [],
  selectedServerId: null,
  settings: null,
  consoleLogs: loadConsoleLogs(),
  backupJobs: {},
  backupRevision: {},

  fetchServers: async () => {
    try {
      const servers = await invoke<Server[]>('fetch_servers');
      set({ servers });
      if (!get().selectedServerId && servers[0]?.id) set({ selectedServerId: servers[0].id });
    } catch (error) { console.error('Failed to fetch servers:', error); }
  },

  fetchSettings: async () => {
    try { set({ settings: await invoke<AppSettings>('fetch_settings') }); }
    catch (error) { console.error('Failed to fetch settings:', error); }
  },

  setSelectedServer: (id) => set({ selectedServerId: id }),
  updateServerStatus: (id, status) => set((state) => ({
    servers: state.servers.map((server) => server.id === id ? { ...server, status } : server)
  })),

  appendConsoleLog: (id, text, isError) => set((state) => {
    const consoleLogs = {
      ...state.consoleLogs,
      [id]: [...(state.consoleLogs[id] || []), {
        id: Date.now() * 1000 + nextLogId++, text, isError,
        timestamp: new Date().toLocaleTimeString(),
      }].slice(-1000),
    };
    cacheConsoleLogs(consoleLogs);
    return { consoleLogs };
  }),

  clearConsoleLogs: (id) => set((state) => {
    const consoleLogs = { ...state.consoleLogs, [id]: [] };
    cacheConsoleLogs(consoleLogs);
    return { consoleLogs };
  }),

  createBackup: async (id, path) => {
    set((state) => ({ backupJobs: { ...state.backupJobs, [id]: 'Creating backup...' } }));
    try {
      const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await invoke('create_mc_backup', { serverPath: path, backupName: name });
    } finally {
      set((state) => ({
        backupJobs: { ...state.backupJobs, [id]: undefined },
        backupRevision: { ...state.backupRevision, [id]: (state.backupRevision[id] || 0) + 1 },
      }));
    }
  },

  restoreBackup: async (id, path, name) => {
    set((state) => ({ backupJobs: { ...state.backupJobs, [id]: 'Restoring backup...' } }));
    try { await invoke('restore_mc_backup', { serverPath: path, backupName: name }); }
    finally { set((state) => ({ backupJobs: { ...state.backupJobs, [id]: undefined } })); }
  },

  deleteBackup: async (id, path, name) => {
    set((state) => ({ backupJobs: { ...state.backupJobs, [id]: 'Deleting backup...' } }));
    try { await invoke('remove_mc_backup', { serverPath: path, backupName: name }); }
    finally {
      set((state) => ({
        backupJobs: { ...state.backupJobs, [id]: undefined },
        backupRevision: { ...state.backupRevision, [id]: (state.backupRevision[id] || 0) + 1 },
      }));
    }
  },
}));