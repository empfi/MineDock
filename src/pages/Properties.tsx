import { useState, useEffect } from 'react';
import { useStore } from '../store';
import UnsavedChangesBar from '../components/UnsavedChangesBar';
import { invoke } from '@tauri-apps/api/core';
import { notify } from '../components/Notifications';
import { Code, LayoutList, Loader2, Save } from 'lucide-react';
import Editor from '@monaco-editor/react';

const normalizePropsString = (content: string) => {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) {
        return line.replace(/\r$/, '');
      }
      const [key, ...rest] = trimmed.split('=');
      return `${key.trim()}=${rest.join('=').trim()}`;
    })
    .join('\n');
};

export default function Properties() {
  const { servers, selectedServerId } = useStore();
  const selectedServer = servers.find(s => s.id === selectedServerId);

  const [tab, setTab] = useState<'properties' | 'minedock'>('properties');
  const [rawProps, setRawProps] = useState('');
  const [savedRawProps, setSavedRawProps] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'visual' | 'raw'>('visual');

  // Parsed representation
  const [parsedProps, setParsedProps] = useState<Record<string, string>>({});

  // MineDock Settings Profile State
  const [profileName, setProfileName] = useState('');
  const [profileJar, setProfileJar] = useState('');
  const [profileMinRam, setProfileMinRam] = useState(1024);
  const [profileMaxRam, setProfileMaxRam] = useState(4096);
  const [profileJava, setProfileJava] = useState('');
  const [sysMemory, setSysMemory] = useState<number>(8192);
  const [savedProfile, setSavedProfile] = useState('');
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    if (selectedServer) {
      setProfileLoaded(false);
      loadProperties();
      setProfileName(selectedServer.name);
      setProfileJar(selectedServer.jar_path);
      setProfileMinRam(selectedServer.ram_min);
      setProfileMaxRam(selectedServer.ram_max);
      setProfileJava(selectedServer.java_path);
      setSavedProfile(JSON.stringify([selectedServer.name, selectedServer.jar_path, selectedServer.ram_min, selectedServer.ram_max, selectedServer.java_path]));
      setProfileLoaded(true);
      
      invoke<number>('get_system_memory').then(setSysMemory).catch(console.error);
    }
  }, [selectedServerId]);

  const loadProperties = async () => {
    setLoading(true);
    setError(null);
    try {
      const content = await invoke<string>('read_file_content', {
        baseDir: selectedServer!.install_path,
        subPath: 'server.properties'
      });
      setRawProps(content);
      setSavedRawProps(content);
      parseProperties(content);
    } catch (err: any) {
      setError("Could not load server.properties. Ensure the server has been run at least once or the file exists. " + err.toString());
    } finally {
      setLoading(false);
    }
  };

  const parseProperties = (content: string) => {
    const lines = content.split('\n');
    const parsed: Record<string, string> = {};
    for (const line of lines) {
      if (line.trim().startsWith('#') || !line.includes('=')) continue;
      const [key, ...rest] = line.split('=');
      parsed[key.trim()] = rest.join('=').trim();
    }
    setParsedProps(parsed);
  };

  const stringifyProperties = (parsed: Record<string, string>, originalRaw: string) => {
    const lines = originalRaw.split('\n');
    const newLines = [];
    const usedKeys = new Set<string>();

    for (const line of lines) {
      if (line.trim().startsWith('#') || !line.includes('=')) {
        newLines.push(line);
        continue;
      }
      const key = line.split('=')[0].trim();
      if (parsed[key] !== undefined) {
        newLines.push(`${key}=${parsed[key]}`);
        usedKeys.add(key);
      }
    }

    // Add any new keys that weren't in the original file
    for (const [key, value] of Object.entries(parsed)) {
      if (!usedKeys.has(key)) {
        newLines.push(`${key}=${value}`);
      }
    }

    return newLines.join('\n');
  };

  const handleSave = async () => {
    if (!selectedServer) return;
    setSaving(true);
    setError(null);
    try {
      const contentToSave = mode === 'visual' ? stringifyProperties(parsedProps, rawProps) : rawProps;
      
      // Extract port to check for conflicts and save to DB
      const portMatch = contentToSave.match(/^server-port=(\d+)/m);
      if (portMatch) {
         const newPort = parseInt(portMatch[1]);
         if (newPort !== selectedServer.port) {
            const portInUse = servers.some(s => s.id !== selectedServer.id && s.port === newPort);
            if (portInUse) {
               setError(`Cannot save: Port ${newPort} is already allocated to another server.`);
               setSaving(false);
               return;
            }
            await invoke('save_server_port', { id: selectedServer.id, port: newPort });
            useStore.getState().fetchServers();
         }
      }

      await invoke('save_file_content', {
        baseDir: selectedServer.install_path,
        subPath: 'server.properties',
        content: contentToSave
      });
      
      // Update local state if saved from visual mode
      if (mode === 'visual') {
         setRawProps(contentToSave);
      } else {
         parseProperties(contentToSave);
      }
      setSavedRawProps(contentToSave);
      
      notify('server.properties saved. Restart server to apply changes.', 'success', false);
    } catch (err: any) {
      setError("Failed to save: " + err.toString());
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!selectedServer) return;
    setSaving(true);
    setError(null);
    try {
      await invoke('update_server_settings', {
        id: selectedServer.id,
        name: profileName,
        jarPath: profileJar,
        ramMin: profileMinRam,
        ramMax: profileMaxRam,
        javaPath: profileJava,
      });
      await useStore.getState().fetchServers();
      setSavedProfile(JSON.stringify([profileName, profileJar, profileMinRam, profileMaxRam, profileJava]));
      notify('Server settings saved. Restart server to apply changes.', 'success', false);
    } catch (err: any) {
      setError("Failed to save settings: " + err.toString());
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAll = () => {
    if (tab === 'properties') {
      handleSave();
    } else {
      handleSaveProfile();
    }
  };

  const updateProp = (key: string, value: string) => {
    setParsedProps(prev => ({ ...prev, [key]: value }));
  };

  const currentProperties = mode === 'visual' ? stringifyProperties(parsedProps, rawProps) : rawProps;
  const propertiesDirty = !loading && normalizePropsString(currentProperties) !== normalizePropsString(savedRawProps);
  const profileDirty = profileLoaded && JSON.stringify([profileName, profileJar, profileMinRam, profileMaxRam, profileJava]) !== savedProfile;
  const dirty = propertiesDirty || profileDirty;
  const resetChanges = () => {
    setRawProps(savedRawProps);
    parseProperties(savedRawProps);
    const saved = JSON.parse(savedProfile || '[]');
    if (saved.length) {
      setProfileName(saved[0]); setProfileJar(saved[1]); setProfileMinRam(saved[2]); setProfileMaxRam(saved[3]); setProfileJava(saved[4]);
    }
  };

  if (!selectedServer) {
    return <div className="p-8 text-center text-gray-500">Select a server from the sidebar.</div>;
  }

  const commonProps = [
    { key: 'server-port', label: 'Server Port', type: 'number' },
    { key: 'motd', label: 'Message of the Day', type: 'text' },
    { key: 'max-players', label: 'Max Players', type: 'number' },
    { key: 'difficulty', label: 'Difficulty', type: 'select', options: ['peaceful', 'easy', 'normal', 'hard'] },
    { key: 'gamemode', label: 'Game Mode', type: 'select', options: ['survival', 'creative', 'adventure', 'spectator'] },
    { key: 'hardcore', label: 'Hardcore', type: 'boolean' },
    { key: 'pvp', label: 'PvP', type: 'boolean' },
    { key: 'online-mode', label: 'Online Mode (Authentication)', type: 'boolean' },
    { key: 'enable-command-block', label: 'Enable Command Blocks', type: 'boolean' },
    { key: 'view-distance', label: 'View Distance', type: 'number' },
    { key: 'simulation-distance', label: 'Simulation Distance', type: 'number' },
    { key: 'white-list', label: 'Whitelist', type: 'boolean' },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full flex flex-col h-full">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Server Configuration</h1>
          <p className="text-gray-400">Configure settings for {selectedServer.name}.</p>
        </div>
        <div className="flex gap-4">
          {tab === 'properties' && (
            <div className="flex bg-[#1c1d21] border border-[#2a2b2f] rounded-md p-1">
              <button
                onClick={() => {
                  if (mode === 'raw') parseProperties(rawProps);
                  setMode('visual');
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors ${mode === 'visual' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                <LayoutList size={16} /> Visual
              </button>
              <button
                onClick={() => {
                  if (mode === 'visual') setRawProps(stringifyProperties(parsedProps, rawProps));
                  setMode('raw');
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors ${mode === 'raw' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                <Code size={16} /> Raw
              </button>
            </div>
          )}
          <button
            onClick={handleSaveAll}
            disabled={!dirty || saving || (tab === 'properties' && (loading || !!error))}
            title={!dirty ? 'No unsaved changes' : error ? 'Fix the configuration error before saving' : saving ? 'Saving changes' : 'Save changes'}
            className="action-button bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
            style={{ '--action-width': '7.5rem' } as React.CSSProperties}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-[#2a2b2f] mb-6">
        <button
          onClick={() => setTab('properties')}
          className={`pb-3 text-sm font-semibold border-b-2 px-1 transition-all ${tab === 'properties' ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-white'}`}
        >
          Minecraft Settings (server.properties)
        </button>
        <button
          onClick={() => setTab('minedock')}
          className={`pb-3 text-sm font-semibold border-b-2 px-1 transition-all ${tab === 'minedock' ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-white'}`}
        >
          MineDock Profile Settings
        </button>
      </div>
      <UnsavedChangesBar dirty={dirty} saving={saving} onSave={handleSaveAll} onReset={resetChanges} saveDisabled={!!error} />

      {tab === 'properties' ? (
        error ? (
          <div className="flex-1 border border-red-500/20 bg-red-500/5 rounded-lg flex items-center justify-center p-8 text-red-400 text-center">
            {error}
          </div>
        ) : loading ? (
          <div className="flex-1 rounded-lg border border-[#2a2b2f] bg-[#1c1d21] p-6">
            <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
              {Array.from({ length: 10 }).map((_, index) => (
                <div key={index} className="space-y-2 animate-pulse">
                  <div className="h-3 w-32 rounded bg-[#303136]" />
                  <div className="h-10 w-full rounded-md bg-[#25262a]" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto bg-[#1c1d21] border border-[#2a2b2f] rounded-lg">
            {mode === 'visual' ? (
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                {commonProps.map(prop => {
                  const val = parsedProps[prop.key] || '';
                  return (
                    <div key={prop.key} className="flex flex-col">
                      <label className="text-sm font-medium text-gray-300 mb-2">{prop.label} <span className="text-xs text-gray-600 ml-2 font-mono">{prop.key}</span></label>
                      {prop.type === 'boolean' ? (
                        <select
                          value={val}
                          onChange={(e) => updateProp(prop.key, e.target.value)}
                          className="bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2 text-white focus:outline-none focus:border-blue-500 appearance-none"
                        >
                          <option value="true">True</option>
                          <option value="false">False</option>
                        </select>
                      ) : prop.type === 'select' && prop.options ? (
                        <select
                          value={val}
                          onChange={(e) => updateProp(prop.key, e.target.value)}
                          className="bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2 text-white focus:outline-none focus:border-blue-500 appearance-none capitalize"
                        >
                          {prop.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : (
                        <input
                          type={prop.type}
                          value={val}
                          onChange={(e) => updateProp(prop.key, e.target.value)}
                          className="bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <Editor
                height="100%"
                language="ini"
                theme="vs-dark"
                value={rawProps}
                onChange={value => setRawProps(value ?? '')}
                options={{
                  fontSize: 13,
                  fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, monospace',
                  fontLigatures: true,
                  minimap: { enabled: true },
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  lineNumbers: 'on',
                  renderLineHighlight: 'all',
                  smoothScrolling: true,
                  cursorSmoothCaretAnimation: 'on',
                  bracketPairColorization: { enabled: true },
                  padding: { top: 12, bottom: 12 },
                  scrollbar: {
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8,
                  },
                }}
              />
            )}
          </div>
        )
      ) : (
        <div className="flex-1 overflow-y-auto bg-[#1c1d21] border border-[#2a2b2f] rounded-lg p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
            <div className="flex flex-col">
              <label className="text-sm font-medium text-gray-300 mb-2">Server Profile Name</label>
              <input
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-sm font-medium text-gray-300 mb-2">Executable File Name (Jar Path)</label>
              <input
                type="text"
                value={profileJar}
                onChange={(e) => setProfileJar(e.target.value)}
                className="bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2 text-white focus:outline-none focus:border-blue-500 font-mono text-sm"
                placeholder="server.jar"
              />
              <p className="text-xs text-gray-500 mt-1">Change the executable jar filename here. Make sure the file exists in the directory.</p>
            </div>

            <div className="flex flex-col">
              <label className="text-sm font-medium text-gray-300 mb-2">Java Path</label>
              <input
                type="text"
                value={profileJava}
                onChange={(e) => setProfileJava(e.target.value)}
                className="bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2 text-white focus:outline-none focus:border-blue-500 font-mono text-sm"
              />
            </div>
          </div>

          <div className="border-t border-[#2a2b2f] pt-6 space-y-6">
            <h3 className="font-semibold text-white">RAM Allocation</h3>
            <div className="space-y-6">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm text-gray-400">Minimum RAM (Xms)</label>
                  <span className="text-sm font-semibold text-white">{profileMinRam} MB</span>
                </div>
                <div className="flex gap-4 items-center">
                  <input
                    type="range"
                    min={512}
                    max={profileMaxRam}
                    step={256}
                    value={profileMinRam}
                    onChange={(e) => setProfileMinRam(Math.min(parseInt(e.target.value) || 1024, profileMaxRam))}
                    className="flex-1 accent-blue-500 h-2 bg-[#2a2b2f] rounded-lg appearance-none cursor-pointer"
                  />
                  <input
                    type="number"
                    value={profileMinRam}
                    onChange={(e) => setProfileMinRam(Math.min(parseInt(e.target.value) || 0, sysMemory))}
                    className="w-28 bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-1.5 text-white text-center focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm text-gray-400">Maximum RAM (Xmx)</label>
                  <span className="text-sm font-semibold text-white">{profileMaxRam} MB</span>
                </div>
                <div className="flex gap-4 items-center">
                  <input
                    type="range"
                    min={1024}
                    max={sysMemory}
                    step={256}
                    value={profileMaxRam}
                    onChange={(e) => {
                      const newMax = parseInt(e.target.value) || 1024;
                      setProfileMaxRam(newMax);
                      if (profileMinRam > newMax) setProfileMinRam(newMax);
                    }}
                    className="flex-1 accent-blue-500 h-2 bg-[#2a2b2f] rounded-lg appearance-none cursor-pointer"
                  />
                  <input
                    type="number"
                    value={profileMaxRam}
                    onChange={(e) => {
                      const newMax = Math.min(parseInt(e.target.value) || 0, sysMemory);
                      setProfileMaxRam(newMax);
                      if (profileMinRam > newMax) setProfileMinRam(newMax);
                    }}
                    className="w-28 bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-1.5 text-white text-center focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
