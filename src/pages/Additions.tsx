import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ChevronLeft, ChevronRight, Download, Loader2, Package, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { useStore } from '../store';
import { notify } from '../components/Notifications';

type InstalledPlugin = { file_name: string; name: string; version: string; description: string; enabled: boolean; icon_url?: string; source?: string; project_id?: string; latest_version?: string; update_available: boolean };
type MarketplacePlugin = { source: string; id: string; name: string; description: string; icon_url?: string; downloads: number };
type MarketplaceVersion = { version: string; published: string };

const updateChecks = new Map<string, number>();
const installedCache = new Map<string, InstalledPlugin[]>();
const updateCheckTtl = 15 * 60 * 1000;

function cleanVersion(v: string): string {
  let cleaned = v.trim().toLowerCase();
  if (cleaned.startsWith('v')) {
    cleaned = cleaned.substring(1);
  }
  const dashIdx = cleaned.indexOf('-');
  if (dashIdx !== -1) {
    cleaned = cleaned.substring(0, dashIdx).trim();
  }
  const plusIdx = cleaned.indexOf('+');
  if (plusIdx !== -1) {
    cleaned = cleaned.substring(0, plusIdx).trim();
  }
  return cleaned;
}

function isUpdateAvailable(installed: string, latest: string): boolean {
  const instClean = cleanVersion(installed);
  const latClean = cleanVersion(latest);
  if (!instClean || !latClean) return false;
  if (instClean === latClean) return false;
  if (instClean.includes(latClean) || latClean.includes(instClean)) return false;
  return true;
}



export default function Additions() {
  const { servers, selectedServerId } = useStore();
  const server = servers.find(item => item.id === selectedServerId);
  const [tab, setTab] = useState<'installed' | 'marketplace'>('installed');
  const [installed, setInstalledState] = useState<InstalledPlugin[]>([]);
  const [results, setResults] = useState<MarketplacePlugin[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [pluginBusy, setPluginBusy] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatePlugin, setUpdatePlugin] = useState<InstalledPlugin | null>(null);
  const [versions, setVersions] = useState<MarketplaceVersion[]>([]);
  const [versionSearch, setVersionSearch] = useState('');
  const [versionsLoading, setVersionsLoading] = useState(false);

  // Filter state
  const [projectType, setProjectType] = useState<'plugin' | 'mod' | 'modpack'>('plugin');

  const setInstalled = (update: InstalledPlugin[] | ((prev: InstalledPlugin[]) => InstalledPlugin[])) => {
    setInstalledState(prev => {
      const next = typeof update === 'function' ? update(prev) : update;
      if (server) {
        installedCache.set(server.install_path, next);
      }
      return next;
    });
  };

  const loadInstalled = async (showLoading = true) => {
    if (!server) return;
    if (showLoading) setLoading(true);
    try {
      const fresh = await invoke<InstalledPlugin[]>('get_installed_plugins', { serverPath: server.install_path });
      setInstalled(current => fresh.map(plugin => {
        const known = current.find(item => item.file_name === plugin.file_name || item.name === plugin.name);
        const resolvedVersion = plugin.version === 'Unknown' && known ? known.version : plugin.version;
        return known ? {
          ...plugin,
          version: resolvedVersion,
          description: plugin.description || known.description,
          icon_url: known.icon_url,
          source: known.source,
          project_id: known.project_id,
          latest_version: known.latest_version,
          update_available: !!known.latest_version && isUpdateAvailable(resolvedVersion, known.latest_version),
        } : plugin;
      }));
    }
    catch (error) { notify(`Could not load plugins: ${error}`, 'error'); }
    finally { if (showLoading) setLoading(false); }
  };

  const checkUpdates = async (force = false) => {
    if (!server) return;
    const lastCheck = updateChecks.get(server.install_path) ?? 0;
    if (!force && (Date.now() - lastCheck < updateCheckTtl)) return;
    updateChecks.set(server.install_path, Date.now());
    setCheckingUpdates(true);
    try {
      await invoke('check_plugin_updates', { serverPath: server.install_path, minecraftVersion: server.minecraft_version });
    } catch (error) {
      updateChecks.delete(server.install_path);
      notify(`Update check failed: ${error}`, 'error');
    } finally {
      setCheckingUpdates(false);
    }
  };

  const openWebsite = async (plugin: { source?: string; project_id?: string; id?: string }) => {
    const src = plugin.source;
    const id = plugin.project_id || plugin.id;
    if (!src || !id) return;
    
    let url = '';
    if (src === 'Modrinth') {
      url = `https://modrinth.com/project/${id}`;
    } else if (src === 'Hangar') {
      url = `https://hangar.papermc.io/${id}`;
    }
    
    if (url) {
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url);
      } catch (error) {
        notify(`Could not open webpage: ${error}`, 'error');
      }
    }
  };

  useEffect(() => {
    if (!server) return;
    setInstalledState(installedCache.get(server.install_path) ?? []);

    let removeListener: (() => void) | undefined;
    listen<InstalledPlugin>('plugin-update-info', event => {
      setInstalled(items => items.map(item => (item.file_name === event.payload.file_name || item.name === event.payload.name) ? event.payload : item));
    }).then(remove => { removeListener = remove; });
    loadInstalled().then(() => {
      checkUpdates();
    });
    return () => removeListener?.();
  }, [selectedServerId, server?.install_path]);

  const search = async (term = query, requestedPage = page, pType = projectType) => {
    if (!server) return;
    setBusy('search');
    try { setResults(await invoke('search_plugins', { query: term.trim(), minecraftVersion: server.minecraft_version, page: requestedPage, projectType: pType })); }
    catch (error) { notify(`Marketplace search failed: ${error}`, 'error'); }
    finally { setBusy(''); }
  };

  const install = async (plugin: MarketplacePlugin, replaceFile?: string, version?: string) => {
    if (!server) return;
    const key = `${plugin.source}:${plugin.id}`;
    setPluginBusy(items => [...items, key]);
    try {
      if (projectType === 'modpack') {
        if (!version) {
          const versions = await invoke('get_plugin_versions', { source: plugin.source, projectId: plugin.id, minecraftVersion: server.minecraft_version });
          version = (versions as any[])[0]?.version;
        }
        await invoke('install_modpack', {
          serverPath: server.install_path, serverId: server.id, projectId: plugin.id, versionId: version
        });
      } else {
        await invoke('install_marketplace_plugin', {
          serverPath: server.install_path, source: plugin.source, projectId: plugin.id,
          pluginName: plugin.name, minecraftVersion: server.minecraft_version, projectType, replaceFile, version,
        });
      }
      notify(`${plugin.name} ${replaceFile ? 'updated' : 'installed'}. Restart host to load it.`, 'success');
      updateChecks.delete(server.install_path);
      await loadInstalled(false);
      checkUpdates(true);
    } catch (error) { notify(`Plugin install failed: ${error}`, 'error'); }
    finally { setPluginBusy(items => items.filter(item => item !== key)); }
  };

  const openUpdate = async (plugin: InstalledPlugin) => {
    if (!server || !plugin.source || !plugin.project_id) return;
    setUpdatePlugin(plugin);
    setVersionsLoading(true);
    setVersions([]);
    setVersionSearch('');
    try { setVersions(await invoke('get_plugin_versions', { source: plugin.source, projectId: plugin.project_id, minecraftVersion: server.minecraft_version })); }
    catch (error) { notify(`Could not load versions: ${error}`, 'error'); }
    finally { setVersionsLoading(false); }
  };

  useEffect(() => {
    if (tab === 'marketplace' && results.length === 0) search('', 0, projectType);
  }, [tab, selectedServerId, server?.install_path, projectType]);

  if (!server) return <div className="p-8 text-center text-gray-500">Select a host first.</div>;
  const unsupported = server.server_type === 'vanilla';

  return (
    <div className="flex h-full flex-col p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white">Marketplace</h1>
        <p className="mt-1 text-gray-400">Install plugins, mods, and modpacks directly into your server.</p>
      </div>
      {unsupported && projectType === 'plugin' && <div className="mb-5 rounded-md border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-300">Vanilla hosts cannot load Paper plugins.</div>}
      <div className="mb-5 flex gap-2">
        {(['installed', 'marketplace'] as const).map(item => <button key={item} onClick={() => setTab(item)} className={`rounded-md px-4 py-2 text-sm font-medium capitalize ${tab === item ? 'bg-blue-600 text-white' : 'bg-[#1c1d21] text-gray-400 hover:text-white'}`}>{item}</button>)}
      </div>
      {tab === 'marketplace' && (
        <form onSubmit={event => { event.preventDefault(); setPage(0); search(query, 0); }} className="mb-5 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 text-gray-600" size={17} />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search plugins..." className="w-full rounded-md border border-[#2a2b2f] bg-[#0f0f11] py-2 pl-10 pr-3 text-white outline-none focus:border-blue-500" />
          </div>
          
          <div className="flex items-center gap-1 bg-[#0f0f11] p-1 rounded-lg border border-[#2a2b2f]">
            {(['plugin', 'mod', 'modpack'] as const).map(ptype => (
              <button
                key={ptype}
                type="button"
                onClick={() => {
                  setProjectType(ptype);
                  setPage(0);
                  search(query, 0, ptype);
                }}
                className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-md capitalize transition-all ${
                  projectType === ptype
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-white hover:bg-[#1c1d21]'
                }`}
              >
                <span>{ptype === 'plugin' ? 'Plugins' : ptype === 'mod' ? 'Mods' : 'Modpacks'}</span>
              </button>
            ))}
          </div>

          <button disabled={busy === 'search'} className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-40 w-24 flex items-center justify-center">{busy === 'search' ? <Loader2 className="animate-spin" size={17} /> : 'Search'}</button>
        </form>
      )}
      <div className="flex-1 overflow-y-auto rounded-lg border border-[#2a2b2f] bg-[#1c1d21]">
        {loading ? <div className="grid gap-3 p-4 md:grid-cols-2">{[1,2,3,4].map(item => <div key={item} className="h-28 animate-pulse rounded-md bg-[#25262a]" />)}</div> :
        tab === 'installed' ? (
          installed.length ? <div className="divide-y divide-[#2a2b2f]">{installed.map(plugin => (
            <div key={plugin.file_name} className="flex items-center gap-4 p-4">
              {plugin.icon_url ? <img src={plugin.icon_url} alt="" className="h-9 w-9 rounded-md object-cover" /> : <div className="rounded-md bg-[#292a2f] p-2 text-blue-400"><Package size={20} /></div>}
              <div
                onClick={() => plugin.source && plugin.project_id && openWebsite(plugin)}
                className={`min-w-0 flex-1 ${plugin.source && plugin.project_id ? 'cursor-pointer hover:underline' : ''}`}
              >
                <div className="font-semibold text-white">{plugin.name} <span className="ml-2 text-xs font-normal text-gray-600">{plugin.version}</span>{plugin.update_available && <span className="ml-2 rounded bg-blue-500/10 px-2 py-0.5 text-xs font-normal text-blue-400">Update {plugin.latest_version}</span>}</div>
                <div className="truncate text-sm text-gray-500">{plugin.description || plugin.file_name}</div>
              </div>
              <button onClick={() => openUpdate(plugin)} disabled={pluginBusy.includes(`${plugin.source}:${plugin.project_id}`) || unsupported || !plugin.project_id} className="flex items-center gap-2 rounded-md bg-[#2a2b2f] px-3 py-2 text-sm text-gray-200 hover:bg-[#34353a] disabled:opacity-30">{pluginBusy.includes(`${plugin.source}:${plugin.project_id}`) ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />} Update</button>
              <button onClick={async () => { await invoke('toggle_plugin', { serverPath: server.install_path, fileName: plugin.file_name, enabled: !plugin.enabled }); loadInstalled(); }} className={`relative h-5 w-9 rounded-full ${plugin.enabled ? 'bg-blue-600' : 'bg-[#34353a]'}`}><span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${plugin.enabled ? 'translate-x-4' : ''}`} /></button>
              <button onClick={async () => { await invoke('delete_plugin', { serverPath: server.install_path, fileName: plugin.file_name }); loadInstalled(); }} className="rounded p-2 text-gray-500 hover:bg-red-500/10 hover:text-red-400"><Trash2 size={17} /></button>
            </div>
          ))}</div> : <div className="py-16 text-center text-gray-600">No plugins installed.</div>
        ) : results.length ? <div className="grid gap-3 p-4 md:grid-cols-2">{results.map(plugin => (
          <div
            key={`${plugin.source}:${plugin.id}`}
            onClick={() => openWebsite(plugin)}
            className="flex gap-3 rounded-md border border-[#2a2b2f] bg-[#18191c] p-4 cursor-pointer hover:border-gray-500 hover:bg-[#202124] transition-all"
          >
            {plugin.icon_url ? <img src={plugin.icon_url} alt="" className="h-12 w-12 rounded-md object-cover" /> : <div className="h-12 w-12 rounded-md bg-[#292a2f]" />}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold text-white">{plugin.name}</span>
                <span className="rounded bg-[#292a2f] px-1.5 py-0.5 text-[10px] text-gray-500">{plugin.source}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-gray-500">{plugin.description}</p>
              <div className="mt-2 text-xs text-gray-600">{plugin.downloads.toLocaleString()} downloads</div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); install(plugin); }}
              disabled={pluginBusy.includes(`${plugin.source}:${plugin.id}`) || unsupported}
              className="self-center rounded-md bg-blue-600 p-2 text-white disabled:opacity-40 hover:bg-blue-700"
            >
              {pluginBusy.includes(`${plugin.source}:${plugin.id}`) ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
            </button>
          </div>
        ))}</div> : <div className="py-16 text-center text-gray-600">{busy === 'search' ? 'Loading recommendations...' : 'No compatible plugins found.'}</div>}
      </div>
      {tab === 'marketplace' && results.length > 0 && <div className="mt-4 flex items-center justify-center gap-3">
        <button onClick={() => { const next = Math.max(0, page - 1); setPage(next); search(query, next); }} disabled={page === 0 || busy === 'search'} className="rounded-md bg-[#2a2b2f] p-2 text-gray-300 disabled:opacity-30"><ChevronLeft size={17} /></button>
        <span className="text-sm text-gray-500">Page {page + 1}</span>
        <button onClick={() => { const next = page + 1; setPage(next); search(query, next); }} disabled={results.length < 12 || busy === 'search'} className="rounded-md bg-[#2a2b2f] p-2 text-gray-300 disabled:opacity-30"><ChevronRight size={17} /></button>
      </div>}
      {tab === 'installed' && checkingUpdates && <div className="mt-3 flex items-center justify-center gap-2 text-xs text-gray-600"><Loader2 size={13} className="animate-spin" />Checking marketplace versions in background…</div>}
      {updatePlugin && (
        <div onMouseDown={event => { if (event.target === event.currentTarget) setUpdatePlugin(null); }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="flex max-h-[75vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-[#2a2b2f] bg-[#1c1d21] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#2a2b2f] p-4"><div><div className="font-semibold text-white">Update {updatePlugin.name}</div><div className="text-xs text-gray-500">Installed: {updatePlugin.version}</div></div><button onClick={() => setUpdatePlugin(null)} className="text-gray-500 hover:text-white"><X size={18} /></button></div>
            <div className="p-3"><div className="relative"><Search size={15} className="absolute left-3 top-2.5 text-gray-600" /><input autoFocus value={versionSearch} onChange={event => setVersionSearch(event.target.value)} placeholder="Search versions..." className="w-full rounded-md border border-[#2a2b2f] bg-[#0f0f11] py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-blue-500" /></div></div>
            <div className="flex-1 overflow-y-auto border-t border-[#2a2b2f]">
              {versionsLoading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-blue-500" /></div> :
                versions.filter(item => item.version.toLowerCase().includes(versionSearch.toLowerCase())).map(item => (
                  <button key={item.version} onClick={async () => {
                    setUpdatePlugin(null);
                    await install({ source: updatePlugin.source!, id: updatePlugin.project_id!, name: updatePlugin.name, description: updatePlugin.description, downloads: 0, icon_url: updatePlugin.icon_url }, updatePlugin.file_name, item.version);
                  }} disabled={pluginBusy.includes(`${updatePlugin.source}:${updatePlugin.project_id}`) || item.version === updatePlugin.version} className="flex w-full items-center justify-between border-b border-[#27282c] px-4 py-3 text-left hover:bg-[#242529] disabled:opacity-40">
                    <span className="flex items-center gap-2 font-medium text-white">{item.version}{item === versions[0] && <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">Latest</span>}</span><span className="text-xs text-gray-600">{item.version === updatePlugin.version ? 'Installed' : item.published ? new Date(item.published).toLocaleDateString() : 'Install'}</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
