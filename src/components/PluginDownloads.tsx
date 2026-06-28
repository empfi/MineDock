import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { ChevronDown, ChevronUp, Download, X } from 'lucide-react';

type Transfer = {
  id: string;
  name: string;
  downloaded?: number;
  total?: number;
  state: 'downloading' | 'done' | 'failed';
};

export default function PluginDownloads() {
  const [items, setItems] = useState<Transfer[]>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let remove: (() => void) | undefined;
    listen<Transfer>('plugin-download-progress', ({ payload }) => {
      setItems(current => payload.state === 'downloading'
        ? [...current.filter(item => item.id !== payload.id), payload]
        : current.filter(item => item.id !== payload.id));
      setOpen(true);
    }).then(unlisten => { remove = unlisten; });
    return () => remove?.();
  }, []);

  if (!items.length) return null;
  return (
    <div className="relative z-[70]">
      <button onClick={() => setOpen(value => !value)} className="flex h-10 items-center gap-2 border-l border-[#2a2b2f] px-3 text-xs font-medium text-gray-300 hover:bg-[#202124] hover:text-white">
        <Download size={14} /> {items.length} plugin{items.length === 1 ? '' : 's'} {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && <div className="absolute right-0 top-full mt-2 w-80 overflow-hidden rounded-lg border border-[#2a2b2f] bg-[#1c1d21] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#2a2b2f] px-3 py-2 text-sm font-semibold text-white">
          Plugin downloads
          <button onClick={() => setItems([])} className="text-gray-500 hover:text-white"><X size={15} /></button>
        </div>
        <div className="max-h-64 overflow-y-auto p-2">
          {items.map(item => {
            const progress = item.total ? Math.min(100, item.downloaded! / item.total * 100) : 0;
            return <div key={item.id} className="rounded-md px-2 py-2">
              <div className="mb-1.5 flex justify-between gap-3 text-xs"><span className="truncate text-gray-200">{item.name}</span><span className={item.state === 'failed' ? 'text-red-400' : 'text-gray-500'}>{item.state === 'done' ? 'Done' : item.state === 'failed' ? 'Failed' : item.total ? `${Math.round(progress)}%` : 'Downloading'}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[#303137]"><div className={`h-full transition-[width] duration-150 ${item.state === 'failed' ? 'bg-red-500' : 'bg-blue-500'} ${!item.total && item.state === 'downloading' ? 'w-1/3 animate-pulse' : ''}`} style={item.total || item.state === 'done' ? { width: `${item.state === 'done' ? 100 : progress}%` } : undefined} /></div>
            </div>;
          })}
        </div>
      </div>}
    </div>
  );
}
