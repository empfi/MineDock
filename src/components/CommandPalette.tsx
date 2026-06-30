import { useEffect, useMemo, useState } from 'react';
import { Activity, Database, Download, FolderGit2, Globe2, HeartPulse, PackageSearch, Plus, Save, Search, Server, Settings, Terminal, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { getSoftwareInfo } from '../lib/software';

const pages = [
  ['Overview', '/', Database], ['Servers', '/servers', Server], ['Settings', '/settings', Settings],
  ['Console', '/console', Terminal], ['Health', '/health', HeartPulse], ['Files', '/files', FolderGit2],
  ['Additions', '/additions', PackageSearch], ['Players', '/players', Users], ['Worlds', '/worlds', Globe2],
  ['Properties', '/properties', Save], ['Backups', '/backups', Database], ['Versions', '/versions', Download],
] as const;

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { servers, setSelectedServer } = useStore();
  const navigate = useNavigate();

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
    return [
      { label: 'Create new server', detail: 'Action', icon: Plus, run: () => navigate('/wizard') },
      ...pages.map(([label, path, icon]) => ({ label, detail: 'Page', icon, run: () => navigate(path) })),
      ...servers.map(server => ({
        label: server.name,
        detail: `${getSoftwareInfo(server.server_type).name} ${server.minecraft_version}`,
        icon: Server,
        run: () => { setSelectedServer(server.id ?? null); navigate('/console'); },
      })),
    ].filter(item => !needle || `${item.label} ${item.detail}`.toLowerCase().includes(needle));
  }, [navigate, query, servers, setSelectedServer]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[40000] flex justify-center bg-black/70 px-4 pt-[12vh]" onMouseDown={() => setOpen(false)}>
      <div className="h-fit w-full max-w-xl overflow-hidden rounded-xl border border-[#34353a] bg-[#1c1d21] shadow-2xl" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={event => event.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-[#2a2b2f] px-4">
          <Search size={18} className="text-gray-500" />
          <input autoFocus value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
            if (event.key === 'Enter' && items[0]) {
              items[0].run();
              setOpen(false);
              setQuery('');
            }
          }} placeholder="Search pages, servers, and actions…" className="command-palette-input h-14 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-gray-600" />
          <kbd className="rounded border border-[#34353a] px-1.5 py-0.5 text-[10px] text-gray-500">ESC</kbd>
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {items.length ? items.map((item, index) => <button key={`${item.detail}:${item.label}`} onClick={() => { item.run(); setOpen(false); setQuery(''); }} className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-[#292a2f]">
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
