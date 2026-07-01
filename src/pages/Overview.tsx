import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { AlertTriangle, Server, Activity, FolderX, Wrench } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { cn } from '../lib/utils';
import { invoke } from '@tauri-apps/api/core';
import { getSoftwareInfo } from '../lib/software';
import EmptyState from '../components/EmptyState';

export default function Overview() {
  const { servers, setSelectedServer, settings } = useStore();
  const navigate = useNavigate();
  const [sysMemory, setSysMemory] = useState<number | null>(null);

  useEffect(() => {
    invoke<number>('get_system_memory').then(setSysMemory).catch(console.error);
  }, []);

  const runningServers = servers.filter(s => s.status === 'online' || s.status === 'starting');
  const totalServers = servers.length;
  const problems = servers.flatMap(server => {
    const items: { key: string; title: string; detail: string; action: string; run: () => void; icon: typeof AlertTriangle }[] = [];
    if (['crashed', 'crash-loop'].includes(server.status)) items.push({
      key: `${server.id}:crash`,
      title: `${server.name} ${server.status === 'crash-loop' ? 'stopped restarting' : 'crashed'}`,
      detail: 'Open the console and latest logs to inspect the failure.',
      action: 'Open console',
      run: () => { setSelectedServer(server.id ?? null); navigate('/console'); },
      icon: AlertTriangle,
    });
    if (server.install_path_exists === false) items.push({
      key: `${server.id}:folder`,
      title: `${server.name} folder is missing`,
      detail: 'MineDock cannot start or edit this server until its folder is restored.',
      action: 'Manage server',
      run: () => navigate('/servers'),
      icon: FolderX,
    });
    return items;
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full">
      <PageHeader
        title="Overview"
        description="Welcome to MineDock server manager."
        actions={
          <button onClick={() => navigate('/wizard')} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors">
            Create Server
          </button>
        }
      />

      {problems.length > 0 && <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <Wrench size={18} className="text-amber-400" />
          <h2 className="font-semibold text-white">Needs attention</h2>
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">{problems.length}</span>
        </div>
        <div className="overflow-hidden rounded-lg border border-amber-500/20 bg-[#1c1d21]">
          {problems.map(problem => <div key={problem.key} className="flex items-center gap-4 border-b border-[#2a2b2f] p-4 last:border-0">
            <div className="rounded-md bg-amber-500/10 p-2 text-amber-400"><problem.icon size={18} /></div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-white">{problem.title}</p>
              <p className="mt-0.5 text-sm text-gray-500">{problem.detail}</p>
            </div>
            <button onClick={problem.run} className="action-button bg-[#2a2b2f] px-3 py-2 text-sm text-gray-200 hover:bg-[#34353a]">{problem.action}</button>
          </div>)}
        </div>
      </section>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-8">
        <div className="bg-[#1c1d21] border border-[#2a2b2f] rounded-lg p-6 flex flex-col">
          <div className="flex items-center gap-3 text-gray-400 mb-2">
            <Server size={20} />
            <h3 className="font-medium">Total Servers</h3>
          </div>
          <p className="text-4xl font-bold text-white">{totalServers}</p>
        </div>

        <div className="bg-[#1c1d21] border border-[#2a2b2f] rounded-lg p-6 flex flex-col">
          <div className="flex items-center gap-3 text-emerald-400 mb-2">
            <Activity size={20} />
            <h3 className="font-medium">Running Servers</h3>
          </div>
          <p className="text-4xl font-bold text-white">{runningServers.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Your Servers Section */}
        <div className="lg:col-span-2">
          <h2 className="text-xl font-bold text-white mb-4">Your Servers</h2>
          {servers.length === 0 ? (
            <EmptyState icon={Server} title="No servers yet" description="Create your first Minecraft server or import an existing installation." action="Create server" onAction={() => navigate('/wizard')} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[...servers]
                .sort((a, b) => {
                  const getPriority = (status: string) => {
                    if (status === 'online') return 0;
                    if (status === 'starting') return 1;
                    if (status === 'stopping') return 2;
                    return 3;
                  };
                  return getPriority(a.status) - getPriority(b.status);
                })
                .map(server => (
                  <div
                    key={server.id}
                    onClick={() => { setSelectedServer(server.id || null); navigate('/console'); }}
                    className="bg-[#1c1d21] border border-[#2a2b2f] hover:border-[#34353a] rounded-lg p-5 flex flex-col justify-between cursor-pointer transition-colors"
                  >
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex min-w-0 items-center gap-3 pr-2">
                          <img src={getSoftwareInfo(server.server_type).icon} alt="" className="h-7 w-7 shrink-0 rounded-md object-contain" />
                          <h3 className="min-w-0 truncate font-bold text-white text-lg">{server.name}</h3>
                        </div>
                        <span className={cn(
                          "px-2.5 py-0.5 text-xs font-semibold rounded-full",
                          server.status === 'online' ? "bg-emerald-500/10 text-emerald-400" :
                            server.status === 'starting' ? "bg-blue-500/10 text-blue-400" :
                              server.status === 'stopping' ? "bg-red-500/10 text-red-400" :
                                "bg-gray-500/10 text-gray-400"
                        )}>
                          {server.status.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400">{server.minecraft_version} · {getSoftwareInfo(server.server_type).name}</p>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* System Status Section */}
        <div>
          <h2 className="text-xl font-bold text-white mb-4">Information</h2>
          <div className="bg-[#1c1d21] border border-[#2a2b2f] rounded-lg p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#2a2b2f] text-sm font-semibold text-gray-300">
                E
              </div>
              <div>
                <h4 className="font-bold text-white text-base">empfi</h4>
                <p className="text-xs text-gray-500">Local profile</p>
              </div>
            </div>
            <div className="border-t border-[#2a2b2f] pt-4 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">System RAM</span>
                <span className="text-gray-200">{sysMemory ? `${Math.round(sysMemory / 1024)} GB` : 'Loading...'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Relay Status</span>
                <span className={settings?.tunnel_enabled ? 'text-emerald-400 font-semibold' : 'text-gray-500'}>{settings?.tunnel_enabled ? 'Enabled' : 'Disabled'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
