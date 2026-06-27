import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { Save, AlertTriangle, Code, LayoutList } from 'lucide-react';

export default function Properties() {
  const { servers, selectedServerId } = useStore();
  const selectedServer = servers.find(s => s.id === selectedServerId);

  const [rawProps, setRawProps] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'visual' | 'raw'>('visual');

  // Parsed representation
  const [parsedProps, setParsedProps] = useState<Record<string, string>>({});

  useEffect(() => {
    if (selectedServer) {
      loadProperties();
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
      
      alert('server.properties saved successfully. A server restart is required for changes to take effect.');
    } catch (err: any) {
      setError("Failed to save: " + err.toString());
    } finally {
      setSaving(false);
    }
  };

  const updateProp = (key: string, value: string) => {
    setParsedProps(prev => ({ ...prev, [key]: value }));
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
    { key: 'allow-flight', label: 'Allow Flight', type: 'boolean' },
    { key: 'enable-command-block', label: 'Enable Command Blocks', type: 'boolean' },
    { key: 'view-distance', label: 'View Distance', type: 'number' },
    { key: 'simulation-distance', label: 'Simulation Distance', type: 'number' },
    { key: 'white-list', label: 'Whitelist', type: 'boolean' },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full flex flex-col h-full">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Server Properties</h1>
          <p className="text-gray-400">Configure Minecraft settings.</p>
        </div>
        <div className="flex gap-4">
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
          <button
            onClick={handleSave}
            disabled={saving || loading || !!error}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-md font-medium transition-colors disabled:opacity-50"
          >
            <Save size={18} /> {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-md p-4 mb-6 flex items-center gap-3">
        <AlertTriangle size={20} className="shrink-0" />
        <p className="text-sm">Changes made here will only take effect after the server is restarted.</p>
      </div>

      {error ? (
        <div className="flex-1 border border-red-500/20 bg-red-500/5 rounded-lg flex items-center justify-center p-8 text-red-400 text-center">
          {error}
        </div>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-500">Loading properties...</div>
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
            <textarea
              value={rawProps}
              onChange={(e) => setRawProps(e.target.value)}
              className="w-full h-full min-h-[500px] bg-[#09090a] text-gray-200 p-6 font-mono text-sm focus:outline-none resize-none"
              spellCheck="false"
            />
          )}
        </div>
      )}
    </div>
  );
}
