import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { Database, Plus, Trash2, RotateCcw, Loader2 } from 'lucide-react';

interface BackupInfo {
  name: string;
  size: number;
  created_at: string;
}

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export default function Backups() {
  const { servers, selectedServerId, settings } = useStore();
  const selectedServer = servers.find(s => s.id === selectedServerId);

  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  useEffect(() => {
    if (selectedServer) {
      loadBackups();
    }
  }, [selectedServerId]);

  const loadBackups = async () => {
    if (!selectedServer) return;
    setLoading(true);
    try {
      const data = await invoke<BackupInfo[]>('list_mc_backups', { serverPath: selectedServer.install_path });
      setBackups(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!selectedServer) return;
    setActionInProgress('Creating backup...');
    try {
      const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await invoke('create_mc_backup', { serverPath: selectedServer.install_path, backupName: name });
      await loadBackups();
    } catch (err: any) {
      alert("Failed to create backup: " + err);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRestore = async (backupName: string) => {
    if (!selectedServer) return;
    if (selectedServer.status !== 'offline') {
      alert("You must stop the server before restoring a backup.");
      return;
    }

    if (!confirm(`Are you sure you want to restore ${backupName}? This will overwrite existing files.`)) return;

    setActionInProgress('Restoring backup...');
    try {
      await invoke('restore_mc_backup', { serverPath: selectedServer.install_path, backupName });
      alert("Backup restored successfully.");
    } catch (err: any) {
      alert("Failed to restore backup: " + err);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDelete = async (backupName: string) => {
    if (!selectedServer) return;
    
    if (settings?.confirm_delete) {
      if (!confirm(`Are you sure you want to delete ${backupName}?`)) return;
    }

    setActionInProgress('Deleting backup...');
    try {
      await invoke('remove_mc_backup', { serverPath: selectedServer.install_path, backupName });
      await loadBackups();
    } catch (err: any) {
      alert("Failed to delete backup: " + err);
    } finally {
      setActionInProgress(null);
    }
  };

  if (!selectedServer) {
    return <div className="p-8 text-center text-gray-500">Select a server from the sidebar.</div>;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto flex flex-col h-full">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Backups</h1>
          <p className="text-gray-400">Manage server backups.</p>
        </div>
        <button
          onClick={handleCreate}
          disabled={!!actionInProgress}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors disabled:opacity-50"
        >
          {actionInProgress === 'Creating backup...' ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
          Create Backup
        </button>
      </div>

      {actionInProgress && (
        <div className="mb-6 p-4 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-md flex items-center gap-3">
          <Loader2 size={20} className="animate-spin" />
          {actionInProgress}
        </div>
      )}

      <div className="flex-1 overflow-y-auto bg-[#1c1d21] border border-[#2a2b2f] rounded-lg">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Loader2 size={32} className="animate-spin mb-4 text-blue-500" />
            <p>Loading backups...</p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-[#141517] border-b border-[#2a2b2f] text-xs font-semibold text-gray-400 uppercase tracking-wider sticky top-0">
              <tr>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Size</th>
                <th className="px-6 py-4">Created</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2b2f]">
              {backups.map(backup => (
                <tr key={backup.name} className="hover:bg-[#202124] transition-colors group">
                  <td className="px-6 py-4 font-medium text-white flex items-center gap-3">
                    <Database size={18} className="text-blue-400" />
                    {backup.name}
                  </td>
                  <td className="px-6 py-4 text-gray-400">
                    {formatBytes(backup.size)}
                  </td>
                  <td className="px-6 py-4 text-gray-400 text-sm">
                    {new Date(parseInt(backup.created_at) * 1000).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleRestore(backup.name)}
                        disabled={!!actionInProgress || selectedServer.status !== 'offline'}
                        className="flex items-center gap-2 bg-[#2a2b2f] hover:bg-[#3a3b3f] text-gray-300 px-3 py-1.5 rounded text-sm transition-colors disabled:opacity-50"
                        title={selectedServer.status !== 'offline' ? "Stop server to restore" : "Restore this backup"}
                      >
                        <RotateCcw size={14} /> Restore
                      </button>
                      <button
                        onClick={() => handleDelete(backup.name)}
                        disabled={!!actionInProgress}
                        className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-[#2a2b2f] rounded transition-colors disabled:opacity-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {backups.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                    No backups found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
