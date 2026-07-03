import { create } from 'zustand';
import { Server, AppSettings, ConsoleLogEntry } from './types';
import { invoke } from '@tauri-apps/api/core';

const CACHE_KEY = 'minedock-console-cache';
const TABS_KEY = 'minedock-server-tabs';
let nextLogId = 0;

function loadConsoleLogs(): Record<number, ConsoleLogEntry[]> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
  catch { return {}; }
}

function cacheConsoleLogs(logs: Record<number, ConsoleLogEntry[]>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(logs)); }
  catch (error) { console.warn('Console cache is full:', error); }
}

export interface PerformanceTick {
  cpu: number;
  memory: number;
  timestamp: string;
}

interface AppState {
  servers: Server[];
  selectedServerId: number | null;
  openServerIds: number[];
  settings: AppSettings | null;
  consoleLogs: Record<number, ConsoleLogEntry[]>;
  backupJobs: Record<number, string | undefined>;
  backupRevision: Record<number, number>;
  fetchServers: () => Promise<void>;
  fetchSettings: () => Promise<void>;
  setSelectedServer: (id: number | null) => void;
  closeServerTab: (id: number) => void;
  moveServerTab: (from: number, to: number) => void;
  updateServerStatus: (id: number, status: string) => void;
  appendConsoleLog: (id: number, text: string, isError: boolean) => void;
  clearConsoleLogs: (id: number) => void;
  createBackup: (id: number, path: string, customName?: string) => Promise<void>;
  restoreBackup: (id: number, path: string, name: string) => Promise<void>;
  deleteBackup: (id: number, path: string, name: string) => Promise<void>;
  versionsCache: Record<string, string[]>;
  getSoftwareVersionsCached: (serverType: string) => Promise<string[]>;
  clearVersionsCache: () => void;
  serverStats: Record<number, PerformanceTick[]>;
  onlinePlayers: Record<number, string[]>;
  playerHistory: Record<number, { player: string; action: 'joined' | 'left'; timestamp: string }[]>;
  addServerStats: (id: number, cpu: number, memory: number) => void;
  addOnlinePlayer: (id: number, player: string) => void;
  removeOnlinePlayer: (id: number, player: string) => void;
  clearOnlinePlayers: (id: number) => void;
}

export const useStore = create<AppState>((set, get) => ({
  servers: [],
  selectedServerId: (() => {
    const saved = localStorage.getItem('minedock-selected-server-id');
    return saved ? Number(saved) : null;
  })(),
  openServerIds: JSON.parse(localStorage.getItem(TABS_KEY) || '[]'),
  settings: null,
  consoleLogs: loadConsoleLogs(),
  backupJobs: {},
  backupRevision: {},
  versionsCache: {},
  serverStats: {},
  onlinePlayers: {},
  playerHistory: {},

  addServerStats: (id, cpu, memory) => set((state) => {
    const ticks = state.serverStats[id] || [];
    const newTick = {
      cpu,
      memory,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    return {
      serverStats: {
        ...state.serverStats,
        [id]: [...ticks, newTick].slice(-30), // keep last 30 ticks (1 minute)
      }
    };
  }),

  addOnlinePlayer: (id, player) => set((state) => {
    const list = state.onlinePlayers[id] || [];
    if (list.includes(player)) return {};
    return {
      onlinePlayers: {
        ...state.onlinePlayers,
        [id]: [...list, player],
      },
      playerHistory: {
        ...state.playerHistory,
        [id]: [...(state.playerHistory[id] || []), { player, action: 'joined' as const, timestamp: new Date().toLocaleTimeString() }].slice(-20),
      },
    };
  }),

  removeOnlinePlayer: (id, player) => set((state) => {
    const list = state.onlinePlayers[id] || [];
    return {
      onlinePlayers: {
        ...state.onlinePlayers,
        [id]: list.filter(p => p !== player),
      },
      playerHistory: {
        ...state.playerHistory,
        [id]: [...(state.playerHistory[id] || []), { player, action: 'left' as const, timestamp: new Date().toLocaleTimeString() }].slice(-20),
      },
    };
  }),

  clearOnlinePlayers: (id) => set((state) => ({
    onlinePlayers: {
      ...state.onlinePlayers,
      [id]: [],
    }
  })),

  getSoftwareVersionsCached: async (serverType: string) => {
    const cached = get().versionsCache[serverType];
    if (cached) return cached;
    const data = await invoke<string[]>('get_software_versions', { serverType });
    set((state) => ({
      versionsCache: { ...state.versionsCache, [serverType]: data }
    }));
    return data;
  },

  clearVersionsCache: () => set({ versionsCache: {} }),

  fetchServers: async () => {
    try {
      const servers = await invoke<Server[]>('fetch_servers');
      set({ servers });
      const currentSelected = get().selectedServerId;
      if (currentSelected && !servers.some(s => s.id === currentSelected)) {
        const nextId = servers[0]?.id ?? null;
        set({ selectedServerId: nextId });
        if (nextId) localStorage.setItem('minedock-selected-server-id', String(nextId));
        else localStorage.removeItem('minedock-selected-server-id');
      } else if (!currentSelected && servers[0]?.id) {
        set({ selectedServerId: servers[0].id });
        localStorage.setItem('minedock-selected-server-id', String(servers[0].id));
      }
    } catch (error) { console.error('Failed to fetch servers:', error); }
  },

  fetchSettings: async () => {
    try { set({ settings: await invoke<AppSettings>('fetch_settings') }); }
    catch (error) { console.error('Failed to fetch settings:', error); }
  },

  setSelectedServer: (id) => set((state) => {
    const openServerIds = id && !state.openServerIds.includes(id) ? [...state.openServerIds, id] : state.openServerIds;
    localStorage.setItem(TABS_KEY, JSON.stringify(openServerIds));
    if (id) {
      localStorage.setItem('minedock-selected-server-id', String(id));
    } else {
      localStorage.removeItem('minedock-selected-server-id');
    }
    return { selectedServerId: id, openServerIds };
  }),
  closeServerTab: (id) => set((state) => {
    const openServerIds = state.openServerIds.filter(tabId => tabId !== id);
    localStorage.setItem(TABS_KEY, JSON.stringify(openServerIds));
    const index = state.openServerIds.indexOf(id);
    const nextSelectedId = state.selectedServerId === id ? (openServerIds[Math.min(index, openServerIds.length - 1)] ?? null) : state.selectedServerId;
    if (nextSelectedId) {
      localStorage.setItem('minedock-selected-server-id', String(nextSelectedId));
    } else {
      localStorage.removeItem('minedock-selected-server-id');
    }
    return {
      openServerIds,
      selectedServerId: nextSelectedId,
    };
  }),
  moveServerTab: (from, to) => set((state) => {
    const openServerIds = [...state.openServerIds];
    const [id] = openServerIds.splice(from, 1);
    openServerIds.splice(to, 0, id);
    localStorage.setItem(TABS_KEY, JSON.stringify(openServerIds));
    return { openServerIds };
  }),
  updateServerStatus: (id, status) => set((state) => ({
    servers: state.servers.map((server) => server.id === id ? { ...server, status } : server)
  })),

  appendConsoleLog: (id, text, isError) => set((state) => {
    // Strip ANSI escape codes
    const cleanText = text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
    const consoleLogs = {
      ...state.consoleLogs,
      [id]: [...(state.consoleLogs[id] || []), {
        id: Date.now() * 1000 + nextLogId++, text: cleanText, isError,
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

  createBackup: async (id, path, customName) => {
    set((state) => ({ backupJobs: { ...state.backupJobs, [id]: 'Creating backup...' } }));
    try {
      const name = customName?.trim() || `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
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
