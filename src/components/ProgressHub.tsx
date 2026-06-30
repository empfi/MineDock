import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { ChevronDown, ChevronUp, Activity, X } from 'lucide-react';
import { useStore } from '../store';

export type Transfer = {
  id: string;
  name: string;
  downloaded?: number;
  total?: number;
  state: 'downloading' | 'done' | 'failed';
};

const INSTALL_EVENT = 'minedock-install-progress';

export function reportInstall(item: Transfer) {
  window.dispatchEvent(new CustomEvent(INSTALL_EVENT, { detail: item }));
}

export default function ProgressHub() {
  const [items, setItems] = useState<Transfer[]>([]);
  const [open, setOpen] = useState(false);
  const hubRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let removeInstall: (() => void) | undefined;
    let removeBackup: (() => void) | undefined;

    const update = (payload: Transfer) => {
      setItems(current => [...current.filter(item => item.id !== payload.id), payload]);
    };

    const local = (event: Event) => update((event as CustomEvent<Transfer>).detail);
    window.addEventListener(INSTALL_EVENT, local);

    listen<Transfer>('install-progress', ({ payload }) => update(payload)).then(unlisten => {
      removeInstall = unlisten;
    });

    listen<number>('backup-progress', ({ payload }) => {
      // Find what the active backup job is from the store to give it a descriptive name
      const { servers, backupJobs } = useStore.getState();
      const activeJobServerId = Object.keys(backupJobs).find(id => backupJobs[Number(id)] !== undefined);
      const activeJob = activeJobServerId ? backupJobs[Number(activeJobServerId)] : undefined;
      const server = activeJobServerId ? servers.find(s => s.id === Number(activeJobServerId)) : undefined;

      let name = 'Backup/Restore Task';
      if (activeJob && server) {
        name = `${activeJob.replace('...', '')} (${server.name})`;
      } else if (activeJob) {
        name = activeJob.replace('...', '');
      }

      update({
        id: 'backup-progress-job',
        name,
        downloaded: payload,
        total: 100,
        state: payload >= 100 ? 'done' : 'downloading',
      });
    }).then(unlisten => {
      removeBackup = unlisten;
    });

    return () => {
      removeInstall?.();
      removeBackup?.();
      window.removeEventListener(INSTALL_EVENT, local);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!hubRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  if (!items.length) return null;

  const activeCount = items.filter(item => item.state === 'downloading').length;

  return (
    <div ref={hubRef} className="relative z-[70]">
      <button 
        onClick={() => setOpen(value => !value)} 
        className="flex h-10 items-center gap-2 border-l border-[#2a2b2f] px-3 text-xs font-medium text-gray-300 hover:bg-[#202124] hover:text-white whitespace-nowrap"
      >
        <Activity size={14} className={activeCount > 0 ? "animate-pulse text-blue-400" : ""} />
        <span>{activeCount || items.length} task{items.length === 1 ? '' : 's'}</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 overflow-hidden rounded-lg border border-[#2a2b2f] bg-[#1c1d21] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[#2a2b2f] px-3 py-2 text-sm font-semibold text-white">
            <span>Progress hub</span>
            <button onClick={() => setItems([])} className="text-gray-500 hover:text-white">
              <X size={15} />
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {items.map(item => {
              const progress = item.total ? Math.min(100, item.downloaded! / item.total * 100) : 0;
              return (
                <div key={item.id} className="rounded-md px-2 py-2">
                  <div className="mb-1.5 flex justify-between gap-3 text-xs">
                    <span className="truncate text-gray-200">{item.name}</span>
                    <span className={item.state === 'failed' ? 'text-red-400' : 'text-gray-500'}>
                      {item.state === 'done' ? 'Done' : item.state === 'failed' ? 'Failed' : item.total ? `${Math.round(progress)}%` : 'Running'}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[#303137]">
                    <div 
                      className={`h-full transition-[width] duration-150 ${item.state === 'failed' ? 'bg-red-500' : 'bg-blue-500'} ${!item.total && item.state === 'downloading' ? 'w-1/3 animate-pulse' : ''}`} 
                      style={item.total || item.state === 'done' ? { width: `${item.state === 'done' ? 100 : progress}%` } : undefined} 
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
