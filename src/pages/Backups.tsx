import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { Database, Plus, Trash2, RotateCcw, Loader2, ShieldCheck } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import { notify } from '../components/Notifications';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { ListSkeleton } from '../components/LoadingState';

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
  const actionInProgress = serverId != null ? backupJobs[serverId] : undefined;

  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<{ type: 'restore' | 'delete'; name: string } | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newBackupName, setNewBackupName] = useState('');
  const [verifying, setVerifying] = useState('');
  const [verified, setVerified] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState(() => localStorage.getItem('minedock:backups_query') || '');
  const [sort, setSort] = useState(() => localStorage.getItem('minedock:backups_sort') || 'newest');

  // Use a ref to track the current load request so stale calls don't flip loading back on
  const loadingRef = useRef(false);

  const loadBackups = async () => {
    if (!selectedServer || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setLoadError('');
    try {
      const result = await invoke<BackupInfo[]>('list_mc_backups', { serverPath: selectedServer.install_path });
      setBackups(result);
    } catch (error) {
      setLoadError(String(error));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  // Re-load whenever server changes OR after a create/delete (backupRevision bumps)
  const revision = serverId != null ? (backupRevision[serverId] ?? 0) : 0;
  useEffect(() => {
    if (selectedServer) {
      loadingRef.current = false; // reset guard on server/revision change
      loadBackups();
    }
  }, [selectedServerId, revision]);

  const startCreateBackup = () => {
    setNewBackupName('');
    setShowCreateDialog(true);
  };

  const handleConfirmCreate = async () => {
    if (!selectedServer || serverId == null) return;
    setShowCreateDialog(false);
    try { await createBackup(serverId, selectedServer.install_path, newBackupName); }
    catch (error) { notify('Failed to create backup: ' + error, 'error'); }
  };

  const requestRestore = (name: string) => {
    if (selectedServer?.status !== 'offline') {
      notify('You must stop the server before restoring a backup.', 'warning');
      return;
    }
    setPending({ type: 'restore', name });
  };

  const requestDelete = (name: string) => {
    if (settings?.confirm_delete) setPending({ type: 'delete', name });
    else runDelete(name);
  };

  const runRestore = async (name: string) => {
    if (!selectedServer || serverId == null) return;
    setPending(null);
    try {
      await restoreBackup(serverId, selectedServer.install_path, name);
      notify('Backup restored successfully.', 'success');
    } catch (error) { notify('Failed to restore backup: ' + error, 'error'); }
  };

  const runDelete = async (name: string) => {
    if (!selectedServer || serverId == null) return;
    setPending(null);
    try { await deleteBackup(serverId, selectedServer.install_path, name); }
    catch (error) { notify('Failed to delete backup: ' + error, 'error'); }
  };

  const verify = async (name: string) => {
    if (!selectedServer) return;
    setVerifying(name);
    try {
      const result = await invoke<{ files: number; uncompressed_size: number }>('verify_mc_backup', {
        serverPath: selectedServer.install_path, backupName: name,
      });
      setVerified(current => ({ ...current, [name]: `${result.files} files · ${formatBytes(result.uncompressed_size)}` }));
      notify('Backup verified.', 'success', false);
    } catch (error) {
      setVerified(current => ({ ...current, [name]: 'Invalid' }));
      notify(`Backup verification failed: ${error}`, 'error');
    } finally {
      setVerifying('');
    }
  };

  if (!selectedServer) return <div className="p-8 text-center text-gray-500">Select a server from the sidebar.</div>;
  const visibleBackups = backups
    .filter(backup => backup.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'size' ? b.size - a.size : Number(b.created_at) - Number(a.created_at));

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full flex flex-col h-full">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Backups</h1>
          <p className="text-gray-400">Manage server backups.</p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={startCreateBackup}
            disabled={!!actionInProgress}
            title={actionInProgress || 'Create a new backup'}
            className="action-button bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {actionInProgress ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
            <span>{actionInProgress ? actionInProgress.replace('...', '') : 'Create Backup'}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-[#1c1d21] border border-[#2a2b2f] rounded-lg">
        <div className="flex items-center gap-2 border-b border-[#2a2b2f] p-3">
          <input value={query} onChange={event => { setQuery(event.target.value); localStorage.setItem('minedock:backups_query', event.target.value); }} placeholder="Search backups…" className="flex-1 rounded-md border border-[#2a2b2f] bg-[#0f0f11] px-3 py-2 text-sm text-white outline-none focus:border-blue-500" />
          <select value={sort} onChange={event => { setSort(event.target.value); localStorage.setItem('minedock:backups_sort', event.target.value); }} className="rounded-md border border-[#2a2b2f] bg-[#0f0f11] px-3 py-2 text-sm text-gray-300"><option value="newest">Newest</option><option value="name">Name</option><option value="size">Largest</option></select>
          <span className="min-w-20 text-right text-xs text-gray-500">{visibleBackups.length} results</span>
        </div>
        {loading && !backups.length ? (
          <ListSkeleton />
        ) : loadError ? (
          <div className="p-4"><ErrorState title="Could not load backups" description="MineDock could not read this server’s backup folder." details={loadError} primaryAction={{ label: 'Retry', onClick: loadBackups }} /></div>
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
              {visibleBackups.map(backup => (
                <tr key={backup.name} className="h-14 hover:bg-[#202124] transition-colors group">
                  <td className="px-6 py-4 font-medium text-white flex items-center gap-3">
                    <Database size={18} className="text-blue-400" />
                    {backup.name}
                    {verified[backup.name] && <span className={verified[backup.name] === 'Invalid' ? 'text-xs text-red-400' : 'text-xs text-emerald-400'}>{verified[backup.name]}</span>}
                  </td>
                  <td className="px-6 py-4 text-gray-400">{formatBytes(backup.size)}</td>
                  <td className="px-6 py-4 text-gray-400 text-sm">
                    {new Date(parseInt(backup.created_at) * 1000).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => verify(backup.name)} disabled={!!actionInProgress || verifying === backup.name} className="p-1.5 text-gray-500 hover:text-emerald-400 hover:bg-[#2a2b2f] rounded disabled:opacity-50" title="Verify backup">
                        {verifying === backup.name ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                      </button>
                      <button
                        onClick={() => requestRestore(backup.name)}
                        disabled={!!actionInProgress || selectedServer.status !== 'offline'}
                        title={actionInProgress || (selectedServer.status !== 'offline' ? 'Stop the server before restoring a backup' : 'Restore this backup')}
                        className="action-button bg-[#2a2b2f] px-3 py-1.5 text-sm text-gray-300 hover:bg-[#3a3b3f] disabled:opacity-50"
                        style={{ '--action-width': '6.75rem' } as React.CSSProperties}
                      >
                        {actionInProgress?.startsWith('Restoring') ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Restore
                      </button>
                      <button
                        onClick={() => requestDelete(backup.name)}
                        disabled={!!actionInProgress}
                        className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-[#2a2b2f] rounded disabled:opacity-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {visibleBackups.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4"><EmptyState icon={Database} title={backups.length ? 'No matching backups' : 'No backups yet'} description={backups.length ? 'Clear the search to see every backup.' : 'Create a restore point before changing versions, worlds, or additions.'} action={backups.length ? 'Clear search' : 'Create backup'} onAction={backups.length ? () => { setQuery(''); localStorage.removeItem('minedock:backups_query'); } : startCreateBackup} /></td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {pending && (
        <ConfirmDialog
          title={pending.type === 'restore' ? 'Restore backup?' : 'Delete backup?'}
          message={
            pending.type === 'restore'
              ? `${pending.name} will overwrite current server files.`
              : `${pending.name} will be permanently deleted.`
          }
          confirmLabel={pending.type === 'restore' ? 'Restore' : 'Delete'}
          danger={pending.type === 'delete'}
          onCancel={() => setPending(null)}
          onConfirm={() => pending.type === 'restore' ? runRestore(pending.name) : runDelete(pending.name)}
        />
      )}

      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-lg border border-[#2a2b2f] bg-[#1c1d21] shadow-xl">
            <div className="flex flex-col gap-3 p-5">
              <h2 className="font-semibold text-white text-lg">Create Server Backup</h2>
              <p className="text-sm text-gray-400">Specify a name for your backup, or leave it blank to auto-generate a timestamped name.</p>
              <input
                type="text"
                autoFocus
                placeholder="e.g. Before installing mods"
                value={newBackupName}
                onChange={e => setNewBackupName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleConfirmCreate();
                  if (e.key === 'Escape') setShowCreateDialog(false);
                }}
                className="mt-2 w-full rounded border border-[#2a2b2f] bg-[#0f0f11] px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-[#2a2b2f] bg-[#141517] p-4">
              <button
                type="button"
                onClick={() => setShowCreateDialog(false)}
                className="rounded-md bg-[#2a2b2f] px-4 py-2 text-sm text-white hover:bg-[#3a3b3f]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmCreate}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
