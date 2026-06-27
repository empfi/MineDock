import { create } from 'zustand';
import { Server, AppSettings } from './types';
import { invoke } from '@tauri-apps/api/core';

interface AppState {
  servers: Server[];
  selectedServerId: number | null;
  settings: AppSettings | null;
  
  fetchServers: () => Promise<void>;
  fetchSettings: () => Promise<void>;
  setSelectedServer: (id: number | null) => void;
  updateServerStatus: (id: number, status: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
  servers: [],
  selectedServerId: null,
  settings: null,

  fetchServers: async () => {
    try {
      const servers = await invoke<Server[]>('fetch_servers');
      set({ servers });
      
      // If we don't have a selected server but we have servers, select the first one
      const currentSelected = get().selectedServerId;
      if (!currentSelected && servers.length > 0 && servers[0].id) {
        set({ selectedServerId: servers[0].id });
      }
    } catch (error) {
      console.error('Failed to fetch servers:', error);
    }
  },

  fetchSettings: async () => {
    try {
      const settings = await invoke<AppSettings>('fetch_settings');
      set({ settings });
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    }
  },

  setSelectedServer: (id: number | null) => {
    set({ selectedServerId: id });
  },

  updateServerStatus: (id: number, status: string) => {
    set((state) => ({
      servers: state.servers.map((s) => 
        s.id === id ? { ...s, status } : s
      )
    }));
  }
}));
