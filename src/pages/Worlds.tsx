import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  CheckCircle2, Download, FolderOpen, Globe2, Loader2,
  Pencil, Plus, RefreshCw, Trash2, Upload, X,
} from 'lucide-react';
import { useStore } from '../store';
import ConfirmDialog from '../components/ConfirmDialog';
import { notify } from '../components/Notifications';

type WorldInfo = {
  name: string;
  size: number;
  modified: number;
  active: boolean;
  ready: boolean;
  kind: 'overworld' | 'nether' | 'end';
};

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unit).toFixed(unit ? 1 : 0)} ${units[unit]}`;
};

export default function Worlds() {
  const { servers, selectedServerId } = useStore();
  const server = servers.find(item => item.id === selectedServerId);
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<'create' | 'rename' | null>(null);
  const [selected, setSelected] = useState<WorldInfo | null>(null);
  const [name, setName] = useState('');
  const [seed, setSeed] = useState('');
  const [worldType, setWorldType] = useState<WorldInfo['kind']>('overworld');
  const [deleting, setDeleting] = useState<WorldInfo | null>(null);
  const [pendingRestart, setPendingRestart] = useState(false);
  const [exportingWorld, setExportingWorld] = useState<string | null>(null);
  const [importingWorld, setImportingWorld] = useState(false);

  const stopped = server?.status === 'offline' || server?.status === 'crashed';
  const validName = !!name.trim() && !/[<>:"/\\|?*]/.test(name);
  const matchingOverworld = worldType === 'overworld' || worlds.some(world => world.kind === 'overworld' && world.name === name.trim());

  const load = async () => {
    if (!server) return;
    setLoading(true);
    try {
      setWorlds(await invoke<WorldInfo[]>('get_worlds', { serverPath: server.install_path }));
    } catch (cause) {
      notify(`Could not load worlds: ${cause}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); setPendingRestart(false); }, [selectedServerId]);

  const autoBackup = async (label: string) => {
    if (!server) return;
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      await invoke('create_mc_backup', {
        serverPath: server.install_path,
        backupName: `pre-world-op-${label}-${ts}`,
      });
      notify(`Auto-backup created before ${label}.`, 'success');
    } catch (cause) {
      notify(`Auto-backup failed (continuing anyway): ${cause}`, 'warning');
    }
  };

  const create = async () => {
    if (!server || !stopped || !validName) return;
    try {
      await invoke('create_server_world', { serverPath: server.install_path, name: name.trim(), seed: seed.trim(), kind: worldType });
      notify(`${worldType === 'overworld' ? name.trim() : `${name.trim()} ${worldType}`} will generate when loaded.`, 'success');
      if (worldType === 'overworld') setPendingRestart(true);
      setForm(null); setName(''); setSeed(''); load();
    } catch (cause) { notify(String(cause), 'error'); }
  };

  const rename = async () => {
    if (!server || !selected || !stopped || !validName) return;
    try {
      await invoke('rename_server_world', { serverPath: server.install_path, oldName: selected.name, newName: name.trim() });
      notify('World renamed.', 'success');
      setForm(null); setSelected(null); setName(''); load();
    } catch (cause) { notify(String(cause), 'error'); }
  };

  const activate = async (world: WorldInfo) => {
    if (!server || !stopped || world.active) return;
    await autoBackup('activate');
    try {
      await invoke('activate_server_world', { serverPath: server.install_path, name: world.name });
      notify(`${world.name} is now the primary world. Restart server to load it.`, 'success');
      setPendingRestart(true);
      load();
    } catch (cause) { notify(String(cause), 'error'); }
  };

  const remove = async () => {
    if (!server || !deleting || !stopped) return;
    await autoBackup('delete');
    try {
      await invoke('delete_server_world', { serverPath: server.install_path, name: deleting.name });
      notify(`${deleting.name} deleted.`, 'success');
      setDeleting(null); load();
    } catch (cause) { notify(String(cause), 'error'); }
  };

  const exportWorld = async (world: WorldInfo) => {
    if (!server) return;
    setExportingWorld(world.name);
    try {
      const zipPath = await invoke<string>('export_server_world', { serverPath: server.install_path, name: world.name });
      notify(`Exported to: ${zipPath}`, 'success');
      await revealItemInDir(zipPath);
    } catch (cause) {
      notify(`Export failed: ${cause}`, 'error');
    } finally {
      setExportingWorld(null);
    }
  };

  const importWorld = async () => {
    if (!server || !stopped) return;
    setImportingWorld(true);
    try {
      const selected = await open({ multiple: false, filters: [{ name: 'World ZIP', extensions: ['zip'] }] });
      if (!selected) return;
      const zipPath = selected;
      const worldName = await invoke<string>('import_server_world', { serverPath: server.install_path, zipPath });
      notify(`World "${worldName}" imported successfully.`, 'success');
      load();
    } catch (cause) {
      notify(`Import failed: ${cause}`, 'error');
    } finally {
      setImportingWorld(false);
    }
  };

  if (!server) return <div className="p-8 text-center text-gray-500">Select a server first.</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-7">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Worlds</h1>
          <p className="text-gray-400">Manage worlds for {server.name}.</p>
        </div>
        <div className="flex items-center gap-2">
          <span title={!stopped ? 'Stop server before importing worlds.' : 'Import world from ZIP'} className={!stopped ? 'cursor-help' : ''}>
            <button
              disabled={!stopped || importingWorld}
              onClick={importWorld}
              className="flex items-center gap-2 rounded-md bg-[#2a2b2f] border border-[#3a3b3f] px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-[#3a3b3f] disabled:cursor-help disabled:opacity-40 transition-colors"
            >
              {importingWorld ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              Import World
            </button>
          </span>
          <span title={!stopped ? 'Stop server before creating worlds.' : 'Create world'} className={!stopped ? 'cursor-help' : ''}>
            <button
              disabled={!stopped}
              onClick={() => { setForm('create'); setName(''); setSeed(''); setWorldType('overworld'); }}
              className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-help disabled:opacity-40 transition-colors"
            >
              <Plus size={17} /> New World
            </button>
          </span>
        </div>
      </div>

      {/* Server-running warning */}
      {!stopped && (
        <div className="mb-5 rounded-md border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          Stop server to create, activate, rename, or delete worlds.
        </div>
      )}

      {/* Pending restart banner */}
      {pendingRestart && (
        <div className="mb-5 flex items-center justify-between rounded-md border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-300">
          <div className="flex items-center gap-2">
            <RefreshCw size={15} />
            Restart required to apply primary world change.
          </div>
          <button onClick={() => setPendingRestart(false)} className="text-blue-400 hover:text-white">
            <X size={14} />
          </button>
        </div>
      )}

      {loading && !worlds.length ? (
        <div className="flex justify-center py-20 text-gray-500"><Loader2 className="animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {worlds.map(world => (
            <article key={world.name} className="rounded-lg border border-[#2a2b2f] bg-[#1c1d21] p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-3 min-w-0">
                  <div className={`rounded-md p-2.5 ${world.kind === 'nether' ? 'bg-red-500/10 text-red-400' : world.kind === 'end' ? 'bg-yellow-100/10 text-yellow-100' : world.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-blue-500/10 text-blue-400'}`}>
                    <Globe2 size={22} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-semibold text-white truncate">{world.name}</h2>
                    <p className="text-xs text-gray-500 mt-1 capitalize">
                      {world.kind} · {world.ready ? `${formatBytes(world.size)} · ${new Date(world.modified * 1000).toLocaleString()}` : 'Generates on next start'}
                    </p>
                    {/* Generation progress indicator for pending worlds */}
                    {!world.ready && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="h-1 w-24 rounded-full bg-[#2a2b2f] overflow-hidden">
                          <div className="h-full w-1/3 rounded-full bg-blue-500 animate-pulse" />
                        </div>
                        <span className="text-[10px] text-gray-600">Pending generation</span>
                      </div>
                    )}
                  </div>
                </div>
                {world.active && (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400 whitespace-nowrap">
                    <CheckCircle2 size={12} /> Primary world
                  </span>
                )}
              </div>

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                {/* Open folder */}
                <button
                  onClick={() => revealItemInDir(`${server.install_path}\\${world.name}`)}
                  className="p-2 text-gray-400 hover:text-white transition-colors"
                  title="Open world folder"
                >
                  <FolderOpen size={16} />
                </button>

                {/* Export */}
                <button
                  onClick={() => exportWorld(world)}
                  disabled={exportingWorld === world.name}
                  className="flex items-center gap-1.5 rounded-md bg-[#2a2b2f] px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-[#3a3b3f] disabled:opacity-40 transition-colors"
                  title="Export world as ZIP"
                >
                  {exportingWorld === world.name ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  Export
                </button>

                {/* Overworld-only actions */}
                {world.kind === 'overworld' && (
                  <>
                    <span title={!stopped ? 'Stop server before renaming worlds.' : 'Rename world'} className={!stopped ? 'cursor-help' : ''}>
                      <button
                        disabled={!stopped}
                        onClick={() => { setSelected(world); setName(world.name); setForm('rename'); }}
                        className="p-2 text-gray-400 hover:text-white disabled:cursor-help disabled:opacity-40 transition-colors"
                      >
                        <Pencil size={16} />
                      </button>
                    </span>

                    {!world.active && (
                      <span title={!stopped ? 'Stop server before switching worlds.' : 'Set as primary world'} className={!stopped ? 'cursor-help' : ''}>
                        <button
                          disabled={!stopped}
                          onClick={() => activate(world)}
                          className="rounded-md bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-400 hover:bg-emerald-500/20 disabled:cursor-help disabled:opacity-40 transition-colors"
                        >
                          Set Primary
                        </button>
                      </span>
                    )}

                    <span
                      title={world.active ? 'Primary world cannot be deleted. Set another world as primary first.' : !stopped ? 'Stop server before deleting worlds.' : 'Delete world permanently'}
                      className={world.active || !stopped ? 'cursor-help' : ''}
                    >
                      <button
                        disabled={world.active || !stopped}
                        onClick={() => setDeleting(world)}
                        className="p-2 text-gray-500 hover:text-red-400 disabled:cursor-help disabled:opacity-40 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </span>
                  </>
                )}
              </div>
            </article>
          ))}
          {!worlds.length && (
            <div className="xl:col-span-2 rounded-lg border border-dashed border-[#2a2b2f] py-16 text-center text-gray-500">
              No generated worlds found.
            </div>
          )}
        </div>
      )}

      {/* Create / Rename modal */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <section className="w-full max-w-md rounded-lg border border-[#34353a] bg-[#1c1d21] shadow-2xl">
            <header className="flex items-center justify-between border-b border-[#2a2b2f] p-5">
              <h2 className="font-semibold text-white">{form === 'create' ? 'Create world' : 'Rename world'}</h2>
              <button onClick={() => setForm(null)} className="text-gray-500 hover:text-white"><X size={18} /></button>
            </header>
            <div className="space-y-4 p-5">
              {form === 'create' && (
                <label className="block">
                  <span className="mb-1.5 block text-sm text-gray-400">World type</span>
                  <select
                    value={worldType}
                    onChange={event => setWorldType(event.target.value as WorldInfo['kind'])}
                    className="w-full rounded-md border border-[#2a2b2f] bg-[#0f0f11] px-3 py-2.5 text-white outline-none focus:border-blue-500"
                  >
                    <option value="overworld">Overworld</option>
                    <option value="nether">Nether</option>
                    <option value="end">The End</option>
                  </select>
                </label>
              )}
              <label className="block">
                <span className="mb-1.5 block text-sm text-gray-400">
                  {form === 'create' && worldType !== 'overworld' ? 'Matching overworld name' : 'World name'}
                </span>
                <input
                  autoFocus
                  value={name}
                  onChange={event => setName(event.target.value)}
                  list={worldType !== 'overworld' ? 'overworld-names' : undefined}
                  className="w-full rounded-md border border-[#2a2b2f] bg-[#0f0f11] px-3 py-2.5 text-white outline-none focus:border-blue-500"
                />
                {worldType !== 'overworld' && (
                  <datalist id="overworld-names">
                    {worlds.filter(world => world.kind === 'overworld').map(world => (
                      <option key={world.name} value={world.name} />
                    ))}
                  </datalist>
                )}
              </label>
              {form === 'create' && worldType === 'overworld' && (
                <label className="block">
                  <span className="mb-1.5 block text-sm text-gray-400">Seed <span className="text-gray-600">(optional)</span></span>
                  <input
                    value={seed}
                    onChange={event => setSeed(event.target.value)}
                    className="w-full rounded-md border border-[#2a2b2f] bg-[#0f0f11] px-3 py-2.5 text-white outline-none focus:border-blue-500"
                  />
                </label>
              )}
              {form === 'create' && worldType !== 'overworld' && !matchingOverworld && (
                <p className="text-xs text-amber-400">Choose an existing overworld. Minecraft links dimensions by world name.</p>
              )}
            </div>
            <footer className="flex justify-end gap-2 border-t border-[#2a2b2f] bg-[#141517] p-4">
              <button onClick={() => setForm(null)} className="px-4 py-2 text-sm text-gray-300">Cancel</button>
              <span
                title={!validName ? 'Enter a valid world folder name.' : !matchingOverworld ? 'Choose an existing overworld.' : ''}
                className={!validName || !matchingOverworld ? 'cursor-help' : ''}
              >
                <button
                  disabled={!validName || !matchingOverworld}
                  onClick={form === 'create' ? create : rename}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-help disabled:opacity-40"
                >
                  {form === 'create' ? 'Create' : 'Rename'}
                </button>
              </span>
            </footer>
          </section>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete world?"
          message={`${deleting.name} and its Nether/End dimensions will be permanently deleted. An automatic backup will be created first.`}
          confirmLabel="Delete world"
          onCancel={() => setDeleting(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}
