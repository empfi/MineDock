import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Activity, Clock, Cpu, Database, HardDrive, MemoryStick, Users } from 'lucide-react';
import { useStore } from '../store';
import PageHeader from '../components/PageHeader';

type DiskUsage = { total: number; worlds: number; backups: number; additions: number };

const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${Math.round(value / 1024 ** 2)} MB`;

export default function Health() {
  const { servers, selectedServerId, serverStats, onlinePlayers } = useStore();
  const server = servers.find(item => item.id === selectedServerId);
  const [disk, setDisk] = useState<DiskUsage | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!server?.id) return;
    invoke<DiskUsage>('get_server_disk_usage', { id: server.id }).then(setDisk).catch(() => setDisk(null));
    const refresh = window.setInterval(() => {
      setNow(Date.now());
      invoke<DiskUsage>('get_server_disk_usage', { id: server.id }).then(setDisk).catch(() => {});
    }, 10000);
    return () => window.clearInterval(refresh);
  }, [server?.id]);

  if (!server?.id) return <div className="p-8 text-center text-gray-500">Select a server first.</div>;
  const ticks = serverStats[server.id] || [];
  const latest = ticks[ticks.length - 1];
  const peakCpu = ticks.reduce((peak, tick) => Math.max(peak, tick.cpu), 0);
  const peakMemory = ticks.reduce((peak, tick) => Math.max(peak, tick.memory), 0);
  const started = Date.parse(server.last_started_at || '');
  const uptime = Number.isFinite(started) && server.status !== 'offline'
    ? `${Math.floor((now - started) / 3600000)}h ${Math.floor(((now - started) % 3600000) / 60000)}m`
    : 'Offline';
  const cards = [
    [Cpu, 'CPU', latest ? `${latest.cpu.toFixed(1)}%` : '—', `Peak ${peakCpu.toFixed(1)}%`],
    [MemoryStick, 'Memory', latest ? `${latest.memory} MB` : '—', `Peak ${peakMemory} MB`],
    [Clock, 'Uptime', uptime, server.status],
    [Users, 'Players', String(onlinePlayers[server.id]?.length || 0), 'Online now'],
  ] as const;

  return <div className="p-4 sm:p-6 lg:p-8">
    <PageHeader title="Health" description={`Live health and storage for ${server.name}.`} />
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map(([Icon, label, value, detail]) => <div key={label} className="rounded-lg border border-[#2a2b2f] bg-[#1c1d21] p-5">
        <Icon size={18} className="text-blue-400" />
        <div className="mt-4 text-xs text-gray-500">{label}</div>
        <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
        <div className="mt-1 text-xs capitalize text-gray-600">{detail}</div>
      </div>)}
    </div>
    <div className="mt-6 rounded-lg border border-[#2a2b2f] bg-[#1c1d21] p-5">
      <div className="mb-5 flex items-center gap-2 font-semibold text-white"><HardDrive size={18} className="text-violet-400" /> Storage</div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[[Database, 'Total', disk?.total], [Activity, 'Worlds', disk?.worlds], [Database, 'Backups', disk?.backups], [HardDrive, 'Plugins & mods', disk?.additions]].map(([Icon, label, value]: any) =>
          <div key={label} className="rounded-md bg-[#141517] p-4"><Icon size={16} className="text-gray-500" /><div className="mt-3 text-xs text-gray-500">{label}</div><div className="mt-1 font-medium text-white">{value == null ? 'Scanning…' : bytes(value)}</div></div>
        )}
      </div>
    </div>
  </div>;
}
