import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { Download, Loader2 } from 'lucide-react';

interface VersionManifest {
  latest: { release: string; snapshot: string };
  versions: { id: string; type: string; url: string; time: string; releaseTime: string }[];
}

export default function Versions() {
  const { servers, selectedServerId } = useStore();
  const selectedServer = servers.find(s => s.id === selectedServerId);
  
  const [manifest, setManifest] = useState<VersionManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'release' | 'snapshot' | 'all'>('release');

  useEffect(() => {
    invoke<VersionManifest>('get_mc_versions')
      .then(setManifest)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (!selectedServer) {
    return (
      <div className="p-8 max-w-5xl mx-auto flex items-center justify-center h-full">
        <p className="text-gray-500">Select a server to manage versions.</p>
      </div>
    );
  }

  const versions = manifest?.versions.filter(v => filter === 'all' || v.type === filter) || [];

  return (
    <div className="p-8 max-w-5xl mx-auto flex flex-col h-full">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Minecraft Versions</h1>
        <p className="text-gray-400">View and download Vanilla server jars.</p>
      </div>

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setFilter('release')}
          className={`px-4 py-2 rounded-md font-medium text-sm transition-colors ${filter === 'release' ? 'bg-blue-600 text-white' : 'bg-[#1c1d21] text-gray-400 hover:bg-[#2a2b2f]'}`}
        >
          Releases
        </button>
        <button
          onClick={() => setFilter('snapshot')}
          className={`px-4 py-2 rounded-md font-medium text-sm transition-colors ${filter === 'snapshot' ? 'bg-blue-600 text-white' : 'bg-[#1c1d21] text-gray-400 hover:bg-[#2a2b2f]'}`}
        >
          Snapshots
        </button>
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded-md font-medium text-sm transition-colors ${filter === 'all' ? 'bg-blue-600 text-white' : 'bg-[#1c1d21] text-gray-400 hover:bg-[#2a2b2f]'}`}
        >
          All
        </button>
      </div>

      <div className="flex-1 overflow-y-auto bg-[#1c1d21] border border-[#2a2b2f] rounded-lg">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Loader2 size={32} className="animate-spin mb-4 text-blue-500" />
            <p>Fetching Mojang versions manifest...</p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-[#141517] border-b border-[#2a2b2f] text-xs font-semibold text-gray-400 uppercase tracking-wider sticky top-0">
              <tr>
                <th className="px-6 py-4">Version</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Release Date</th>
                <th className="px-6 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2b2f]">
              {versions.map(v => (
                <tr key={v.id} className="hover:bg-[#202124] transition-colors">
                  <td className="px-6 py-4 font-medium text-white flex items-center gap-2">
                    {v.id}
                    {v.id === selectedServer.minecraft_version && (
                      <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-xs rounded-full">Current</span>
                    )}
                    {manifest?.latest.release === v.id && (
                      <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-xs rounded-full">Latest Release</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs rounded-md ${v.type === 'release' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-purple-500/10 text-purple-400'}`}>
                      {v.type}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-400 text-sm">
                    {new Date(v.releaseTime).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      className="inline-flex items-center gap-2 bg-[#2a2b2f] hover:bg-[#3a3b3f] text-white px-3 py-1.5 rounded text-sm transition-colors"
                      onClick={() => alert('Changing version of existing server is not fully implemented in this UI yet, but you can create a new server with this version.')}
                    >
                      <Download size={14} /> Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
