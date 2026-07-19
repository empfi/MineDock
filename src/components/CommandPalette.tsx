import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Activity, Database, Download, FolderGit2, Globe2, HeartPulse, PackageSearch, Play, Plus, RotateCw, Save, Search, Server, Settings, Square, Terminal, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { getSoftwareInfo } from '../lib/software';
import { confirmNavigationAsync } from '../lib/navigationGuard';
import { notify } from './Notifications';

const pages = [
  ['Overview', '/', Database], ['Servers', '/servers', Server], ['Settings', '/settings', Settings],
  ['Console', '/console', Terminal], ['Health', '/health', HeartPulse], ['Files', '/files', FolderGit2],
  ['Additions', '/additions', PackageSearch], ['Players', '/players', Users], ['Worlds', '/worlds', Globe2],
  ['Properties', '/properties', Save], ['Backups', '/backups', Database], ['Versions', '/versions', Download],
] as const;

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rows = useRef(new Map<number, HTMLButtonElement>());
  const { servers, selectedServerId, setSelectedServer, createBackup } = useStore();
  const navigate = useNavigate();
  const selected = servers.find(server => server.id === selectedServerId);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(value => !value);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    const show = () => setOpen(true);
    window.addEventListener('keydown', keydown);
    window.addEventListener('minedock:command-palette', show);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('minedock:command-palette', show);
    };
  }, []);

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const navigateTo = async (path: string) => { if (await confirmNavigationAsync()) navigate(path); };
    const serverAction = async (action: 'start' | 'stop' | 'restart') => {
      if (!selected?.id) return;
      try {
        if (action === 'start') await invoke('start_mc_server', { id: selected.id });
        else {
          await invoke('stop_mc_server', { id: selected.id });
          if (action === 'restart') {
            for (let attempt = 0; attempt < 30; attempt++) {
              await new Promise(resolve => setTimeout(resolve, 1000));
              if (useStore.getState().servers.find(server => server.id === selected.id)?.status === 'offline') {
                await invoke('start_mc_server', { id: selected.id });
                break;
              }
            }
          }
        }
      } catch (error) { notify(`Failed to ${action} server: ${error}`, 'error'); }
    };
    return [
      { label: 'Create new server', detail: 'Action', icon: Plus, run: () => navigateTo('/wizard'), disabled: false },
      ...(selected ? [
        { label: 'Start server', detail: selected.name, icon: Play, run: () => serverAction('start'), disabled: !['offline', 'crashed', 'crash-loop'].includes(selected.status) },
        { label: 'Stop server', detail: selected.name, icon: Square, run: () => serverAction('stop'), disabled: selected.status !== 'online' },
        { label: 'Restart server', detail: selected.name, icon: RotateCw, run: () => serverAction('restart'), disabled: selected.status !== 'online' },
        { label: 'Create backup', detail: selected.name, icon: Database, run: () => createBackup(selected.id!, selected.install_path), disabled: false },
      ] : []),
      ...pages.map(([label, path, icon]) => ({ label, detail: 'Page', icon, run: () => navigateTo(path), disabled: false })),
      ...servers.map(server => ({
        label: server.name,
        detail: `${getSoftwareInfo(server.server_type).name} ${server.minecraft_version}`,
        icon: Server,
        run: async () => { if (await confirmNavigationAsync()) { setSelectedServer(server.id ?? null); navigate('/console'); } },
        disabled: false,
      })),
    ].filter(item => !needle || `${item.label} ${item.detail}`.toLowerCase().includes(needle));
  }, [createBackup, navigate, query, selected, servers, setSelectedServer]);

  useEffect(() => { setActive(0); }, [query, items.length]);
  useEffect(() => { rows.current.get(active)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  const run = (index: number) => {
    const item = items[index];
    if (!item || item.disabled) return;
    void item.run();
    localStorage.setItem('minedock:recent_commands', JSON.stringify([item.label, ...JSON.parse(localStorage.getItem('minedock:recent_commands') || '[]').filter((label: string) => label !== item.label)].slice(0, 5)));
    setOpen(false);
    setQuery('');
  };

  if (!open) return null;
  return (
    <div className="command-palette fixed inset-0 z-[40000] flex justify-center bg-black/70 px-4 pt-[12vh]" onMouseDown={() => setOpen(false)}>
      <div className="h-fit w-full max-w-xl overflow-hidden rounded-xl border border-[#34353a] bg-[#1c1d21] shadow-2xl" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={event => event.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-[#2a2b2f] px-4">
          <Search size={18} className="text-gray-500" />
          <input autoFocus value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive(value => (value + 1) % items.length); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActive(value => (value - 1 + items.length) % items.length); }
            if (event.key === 'Home') { event.preventDefault(); setActive(0); }
            if (event.key === 'End') { event.preventDefault(); setActive(Math.max(0, items.length - 1)); }
            if (event.key === 'Enter') { event.preventDefault(); run(active); }
          }} placeholder="Search pages, servers, and actions…" className="command-palette-input h-14 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-gray-600" />
          <kbd className="rounded border border-[#34353a] px-1.5 py-0.5 text-[10px] text-gray-500">ESC</kbd>
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {items.length ? items.map((item, index) => <button ref={element => { if (element) rows.current.set(index, element); else rows.current.delete(index); }} role="option" aria-selected={active === index} disabled={item.disabled} key={`${item.detail}:${item.label}`} onMouseEnter={() => setActive(index)} onClick={() => run(index)} className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left disabled:opacity-35 ${active === index ? 'bg-[#292a2f]' : 'hover:bg-[#25262a]'}`}>
            <item.icon size={17} className={index === 0 ? 'text-blue-400' : 'text-gray-500'} />
            <span className="min-w-0 flex-1 truncate text-sm text-gray-200">{item.label}</span>
            <span className="text-xs text-gray-600">{item.detail}</span>
          </button>) : <div className="py-10 text-center text-sm text-gray-600">No matching command.</div>}
        </div>
        <div className="flex items-center gap-2 border-t border-[#2a2b2f] px-4 py-2 text-[11px] text-gray-600"><Activity size={12} /> Ctrl+K opens this anywhere</div>
      </div>
    </div>
  );
}
