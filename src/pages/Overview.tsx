import { useStore } from '../store';
import { Server, Activity } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Overview() {
  const { servers, setSelectedServer } = useStore();
  const navigate = useNavigate();

  const runningServers = servers.filter(s => s.status === 'online' || s.status === 'starting');
  const totalServers = servers.length;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Overview</h1>
          <p className="text-gray-400">Welcome to MineDock server manager.</p>
        </div>
        <button
          onClick={() => navigate('/wizard')}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors"
        >
          Create Server
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
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

      <h2 className="text-xl font-bold text-white mb-4">Quick Access</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {servers.map(server => (
          <div key={server.id} className="bg-[#1c1d21] border border-[#2a2b2f] rounded-lg overflow-hidden hover:border-gray-600 transition-colors cursor-pointer group" onClick={() => {
            setSelectedServer(server.id || null);
            navigate('/console');
          }}>
            <div className="p-5 border-b border-[#2a2b2f]">
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-bold text-lg text-white group-hover:text-blue-400 transition-colors">{server.name}</h3>
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                  server.status === 'online' ? 'bg-emerald-500/10 text-emerald-400' :
                  server.status === 'starting' ? 'bg-amber-500/10 text-amber-400' :
                  server.status === 'stopping' ? 'bg-red-500/10 text-red-400' :
                  'bg-gray-500/10 text-gray-400'
                }`}>
                  {server.status}
                </span>
              </div>
              <p className="text-sm text-gray-400 mb-1">{server.minecraft_version} • {server.server_type}</p>
            </div>
            <div className="bg-[#141517] px-5 py-3 flex justify-between items-center text-sm">
              <span className="text-gray-500">Port {server.port}</span>
              <span className="text-gray-500">{server.ram_max} MB RAM</span>
            </div>
          </div>
        ))}
        {servers.length === 0 && (
          <div className="col-span-full py-12 text-center text-gray-500 border border-dashed border-[#2a2b2f] rounded-lg">
            No servers yet. Click "Create Server" to get started.
          </div>
        )}
      </div>
    </div>
  );
}
