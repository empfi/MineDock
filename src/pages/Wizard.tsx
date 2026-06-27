import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ChevronRight, ChevronLeft, Check, Folder, Loader2 } from 'lucide-react';
import { Server } from '../types';

interface VersionManifest {
  latest: { release: string; snapshot: string };
  versions: { id: string; type: string; url: string; time: string; releaseTime: string }[];
}

export default function Wizard() {
  const navigate = useNavigate();
  const { settings, fetchServers } = useStore();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('My Minecraft Server');
  const [installPath, setInstallPath] = useState('');
  const [version, setVersion] = useState('');
  const [versionUrl, setVersionUrl] = useState('');
  const [ramMin, setRamMin] = useState(1024);
  const [ramMax, setRamMax] = useState(4096);
  const [port, setPort] = useState(25565);
  const [javaPath, setJavaPath] = useState('java');
  const [eulaAccepted, setEulaAccepted] = useState(false);

  // External Data
  const [versions, setVersions] = useState<VersionManifest | null>(null);
  const [sysMemory, setSysMemory] = useState<number>(8192);
  const [detectedJavas, setDetectedJavas] = useState<string[]>([]);

  // Install State
  const [installStatus, setInstallStatus] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);

  useEffect(() => {
    if (settings) {
      if (!installPath) setInstallPath(settings.default_server_dir ? `${settings.default_server_dir}\\${name.replace(/\\s+/g, '_')}` : '');
      if (ramMin === 1024) setRamMin(settings.default_ram_min);
      if (ramMax === 4096) setRamMax(settings.default_ram_max);
      if (javaPath === 'java') setJavaPath(settings.default_java_path);
    }
  }, [settings, name]);

  useEffect(() => {
    if (step === 3 && !versions) {
      setLoading(true);
      invoke<VersionManifest>('get_mc_versions')
        .then(data => {
          setVersions(data);
          if (!version) {
            setVersion(data.latest.release);
            const v = data.versions.find(v => v.id === data.latest.release);
            if (v) setVersionUrl(v.url);
          }
        })
        .catch(e => setError(e))
        .finally(() => setLoading(false));
    }
    if (step === 4) {
      invoke<number>('get_system_memory').then(setSysMemory).catch(console.error);
    }
    if (step === 6 && detectedJavas.length === 0) {
      setLoading(true);
      invoke<string[]>('detect_java_paths')
        .then(paths => {
           setDetectedJavas(paths);
           if (paths.length > 0 && javaPath === 'java') {
             setJavaPath(paths[paths.length - 1]); // Try to pick the most specific/highest version
           }
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [step]);

  const selectDir = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === 'string') {
        setInstallPath(`${selected}\\${name.replace(/\\s+/g, '_')}`);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleInstall = async () => {
    if (!eulaAccepted) {
      setError('You must accept the EULA to install the server.');
      return;
    }

    setStep(8);
    setInstallStatus('Creating folders...');
    
    try {
      // 1. Create folders
      await invoke('create_new_folder', { baseDir: installPath, subPath: '.' });
      
      // 2. Download jar
      setInstallStatus('Downloading server jar...');
      const jarName = `server-${version}.jar`;
      const jarPath = `${installPath}\\${jarName}`;
      
      const unlisten = await listen<{downloaded: number, total: number}>('download-progress', (event) => {
        const { downloaded, total } = event.payload;
        setDownloadProgress((downloaded / total) * 100);
      });

      await invoke('download_mc_version', { url: versionUrl, path: jarPath });
      unlisten();

      // 3. Accept EULA
      setInstallStatus('Accepting EULA...');
      await invoke('accept_eula', { serverPath: installPath });

      // 4. Create server.properties
      setInstallStatus('Creating server.properties...');
      const props = `server-port=${port}\nmotd=${name}\n`;
      await invoke('save_file_content', { baseDir: installPath, subPath: 'server.properties', content: props });

      // 5. Save Server Profile
      setInstallStatus('Saving profile...');
      const newServer: Server = {
        name,
        minecraft_version: version,
        server_type: 'vanilla',
        install_path: installPath,
        jar_path: jarName, // relative or absolute depending on how process.rs is written. We use relative to install_path in process.rs.
        status: 'offline',
        ram_min: ramMin,
        ram_max: ramMax,
        java_path: javaPath,
        created_at: new Date().toISOString(),
        port,
      };

      await invoke('create_new_server', { server: newServer });
      await fetchServers();
      
      setInstallStatus('Complete!');
      setTimeout(() => navigate('/servers'), 1500);

    } catch (err: any) {
      setError(err.toString());
      setStep(7); // go back to EULA step on error
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto flex flex-col h-full">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Create New Server</h1>
        
        {/* Progress Bar */}
        <div className="flex items-center gap-2 mt-6">
          {[1,2,3,4,5,6,7,8].map(s => (
            <div key={s} className="flex-1 h-2 rounded-full overflow-hidden bg-[#2a2b2f]">
              <div className={`h-full transition-all duration-300 ${s < step ? 'bg-emerald-500' : s === step ? 'bg-blue-500' : 'bg-transparent'}`}></div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 bg-[#1c1d21] border border-[#2a2b2f] rounded-lg p-8 shadow-xl">
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-md text-sm">
            {error}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <h2 className="text-xl font-semibold text-white">1. Server Name</h2>
            <p className="text-gray-400 text-sm">Give your new Minecraft server a recognizable name.</p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-4 py-3 text-white text-lg focus:outline-none focus:border-blue-500"
              autoFocus
            />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <h2 className="text-xl font-semibold text-white">2. Installation Path</h2>
            <p className="text-gray-400 text-sm">Where should the server files be stored?</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={installPath}
                onChange={(e) => setInstallPath(e.target.value)}
                className="flex-1 bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                placeholder="C:\\Servers\\MyServer"
              />
              <button onClick={selectDir} className="px-4 py-3 bg-[#2a2b2f] hover:bg-[#3a3b3f] text-white rounded-md transition-colors flex items-center gap-2">
                <Folder size={18} /> Browse
              </button>
            </div>
            {!installPath && <p className="text-red-400 text-xs">Path is required.</p>}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <h2 className="text-xl font-semibold text-white">3. Minecraft Version</h2>
            <p className="text-gray-400 text-sm">Select the Vanilla Minecraft version to install.</p>
            
            {loading ? (
              <div className="flex items-center gap-3 text-gray-400 py-4">
                <Loader2 size={20} className="animate-spin" /> Fetching versions...
              </div>
            ) : (
              <select
                value={version}
                onChange={(e) => {
                  setVersion(e.target.value);
                  const v = versions?.versions.find(v => v.id === e.target.value);
                  if (v) setVersionUrl(v.url);
                }}
                className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-4 py-3 text-white focus:outline-none focus:border-blue-500 appearance-none"
              >
                {versions?.versions.filter(v => v.type === 'release').map(v => (
                  <option key={v.id} value={v.id}>{v.id} (Release)</option>
                ))}
              </select>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <h2 className="text-xl font-semibold text-white">4. RAM Allocation</h2>
            <p className="text-gray-400 text-sm">Allocate memory for your server. (System has {sysMemory} MB total)</p>
            
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm text-gray-400 mb-2">Minimum RAM (Xms) in MB</label>
                <input
                  type="number"
                  value={ramMin}
                  onChange={(e) => setRamMin(parseInt(e.target.value) || 1024)}
                  className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-2">Maximum RAM (Xmx) in MB</label>
                <input
                  type="number"
                  value={ramMax}
                  onChange={(e) => setRamMax(parseInt(e.target.value) || 4096)}
                  className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <h2 className="text-xl font-semibold text-white">5. Server Port</h2>
            <p className="text-gray-400 text-sm">The network port players will use to connect.</p>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(parseInt(e.target.value) || 25565)}
              className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-4 py-3 text-white text-lg focus:outline-none focus:border-blue-500"
            />
          </div>
        )}

        {step === 6 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <h2 className="text-xl font-semibold text-white">6. Java Path</h2>
            <p className="text-gray-400 text-sm">Path to the Java executable. Minecraft 1.20.5+ requires Java 21.</p>
            
            {loading ? (
              <div className="flex items-center gap-3 text-gray-400 py-4">
                <Loader2 size={20} className="animate-spin" /> Detecting Java installations...
              </div>
            ) : (
              <div className="space-y-3">
                {detectedJavas.length === 0 && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded text-sm">
                    No Java installations were automatically detected. You may need to manually provide the path.
                  </div>
                )}
                
                {detectedJavas.length > 0 && (
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Select Detected Java</label>
                    <select
                      value={javaPath}
                      onChange={(e) => setJavaPath(e.target.value)}
                      className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-4 py-3 text-white focus:outline-none focus:border-blue-500 appearance-none"
                    >
                      {detectedJavas.map((j, i) => (
                        <option key={i} value={j}>{j}</option>
                      ))}
                      {/* Allow retaining the custom path if they entered one */}
                      {!detectedJavas.includes(javaPath) && <option value={javaPath}>{javaPath} (Custom)</option>}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm text-gray-400 mb-2">Or Provide Custom Path</label>
                  <input
                    type="text"
                    value={javaPath}
                    onChange={(e) => setJavaPath(e.target.value)}
                    className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-4 py-3 text-white text-lg focus:outline-none focus:border-blue-500 font-mono text-sm"
                    placeholder="C:\Program Files\Java\jdk-21\bin\java.exe"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {step === 7 && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
            <h2 className="text-xl font-semibold text-white">7. Minecraft EULA</h2>
            <div className="bg-[#0f0f11] border border-[#2a2b2f] p-4 rounded-md text-sm text-gray-400 h-32 overflow-y-auto">
              By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).
              <br/><br/>
              You must accept the End User License Agreement before starting a Minecraft server.
            </div>
            
            <label className="flex items-center gap-3 cursor-pointer p-4 bg-[#2a2b2f]/30 rounded-md border border-[#2a2b2f] hover:border-blue-500/50 transition-colors">
              <input 
                type="checkbox" 
                checked={eulaAccepted}
                onChange={(e) => setEulaAccepted(e.target.checked)}
                className="w-5 h-5 rounded border-[#2a2b2f] bg-[#0f0f11] text-blue-600 focus:ring-blue-500"
              />
              <span className="text-white font-medium">I accept the Minecraft EULA</span>
            </label>
          </div>
        )}

        {step === 8 && (
          <div className="space-y-6 animate-in fade-in flex flex-col items-center justify-center py-12">
            <Loader2 size={48} className="animate-spin text-blue-500 mb-4" />
            <h2 className="text-2xl font-bold text-white">Installing Server</h2>
            <p className="text-gray-400">{installStatus}</p>
            
            {downloadProgress > 0 && downloadProgress < 100 && (
              <div className="w-full max-w-md mt-4">
                <div className="h-2 w-full bg-[#2a2b2f] rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 transition-all duration-200" style={{ width: `${downloadProgress}%` }}></div>
                </div>
                <p className="text-center text-xs text-gray-500 mt-2">{Math.round(downloadProgress)}%</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-8 flex justify-between">
        <button
          onClick={() => step > 1 ? setStep(step - 1) : navigate('/servers')}
          disabled={step === 8}
          className="flex items-center gap-2 px-4 py-2 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
        >
          <ChevronLeft size={18} /> {step === 1 ? 'Cancel' : 'Back'}
        </button>
        
        {step < 7 && (
          <button
            onClick={() => {
              setError(null);
              if (step === 2 && !installPath) {
                setError('Installation path is required');
                return;
              }
              setStep(step + 1);
            }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md font-medium transition-colors"
          >
            Next <ChevronRight size={18} />
          </button>
        )}

        {step === 7 && (
          <button
            onClick={handleInstall}
            disabled={!eulaAccepted}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-md font-medium transition-colors disabled:opacity-50"
          >
            <Check size={18} /> Install Server
          </button>
        )}
      </div>
    </div>
  );
}
