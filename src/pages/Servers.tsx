import { useState } from 'react';
import { useStore } from '../store';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Play, Square, Trash2, FolderOpen, Settings as SettingsIcon, Upload, Loader2, Search } from 'lucide-react';
import { Server } from '../types';
import ConfirmDialog from '../components/ConfirmDialog';
import { notify } from '../components/Notifications';

export default function Servers() {
  const { servers, fetchServers, setSelectedServer, settings } = useStore();
  const [pending, setPending] = useState<{ action: 'stop' | 'delete'; server: Server } | null>(null);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const navigate = useNavigate();

  // Import Server state
  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [importDir, setImportDir] = useState('');
  const [importJars, setImportJars] = useState<string[]>([]);
  const [detectedImportFields, setDetectedImportFields] = useState({ serverType: false, version: false, jar: false });
  const [importForm, setImportForm] = useState({
    name: '',
    serverType: 'vanilla',
    version: '',
    port: 25565,
    ramMin: 1024,
    ramMax: 4096,
    javaPath: 'java',
    selectedJar: 'server.jar',
  });

  const browseImportDir = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || typeof selected !== 'string') return;
    setImportDir(selected);
    setScanning(true);
    try {
      const result = await invoke<{
        jar_files: string[];
        detected_port: number | null;
        server_properties_exists: boolean;
        detected_server_type: string | null;
        detected_version: string | null;
        detected_jar: string | null;
      }>(
        'scan_directory_for_import',
        { directoryPath: selected }
      );
      setImportJars(result.jar_files);
      setDetectedImportFields({
        serverType: Boolean(result.detected_server_type),
        version: Boolean(result.detected_version),
        jar: Boolean(result.detected_jar),
      });
      setImportForm(f => {
        const parts = selected.split(/[\\/]/);
        let detectedPort = result.detected_port ?? 25565;
        while (servers.some(server => server.port === detectedPort)) detectedPort++;
        return {
          ...f,
          name: parts[parts.length - 1] || '',
          port: detectedPort,
          serverType: result.detected_server_type ?? f.serverType,
          version: result.detected_version ?? f.version,
          selectedJar: result.detected_jar ?? result.jar_files[0] ?? 'server.jar',
        };
      });
    } catch (err) {
      console.error(err);
    } finally {
      setScanning(false);
    }
  };

  const handleImport = async () => {
    if (!importDir || !importForm.name) return;
    setImporting(true);
    try {
      const newServer = {
        name: importForm.name,
        server_type: importForm.serverType,
        minecraft_version: importForm.version || 'unknown',
        install_path: importDir,
        jar_path: importForm.selectedJar,
        status: 'offline',
        ram_min: importForm.ramMin,
        ram_max: importForm.ramMax,
        java_path: importForm.javaPath,
        created_at: new Date().toISOString(),
        port: importForm.port,
      };
      await invoke('create_new_server', { server: newServer });
      await fetchServers();
      setShowImport(false);
      setImportDir('');
      setImportJars([]);
      setDetectedImportFields({ serverType: false, version: false, jar: false });
    } catch (err: any) {
      notify('Import failed: ' + err, 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleStart = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    try {
      await invoke('start_mc_server', { id });
    } catch (err) {
      console.error(err);
    }
  };

  const stopServer = async (id: number) => {
    try { await invoke('stop_mc_server', { id }); }
    catch (err) { console.error(err); }
  };

  const handleStop = (e: React.MouseEvent, server: Server) => {
    e.stopPropagation();
    if (settings?.confirm_stop) setPending({ action: 'stop', server });
    else stopServer(server.id!);
  };

  const deleteServer = async (server: Server) => {
    try {
      if (deleteFiles) {
        await invoke('delete_server_files', { serverPath: server.install_path });
      }
      await invoke('remove_server', { id: server.id });
      setPending(null);
      setDeleteFiles(false);
      fetchServers();
    } catch (err) { console.error(err); }
  };

  const handleDelete = (e: React.MouseEvent, server: Server) => {
    e.stopPropagation();
    if (settings?.confirm_delete) {
      setPending({ action: 'delete', server });
      setDeleteFiles(false);
    }
    else deleteServer(server);
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
    <div className="p-4 sm:p-6 lg:p-8 w-full">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Servers</h1>
          <p className="text-gray-400">Manage your local Minecraft servers.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 bg-[#1c1d21] hover:bg-[#2a2b2f] border border-[#2a2b2f] text-gray-300 px-4 py-2 rounded-md font-medium transition-colors"
          >
            <Upload size={16} /> Import Server
          </button>
          <button
            id="tour-create-server"
            onClick={() => navigate('/wizard')}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors"
          >
            Create Server
          </button>
        </div>
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
            {servers.map((server: Server, index: number) => (
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
                  <div className="flex flex-col gap-1 items-start">
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
                    {server.install_path_exists === false && (
                      <span className="inline-flex items-center text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded mt-1.5 uppercase tracking-wider">
                        Folder Missing
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 text-gray-300">
                  {server.minecraft_version}
                </td>
                <td className="px-6 py-4 text-gray-300">
                  {server.port}
                </td>
                <td className="px-6 py-4 text-right">
                  <div 
                    id={index === 0 ? "tour-start-server-container" : undefined}
                    className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {server.status === 'offline' || server.status === 'crashed' ? (
                      <button 
                        onClick={(e) => handleStart(e, server.id!)}
                        disabled={server.install_path_exists === false}
                        className="p-1.5 text-gray-400 hover:text-emerald-400 hover:bg-[#2a2b2f] rounded disabled:opacity-30 disabled:cursor-not-allowed"
                        title={server.install_path_exists === false ? "Folder Missing" : "Start Server"}
                      >
                        <Play size={18} />
                      </button>
                    ) : (
                      <button 
                        onClick={(e) => handleStop(e, server)}
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
                      onClick={(e) => handleDelete(e, server)}
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
      {pending && <ConfirmDialog
        title={pending.action === 'stop' ? 'Stop server?' : 'Delete server profile?'}
        message={pending.action === 'stop' ? `${pending.server.name} will disconnect all connected players.` : `${pending.server.name} will be removed from MineDock.`}
        confirmLabel={pending.action === 'stop' ? 'Stop' : 'Delete'}
        checkboxLabel={pending.action === 'delete' ? 'Delete all server files from disk' : undefined}
        checkboxValue={deleteFiles}
        onCheckboxChange={setDeleteFiles}
        onCancel={() => { setPending(null); setDeleteFiles(false); }}
        onConfirm={() => pending.action === 'stop' ? (setPending(null), stopServer(pending.server.id!)) : deleteServer(pending.server)}
      />}

      {/* Import Server Modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#1c1d21] border border-[#2a2b2f] rounded-xl shadow-2xl w-full max-w-lg mx-4">
            <div className="p-6 border-b border-[#2a2b2f]">
              <h2 className="text-xl font-bold text-white">Import Existing Server</h2>
              <p className="text-gray-400 text-sm mt-1">Register an existing Minecraft server folder into MineDock.</p>
            </div>
            <div className="p-6 space-y-4">
              {/* Directory Picker */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Server Folder</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={importDir}
                    placeholder="Click Browse to select a folder..."
                    className="flex-1 bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2 text-gray-300 text-sm"
                  />
                  <button
                    onClick={browseImportDir}
                    disabled={scanning}
                    className="flex items-center gap-2 px-3 py-2 bg-[#2a2b2f] hover:bg-[#3a3b3f] text-white rounded-md text-sm transition-colors disabled:opacity-60"
                  >
                    {scanning ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                    Browse
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Server Name</label>
                  <input
                    type="text"
                    value={importForm.name}
                    onChange={e => setImportForm(f => ({...f, name: e.target.value}))}
                    className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Server Port</label>
                  <input
                    type="number"
                    value={importForm.port}
                    onChange={e => setImportForm(f => ({...f, port: parseInt(e.target.value) || 25565}))}
                    className={`w-full bg-[#0f0f11] border rounded-md px-3 py-2 text-white text-sm focus:outline-none ${servers.some(server => server.port === importForm.port) ? 'border-red-500' : 'border-[#2a2b2f] focus:border-blue-500'}`}
                  />
                  {servers.some(server => server.port === importForm.port) && (
                    <p className="mt-1 text-xs text-red-400">Port {importForm.port} belongs to another server. Every local and tunneled server needs a unique port.</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Server Type</label>
                  <select
                    value={importForm.serverType}
                    onChange={e => setImportForm(f => ({...f, serverType: e.target.value}))}
                    disabled={detectedImportFields.serverType}
                    className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 appearance-none disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="vanilla">Vanilla</option>
                    <option value="paper">Paper</option>
                    <option value="purpur">Purpur</option>
                    <option value="velocity">Velocity</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">MC Version</label>
                  <input
                    type="text"
                    value={importForm.version}
                    onChange={e => setImportForm(f => ({...f, version: e.target.value}))}
                    disabled={detectedImportFields.version}
                    placeholder="e.g. 1.21.4"
                    className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Executable Jar</label>
                  {importJars.length > 0 ? (
                    <select
                      value={importForm.selectedJar}
                      onChange={e => setImportForm(f => ({...f, selectedJar: e.target.value}))}
                      disabled={detectedImportFields.jar}
                      className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 appearance-none disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {importJars.map(j => <option key={j} value={j}>{j}</option>)}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={importForm.selectedJar}
                      onChange={e => setImportForm(f => ({...f, selectedJar: e.target.value}))}
                      disabled={detectedImportFields.jar}
                      placeholder="server.jar"
                      className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 font-mono disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Java Path</label>
                  <input
                    type="text"
                    value={importForm.javaPath}
                    onChange={e => setImportForm(f => ({...f, javaPath: e.target.value}))}
                    className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>
            </div>
            <div className="p-6 border-t border-[#2a2b2f] flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowImport(false);
                  setImportDir('');
                  setImportJars([]);
                  setDetectedImportFields({ serverType: false, version: false, jar: false });
                }}
                className="px-4 py-2 bg-[#2a2b2f] hover:bg-[#3a3b3f] text-white rounded-md text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={!importDir || !importForm.name || importing || servers.some(server => server.port === importForm.port)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
              >
                {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Import Server
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
