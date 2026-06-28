import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { notify } from '../components/Notifications';
import { Download, Loader2, AlertTriangle } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';

interface VersionManifest {
  latest: { release: string; snapshot: string };
  versions: { id: string; type: string; url: string; time: string; releaseTime: string }[];
}

interface VersionItem {
  id: string;
  type: string;
  url?: string;
  releaseTime?: string;
}

export default function Versions() {
  const { servers, selectedServerId, fetchServers } = useStore();
  const selectedServer = servers.find(s => s.id === selectedServerId);
  
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'release' | 'snapshot' | 'all'>('release');

  const [versionsList, setVersionsList] = useState<VersionItem[]>([]);
  const [latestRelease, setLatestRelease] = useState<string | null>(null);

  const [downloadingVersion, setDownloadingVersion] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');

  // Downgrade Warning States
  const [showDowngradeWarning, setShowDowngradeWarning] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [pendingVersion, setPendingVersion] = useState<VersionItem | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (showDowngradeWarning && countdown > 0) {
      timer = setTimeout(() => {
        setCountdown(prev => prev - 1);
      }, 1000);
    }
    return () => clearTimeout(timer);
  }, [showDowngradeWarning, countdown]);

  useEffect(() => {
    if (!selectedServer) return;
    setLoading(true);
    if (selectedServer.server_type === 'vanilla') {
      invoke<VersionManifest>('get_mc_versions')
        .then(data => {
          const list = data.versions.map(v => ({
            id: v.id,
            type: v.type,
            url: v.url,
            releaseTime: v.releaseTime
          }));
          setVersionsList(list);
          setLatestRelease(data.latest.release);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    } else {
      invoke<{ id: string; release_time?: string }[]>('get_software_version_info', { serverType: selectedServer.server_type })
        .then(data => {
          const list = data.map(v => ({
            id: v.id,
            type: selectedServer.server_type,
            releaseTime: v.release_time
          }));
          setVersionsList(list);
          setLatestRelease(data[0]?.id || null);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [selectedServerId]);

  if (!selectedServer) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 w-full flex items-center justify-center h-full">
        <p className="text-gray-500">Select a server to manage versions.</p>
      </div>
    );
  }

  const checkIsDowngrade = (selectedVersionId: string) => {
    const currentVersion = selectedServer.minecraft_version;
    const currentIdx = versionsList.findIndex(v => v.id === currentVersion);
    const selectedIdx = versionsList.findIndex(v => v.id === selectedVersionId);
    return currentIdx !== -1 && selectedIdx !== -1 && selectedIdx > currentIdx;
  };

  const handleDownload = (v: VersionItem) => {
    const isDowngrade = checkIsDowngrade(v.id);
    if (isDowngrade) {
      setPendingVersion(v);
      setCountdown(3);
      setShowDowngradeWarning(true);
      return;
    }
    
    proceedWithUpdate(v);
  };

  const confirmDowngrade = () => {
    if (!pendingVersion) return;
    setShowDowngradeWarning(false);
    const v = pendingVersion;
    setPendingVersion(null);
    proceedWithUpdate(v);
  };

  const proceedWithUpdate = async (v: VersionItem) => {
    const isRunning = selectedServer.status === 'online' || selectedServer.status === 'starting';
    const message = `Are you sure you want to change the server version to ${v.id}?${
      isRunning ? '\n\nThe server is currently running and will be stopped first, then restarted automatically.' : ''
    }`;
    
    if (!confirm(message)) return;

    setDownloadingVersion(v.id);
    setStatusMessage('Stopping server...');
    setDownloadProgress(0);

    try {
      // 1. Stop server if running
      if (isRunning) {
        await invoke('stop_mc_server', { id: selectedServer.id });
        // Poll status until it is offline
        let checks = 0;
        while (checks < 30) {
          await fetchServers();
          const s = useStore.getState().servers.find(s => s.id === selectedServer.id);
          if (s && s.status === 'offline') {
            break;
          }
          await new Promise(r => setTimeout(r, 1000));
          checks++;
        }
      }

      // 2. Download new jar (replacing the executable that runs the server)
      setStatusMessage(`Downloading ${selectedServer.server_type} jar...`);
      const jarName = selectedServer.jar_path || 'server.jar';
      const jarPath = `${selectedServer.install_path}\\${jarName}`;

      const unlisten = await listen<{downloaded: number, total: number}>('download-progress', (event) => {
        const { downloaded, total } = event.payload;
        setDownloadProgress((downloaded / total) * 100);
      });

      try {
        if (selectedServer.server_type === 'vanilla') {
          await invoke('download_mc_version', { url: v.url || '', path: jarPath });
        } else {
          await invoke('download_software', {
            serverType: selectedServer.server_type,
            version: v.id,
            path: jarPath
          });
        }
      } finally {
        unlisten();
      }

      // 3. Update DB
      setStatusMessage('Updating server profile...');
      await invoke('update_server_version_info', {
        id: selectedServer.id,
        version: v.id,
        jarPath: jarName
      });

      // 4. Accept EULA
      await invoke('accept_eula', { serverPath: selectedServer.install_path });

      // 5. Refresh servers list
      await fetchServers();

      // 6. Restart server if it was running
      if (isRunning) {
        setStatusMessage('Restarting server...');
        await invoke('start_mc_server', { id: selectedServer.id });
        await fetchServers();
      }

      notify(`Server updated to version ${v.id}.`, 'success');

    } catch (err: any) {
      console.error(err);
      notify(`Failed to update server version: ${err}`, 'error');
    } finally {
      setDownloadingVersion(null);
      setDownloadProgress(0);
      setStatusMessage('');
    }
  };

  const filteredVersions = versionsList.filter(v => {
    if (selectedServer.server_type === 'vanilla') {
      return filter === 'all' || v.type === filter;
    }
    return true; // No filter for paper/purpur
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full flex flex-col h-full">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-white mb-1">
          {selectedServer.server_type.toUpperCase()} Versions
        </h1>
        <p className="text-gray-400">View and download {selectedServer.server_type} server software.</p>
      </div>

      {selectedServer.server_type === 'vanilla' && (
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
      )}

      <div className="flex-1 overflow-y-auto bg-[#1c1d21] border border-[#2a2b2f] rounded-lg">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Loader2 size={32} className="animate-spin mb-4 text-blue-500" />
            <p>Fetching versions manifest...</p>
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
              {filteredVersions.map(v => (
                <tr key={v.id} className="hover:bg-[#202124] transition-colors">
                  <td className="px-6 py-4 font-medium text-white flex items-center gap-2">
                    {v.id}
                    {v.id === selectedServer.minecraft_version && (
                      <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-xs rounded-full">Current</span>
                    )}
                    {latestRelease === v.id && (
                      <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-xs rounded-full">Latest Release</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs rounded-md ${v.type === 'release' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-purple-500/10 text-purple-400'}`}>
                      {v.type}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-400 text-sm">
                    {v.releaseTime ? new Date(v.releaseTime).toLocaleDateString() : 'N/A'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      className="inline-flex items-center gap-2 bg-[#2a2b2f] hover:bg-[#3a3b3f] text-white px-3 py-1.5 rounded text-sm transition-colors"
                      onClick={() => handleDownload(v)}
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

      {showDowngradeWarning && pendingVersion && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-[#1c1d21] border border-red-500/20 p-8 rounded-lg shadow-2xl max-w-md w-full">
            <div className="flex items-center gap-3 text-red-400 mb-4">
              <AlertTriangle size={32} />
              <h2 className="text-xl font-bold text-white">Warning: Downgrade Detected</h2>
            </div>
            
            <p className="text-gray-300 text-sm mb-6 leading-relaxed">
              You are trying to downgrade your Minecraft server from version <strong className="text-white">{selectedServer.minecraft_version}</strong> to <strong className="text-white">{pendingVersion.id}</strong>. 
              Downgrading a world can cause severe corruption, lose loaded chunks, or crash the server.
              <br/><br/>
              Please ensure you have backed up your server files before continuing.
            </p>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowDowngradeWarning(false); setPendingVersion(null); }}
                className="px-4 py-2 bg-[#2a2b2f] hover:bg-[#3a3b3f] text-white rounded-md text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDowngrade}
                disabled={countdown > 0}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-950 disabled:text-red-500 text-white rounded-md text-sm font-medium transition-all"
              >
                {countdown > 0 ? `I Understand the Risks (${countdown}s)` : "I Understand the Risks"}
              </button>
            </div>
          </div>
        </div>
      )}

      {downloadingVersion && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-[#1c1d21] border border-[#2a2b2f] p-8 rounded-lg shadow-2xl max-w-md w-full flex flex-col items-center justify-center">
            <Loader2 size={48} className="animate-spin text-blue-500 mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Updating Server Version</h2>
            <p className="text-gray-400 text-sm mb-4">{statusMessage}</p>
            {downloadProgress > 0 && (
              <div className="w-full">
                <div className="h-2 w-full bg-[#2a2b2f] rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 transition-all duration-200" style={{ width: `${downloadProgress}%` }}></div>
                </div>
                <p className="text-center text-xs text-gray-500 mt-2">{Math.round(downloadProgress)}%</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
