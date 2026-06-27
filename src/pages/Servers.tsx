import { useStore } from '../store';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { Play, Square, Trash2, FolderOpen, Settings as SettingsIcon } from 'lucide-react';
import { Server } from '../types';

export default function Servers() {
  const { servers, fetchServers, setSelectedServer } = useStore();
  const navigate = useNavigate();

  const handleStart = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    try {
      await invoke('start_mc_server', { id });
    } catch (err) {
      console.error(err);
    }
  };

  const handleStop = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    try {
      await invoke('stop_mc_server', { id });
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this server? This only removes it from the list, not the files.')) {
      try {
        await invoke('remove_server', { id });
        fetchServers();
      } catch (err) {
        console.error(err);
      }
    }
  };

  const openFolder = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    try {
      // requires tauri-plugin-shell which we added
      const { Command } = await import('@tauri-apps/plugin-shell');
      Command.create('explorer', [path]).spawn();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Servers</h1>
          <p className="text-gray-400">Manage your local Minecraft servers.</p>
        </div>
        <button
          onClick={() => navigate('/wizard')}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors"
        >
          Create Server
        </button>
      </div>

      <div className="bg-[#1c1d21] border border-[#2a2b2f] rounded-lg overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-[#141517] border-b border-[#2a2b2f] text-xs font-semibold text-gray-400 uppercase tracking-wider">
            <tr>
              <th className="px-6 py-4">Name</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4">Version</th>
              <th className="px-6 py-4">Port</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2a2b2f]">
            {servers.map((server: Server) => (
              <tr 
                key={server.id} 
                className="hover:bg-[#202124] transition-colors cursor-pointer group"
                onClick={() => {
                  if (server.id) {
                    setSelectedServer(server.id);
                    navigate('/console');
                  }
                }}
              >
                <td className="px-6 py-4 font-medium text-white">
                  {server.name}
                  <div className="text-xs text-gray-500 font-normal mt-1">{server.server_type}</div>
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${
                    server.status === 'online' ? 'bg-emerald-500/10 text-emerald-400' :
                    server.status === 'starting' ? 'bg-amber-500/10 text-amber-400' :
                    server.status === 'stopping' ? 'bg-red-500/10 text-red-400' :
                    'bg-gray-500/10 text-gray-400'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      server.status === 'online' ? 'bg-emerald-400' :
                      server.status === 'starting' ? 'bg-amber-400 animate-pulse' :
                      server.status === 'stopping' ? 'bg-red-400 animate-pulse' :
                      'bg-gray-400'
                    }`}></span>
                    {server.status.charAt(0).toUpperCase() + server.status.slice(1)}
                  </span>
                </td>
                <td className="px-6 py-4 text-gray-300">
                  {server.minecraft_version}
                </td>
                <td className="px-6 py-4 text-gray-300">
                  {server.port}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {server.status === 'offline' || server.status === 'crashed' ? (
                      <button 
                        onClick={(e) => handleStart(e, server.id!)}
                        className="p-1.5 text-gray-400 hover:text-emerald-400 hover:bg-[#2a2b2f] rounded"
                        title="Start Server"
                      >
                        <Play size={18} />
                      </button>
                    ) : (
                      <button 
                        onClick={(e) => handleStop(e, server.id!)}
                        className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-[#2a2b2f] rounded"
                        title="Stop Server"
                      >
                        <Square size={18} />
                      </button>
                    )}
                    
                    <button 
                      onClick={(e) => openFolder(e, server.install_path)}
                      className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-[#2a2b2f] rounded"
                      title="Open Folder"
                    >
                      <FolderOpen size={18} />
                    </button>
                    
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedServer(server.id!);
                        navigate('/properties');
                      }}
                      className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-[#2a2b2f] rounded"
                      title="Properties"
                    >
                      <SettingsIcon size={18} />
                    </button>

                    <button 
                      onClick={(e) => handleDelete(e, server.id!)}
                      className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-[#2a2b2f] rounded"
                      title="Delete Server Profile"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {servers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                  No servers found. Create one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
