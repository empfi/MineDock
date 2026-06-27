import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { Database, Plus, Trash2, RotateCcw, Loader2 } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';

interface BackupInfo { name: string; size: number; created_at: string; }

function formatBytes(bytes: number) {
  if (!bytes) return '0 Bytes';
  const units = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const unit = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${parseFloat((bytes / 1024 ** unit).toFixed(2))} ${units[unit]}`;
}

export default function Backups() {
  const { servers, selectedServerId, settings, backupJobs, backupRevision, createBackup, restoreBackup, deleteBackup } = useStore();
  const selectedServer = servers.find(server => server.id === selectedServerId);
  const serverId = selectedServer?.id;
  const actionInProgress = serverId ? backupJobs[serverId] : undefined;
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<{ type: 'restore' | 'delete'; name: string } | null>(null);

  const loadBackups = async () => {
    if (!selectedServer) return;
    setLoading(true);
    try { setBackups(await invoke<BackupInfo[]>('list_mc_backups', { serverPath: selectedServer.install_path })); }
    catch (error) { console.error(error); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (selectedServer) loadBackups(); }, [selectedServerId, serverId ? backupRevision[serverId] : 0]);

  const handleCreate = async () => {
    if (!selectedServer || !serverId) return;
    try { await createBackup(serverId, selectedServer.install_path); }
    catch (error) { alert('Failed to create backup: ' + error); }
  };

  const requestRestore = (name: string) => {
    if (selectedServer?.status !== 'offline') {
      alert('You must stop the server before restoring a backup.');
      return;
    }
    setPending({ type: 'restore', name });
  };

  const requestDelete = (name: string) => {
    if (settings?.confirm_delete) setPending({ type: 'delete', name });
    else runDelete(name);
  };

  const runRestore = async (name: string) => {
    if (!selectedServer || !serverId) return;
    setPending(null);
    try {
      await restoreBackup(serverId, selectedServer.install_path, name);
      alert('Backup restored successfully.');
    } catch (error) { alert('Failed to restore backup: ' + error); }
  };

  const runDelete = async (name: string) => {
    if (!selectedServer || !serverId) return;
    setPending(null);
    try { await deleteBackup(serverId, selectedServer.install_path, name); }
    catch (error) { alert('Failed to delete backup: ' + error); }
  };

  if (!selectedServer) return <div className="p-8 text-center text-gray-500">Select a server from the sidebar.</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full flex flex-col h-full">
      <div className="flex justify-between items-center mb-8">
        <div><h1 className="text-3xl font-bold tracking-tight text-white mb-1">Backups</h1><p className="text-gray-400">Manage server backups.</p></div>
        <button onClick={handleCreate} disabled={!!actionInProgress} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors disabled:opacity-50">
          {actionInProgress === 'Creating backup...' ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />} Create Backup
        </button>
      </div>

      {actionInProgress && <div className="mb-6 p-4 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-md flex items-center gap-3"><Loader2 size={20} className="animate-spin" />{actionInProgress}</div>}

      <div className="flex-1 overflow-y-auto bg-[#1c1d21] border border-[#2a2b2f] rounded-lg">
        {loading ? <div className="flex flex-col items-center justify-center h-64 text-gray-400"><Loader2 size={32} className="animate-spin mb-4 text-blue-500" /><p>Loading backups...</p></div> : (
          <table className="w-full text-left">
            <thead className="bg-[#141517] border-b border-[#2a2b2f] text-xs font-semibold text-gray-400 uppercase tracking-wider sticky top-0"><tr><th className="px-6 py-4">Name</th><th className="px-6 py-4">Size</th><th className="px-6 py-4">Created</th><th className="px-6 py-4 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-[#2a2b2f]">
              {backups.map(backup => (
                <tr key={backup.name} className="h-14 hover:bg-[#202124] transition-colors group">
                  <td className="px-6 py-4 font-medium text-white flex items-center gap-3"><Database size={18} className="text-blue-400" />{backup.name}</td>
                  <td className="px-6 py-4 text-gray-400">{formatBytes(backup.size)}</td>
                  <td className="px-6 py-4 text-gray-400 text-sm">{new Date(parseInt(backup.created_at) * 1000).toLocaleString()}</td>
                  <td className="px-6 py-4 text-right"><div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => requestRestore(backup.name)} disabled={!!actionInProgress || selectedServer.status !== 'offline'} className="flex items-center gap-2 bg-[#2a2b2f] hover:bg-[#3a3b3f] text-gray-300 px-3 py-1.5 rounded text-sm disabled:opacity-50"><RotateCcw size={14} /> Restore</button>
                    <button onClick={() => requestDelete(backup.name)} disabled={!!actionInProgress} className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-[#2a2b2f] rounded disabled:opacity-50"><Trash2 size={16} /></button>
                  </div></td>
                </tr>
              ))}
              {backups.length === 0 && <tr><td colSpan={4} className="px-6 py-12 text-center text-gray-500">No backups found.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {pending && <ConfirmDialog
        title={pending.type === 'restore' ? 'Restore backup?' : 'Delete backup?'}
        message={pending.type === 'restore' ? `${pending.name} will overwrite current server files.` : `${pending.name} will be permanently deleted.`}
        confirmLabel={pending.type === 'restore' ? 'Restore' : 'Delete'}
        danger={pending.type === 'delete'}
        onCancel={() => setPending(null)}
        onConfirm={() => pending.type === 'restore' ? runRestore(pending.name) : runDelete(pending.name)}
      />}
    </div>
  );
}