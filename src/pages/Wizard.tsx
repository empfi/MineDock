import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ChevronRight, ChevronLeft, Check, Folder, Loader2 } from 'lucide-react';
import { Server } from '../types';
import PageHeader from '../components/PageHeader';
import { reportInstall } from '../components/ProgressHub';
import { SOFTWARE } from '../lib/software';

const TUTORIAL = [
  '',
  'Choose a recognizable server name, then click Next.',
  'Choose an absolute Windows installation path or use Browse, then click Next.',
  'Select the server fork and Minecraft version, then click Next.',
  'Set minimum and maximum RAM within your available system memory, then click Next.',
  'Choose the network port players will use, then click Next.',
  'Select a detected Java installation or enter its executable path, then click Next.',
  'Review and accept the Minecraft EULA, then install the server.',
] as const;

function requiredJavaMajor(version: string, serverType: string) {
  if (serverType === 'velocity') return 21;
  const match = version.match(/^1\.(\d+)(?:\.(\d+))?/);
  if (!match) return 21;
  const minor = Number(match[1]);
  const patch = Number(match[2] || 0);
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21;
  if (minor >= 18) return 17;
  if (minor >= 17) return 16;
  return 8;
}

export default function Wizard() {
  const navigate = useNavigate();
  const { servers, settings, fetchServers, getSoftwareVersionsCached, clearVersionsCache, fetchSettings } = useStore();
  const [step, setStep] = useState(1);
  const [dockerAvailable, setDockerAvailable] = useState(false);

  useEffect(() => {
    clearVersionsCache();
    invoke<boolean>('is_docker_available')
      .then(setDockerAvailable)
      .catch(console.error);
  }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('My Minecraft Server');
  const [installPath, setInstallPath] = useState('');
  const [serverType, setServerType] = useState('vanilla');
  const [version, setVersion] = useState('');
  const [ramMin, setRamMin] = useState(1024);
  const [ramMax, setRamMax] = useState(4096);
  const [port, setPort] = useState(25565);
  const [javaPath, setJavaPath] = useState('java');
  const [runInContainer, setRunInContainer] = useState(false);
  const [eulaAccepted, setEulaAccepted] = useState(false);

  // External Data
  const [versions, setVersions] = useState<string[]>([]);
  const [sysMemory, setSysMemory] = useState<number>(8192);
  const [detectedJavas, setDetectedJavas] = useState<string[]>([]);
  const [installingJava, setInstallingJava] = useState(false);
  const [selectedJavaMajor, setSelectedJavaMajor] = useState<number | null>(null);

  // Install State
  const [installStatus, setInstallStatus] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const hasValidInstallPath = /^[A-Za-z]:[\\/](?![\\/])[^<>:"|?*\r\n]+$/.test(installPath.trim());

  useEffect(() => {
    if (settings) {
      if (!installPath) setInstallPath(settings.default_server_dir ? `${settings.default_server_dir}\\${name.replace(/\\s+/g, '_')}` : '');
      if (ramMin === 1024) setRamMin(settings.default_ram_min);
      if (ramMax === 4096) setRamMax(settings.default_ram_max);
      if (javaPath === 'java') setJavaPath(settings.default_java_path);
    }
  }, [settings, name]);

  useEffect(() => {
    if (step === 3) {
      setLoading(true);
      setError(null);
      getSoftwareVersionsCached(serverType)
        .then(data => {
          setVersions(data);
          if (!data.includes(version)) {
            setVersion(data[0] || '');
          }
          if (data.length === 0) setError(`No ${serverType} versions are currently available.`);
        })
        .catch(e => setError(String(e)))
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
           if (paths.length > 0 && javaPath === 'java') setJavaPath(paths[paths.length - 1]);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [step, serverType]);

  const selectDir = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === 'string') {
        setInstallPath(`${selected}\\${name.replace(/\\s+/g, '_')}`);
      }
    } catch (e) {
      console.error(e);
      setError(`Failed to open directory picker: ${e}`);
    }
  };

  const managedJavaMajor = requiredJavaMajor(version, serverType);
  const javaCompatible = selectedJavaMajor !== null && selectedJavaMajor >= managedJavaMajor;

  useEffect(() => {
    let active = true;
    setSelectedJavaMajor(null);
    if (!javaPath.trim()) return () => { active = false; };
    invoke<number>('get_java_major', { path: javaPath })
      .then(major => { if (active) setSelectedJavaMajor(major); })
      .catch(() => { if (active) setSelectedJavaMajor(null); });
    return () => { active = false; };
  }, [javaPath]);

  const installJava = async () => {
    const id = `java-${managedJavaMajor}`;
    reportInstall({ id, name: `Java ${managedJavaMajor}`, state: 'downloading' });
    setInstallingJava(true);
    setError(null);
    try {
      const path = await invoke<string>('install_managed_java', { major: managedJavaMajor });
      setJavaPath(path);
      setDetectedJavas(current => current.includes(path) ? current : [...current, path]);
      reportInstall({ id, name: `Java ${managedJavaMajor}`, state: 'done' });
    } catch (error) {
      reportInstall({ id, name: `Java ${managedJavaMajor}`, state: 'failed' });
      setError(String(error));
    } finally {
      setInstallingJava(false);
    }
  };

  const handleInstall = async () => {
    if (serverType !== 'velocity' && !eulaAccepted) {
      setError('You must accept the EULA to install the server.');
      return;
    }

    setStep(8);
    const installId = `server-${Date.now()}`;
    reportInstall({ id: installId, name: `${serverType} ${version}`, state: 'downloading' });
    setInstallStatus('Creating folders...');
    
    try {
      // 1. Create folders
      await invoke('create_new_folder', { baseDir: installPath, subPath: '.' });
      
      // 2. Download jar
      setInstallStatus('Downloading server jar...');
      let jarName = 'server.jar';
      const jarPath = `${installPath}\\${jarName}`;
      
      const unlisten = await listen<{downloaded: number, total: number}>('download-progress', (event) => {
        const { downloaded, total } = event.payload;
        setDownloadProgress((downloaded / total) * 100);
        reportInstall({ id: installId, name: `${serverType} ${version}`, downloaded, total, state: 'downloading' });
      });

      if (['fabric', 'forge', 'neoforge'].includes(serverType)) {
        jarName = await invoke<string>('install_loader', { serverType, version, serverPath: installPath, javaPath });
      } else {
        await invoke('download_software', { serverType, version, path: jarPath });
      }
      unlisten();

      if (serverType !== 'velocity') {
        setInstallStatus('Accepting EULA...');
        await invoke('accept_eula', { serverPath: installPath });
        setInstallStatus('Creating server.properties...');
        const props = `server-port=${port}\nmotd=${name}\n`;
        await invoke('save_file_content', { baseDir: installPath, subPath: 'server.properties', content: props });
      }

      // 5. Save Server Profile
      setInstallStatus('Saving profile...');
      const newServer: Server = {
        name,
        minecraft_version: version,
        server_type: serverType,
        install_path: installPath,
        jar_path: jarName, // relative or absolute depending on how process.rs is written. We use relative to install_path in process.rs.
        status: 'offline',
        ram_min: ramMin,
        ram_max: ramMax,
        java_path: javaPath,
        run_in_container: runInContainer,
        created_at: new Date().toISOString(),
        port,
      };

      await invoke('create_new_server', { server: newServer });

      if (settings) {
        const updatedSettings = {
          ...settings,
          default_java_path: javaPath,
        };
        try {
          await invoke('save_settings', { settings: updatedSettings });
          await fetchSettings();
        } catch (settingsErr) {
          console.warn("Failed to save java path to settings:", settingsErr);
        }
      }

      await fetchServers();
      
      setInstallStatus('Complete!');
      reportInstall({ id: installId, name: `${serverType} ${version}`, state: 'done' });
      setTimeout(() => navigate('/servers'), 1500);

    } catch (err: any) {
      reportInstall({ id: installId, name: `${serverType} ${version}`, state: 'failed' });
      setError(err.toString());
      setStep(7); // go back to EULA step on error
    }
  };

  return (
    <div id="tour-wizard" data-step={step} className="p-4 sm:p-6 lg:p-8 w-full flex flex-col h-full">
      <div>
        <PageHeader title="Create New Server" />
        {/* Progress Bar */}
        <div className="-mt-2 mb-8 flex items-center gap-2">
          {[1,2,3,4,5,6,7,8].map(s => (
            <div key={s} className="flex-1 h-2 rounded-full overflow-hidden bg-[#2a2b2f]">
              <div className={`h-full transition-all duration-300 ${s < step ? 'bg-emerald-500' : s === step ? 'bg-blue-500' : 'bg-transparent'}`}></div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 bg-[#1c1d21] border border-[#2a2b2f] rounded-lg p-8 shadow-xl">
        {step < 8 && !localStorage.getItem('minedock_tour_seen') && (
          <div className="mb-6 rounded-md border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">
            <span className="font-semibold">Tutorial:</span> {TUTORIAL[step]}
          </div>
        )}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-md text-sm">
            {error}
          </div>
        )}

        {step === 1 && (
          <div id="tour-install-path" className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <h2 className="text-xl font-semibold text-white">1. Server Name</h2>
            <p className="text-gray-400 text-sm">Give your new Minecraft server a recognizable name.</p>
            <input
              id="tour-server-name"
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
              <button type="button" onClick={(e) => { e.preventDefault(); selectDir(); }} className="px-4 py-3 bg-[#2a2b2f] hover:bg-[#3a3b3f] text-white rounded-md transition-colors flex items-center gap-2">
                <Folder size={18} /> Browse
              </button>
            </div>
            {!hasValidInstallPath && <p className="text-red-400 text-xs">Enter a valid absolute Windows path.</p>}
          </div>
        )}

        {step === 3 && (
          <div id="tour-software-version" className="space-y-5 animate-in fade-in slide-in-from-right-4">
            <div>
              <h2 className="text-xl font-semibold text-white">3. Server Software</h2>
              <p className="text-gray-400 text-sm mt-1">Choose software, then select an available version.</p>
            </div>
            <div id="tour-software-select" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {SOFTWARE.map(software => (
                <button
                  key={software.id}
                  type="button"
                  onClick={() => {
                    setServerType(software.id);
                    setVersion('');
                    if (software.id === 'velocity' && port === 25565) setPort(25577);
                    if (software.id !== 'velocity' && port === 25577) setPort(25565);
                  }}
                  className={`flex items-center gap-3 p-4 rounded-lg border text-left transition-colors ${serverType === software.id ? 'border-blue-500 bg-blue-500/10' : 'border-[#2a2b2f] bg-[#141517] hover:border-gray-600'}`}
                >
                  <img src={software.icon} alt="" className="w-9 h-9 object-contain" />
                  <span className="min-w-0">
                    <span className="block font-semibold text-white">{software.name}</span>
                    <span className="block text-xs text-gray-500 truncate">{software.description}</span>
                  </span>
                </button>
              ))}
            </div>
            {loading ? (
              <div className="flex items-center gap-3 text-gray-400 py-4">
                <Loader2 size={20} className="animate-spin" /> Fetching {serverType} versions...
              </div>
            ) : (
              <select
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-4 py-3 text-white focus:outline-none focus:border-blue-500 appearance-none"
              >
                {versions.map(item => <option key={item} value={item}>{item}</option>)}
              </select>
            )}
          </div>
        )}

     {step === 4 && (
          <div id="tour-ram" className="space-y-6 animate-in fade-in slide-in-from-right-4">
            <div>
              <h2 className="text-xl font-semibold text-white">4. RAM Allocation</h2>
              <p className="text-gray-400 text-sm mt-1">Allocate memory for your server. (System has {sysMemory} MB total)</p>
            </div>
            
            <div className="space-y-6">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm text-gray-400">Minimum RAM (Xms)</label>
                  <span className="text-sm font-semibold text-white">{ramMin} MB</span>
                </div>
                <div className="flex gap-4 items-center">
                  <input
                    type="range"
                    min={512}
                    max={ramMax}
                    step={256}
                    value={ramMin}
                    onChange={(e) => setRamMin(Math.min(parseInt(e.target.value) || 1024, ramMax))}
                    className="flex-1 accent-blue-500 h-2 bg-[#2a2b2f] rounded-lg appearance-none cursor-pointer"
                  />
                  <input
                    type="number"
                    value={ramMin}
                    onChange={(e) => setRamMin(Math.min(parseInt(e.target.value) || 0, sysMemory))}
                    className="w-28 bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-1.5 text-white text-center focus:outline-none focus:border-blue-500"
                    placeholder="MB"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm text-gray-400">Maximum RAM (Xmx)</label>
                  <span className="text-sm font-semibold text-white">{ramMax} MB</span>
                </div>
                <div className="flex gap-4 items-center">
                  <input
                    type="range"
                    min={1024}
                    max={sysMemory}
                    step={256}
                    value={ramMax}
                    onChange={(e) => {
                      const newMax = parseInt(e.target.value) || 1024;
                      setRamMax(newMax);
                      if (ramMin > newMax) setRamMin(newMax);
                    }}
                    className="flex-1 accent-blue-500 h-2 bg-[#2a2b2f] rounded-lg appearance-none cursor-pointer"
                  />
                  <input
                    type="number"
                    value={ramMax}
                    onChange={(e) => {
                      const newMax = Math.min(parseInt(e.target.value) || 0, sysMemory);
                      setRamMax(newMax);
                      if (ramMin > newMax) setRamMin(newMax);
                    }}
                    className="w-28 bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-1.5 text-white text-center focus:outline-none focus:border-blue-500"
                    placeholder="MB"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 5 && (
          <div id="tour-port" className="space-y-4 animate-in fade-in slide-in-from-right-4">
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
          <div id="tour-java" className="space-y-4 animate-in fade-in slide-in-from-right-4">
            <h2 className="text-xl font-semibold text-white">6. Java Path & Environment</h2>
            <p className="text-gray-400 text-sm">Configure how Minecraft will run. You can run locally or isolate using a Docker container.</p>
            
            <div className="flex flex-col border border-[#2a2b2f] bg-[#0f0f11] rounded-lg p-4 space-y-3">
              <label className="text-sm font-semibold text-white">Docker Containerization</label>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  disabled={!dockerAvailable}
                  onClick={() => setRunInContainer(!runInContainer)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${runInContainer ? 'bg-blue-600' : 'bg-gray-700'} disabled:opacity-40`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${runInContainer ? 'translate-x-5' : 'translate-x-0'}`}
                  />
                </button>
                <span className="text-xs text-gray-400">
                  {dockerAvailable
                    ? 'Run inside a container. The correct Java version will be pulled and managed automatically by Docker.'
                    : 'Docker is not running or not installed on this machine.'}
                </span>
              </div>
            </div>

            {runInContainer ? (
              <div className="p-4 border border-blue-500/20 bg-blue-500/5 rounded-md text-sm text-blue-200">
                Docker is enabled. MineDock will configure and launch the server in a container mapping port <span className="font-mono">{port}</span>. No local Java installation is required.
              </div>
            ) : (
              loading ? (
                <div className="flex items-center gap-3 text-gray-400 py-4">
                  <Loader2 size={20} className="animate-spin" /> Detecting Java installations...
                </div>
              ) : (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={installJava}
                    disabled={installingJava}
                    className="action-button bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    style={{ '--action-width': '13.5rem' } as React.CSSProperties}
                  >
                    {installingJava && <Loader2 size={16} className="animate-spin" />}
                    {installingJava ? `Installing Java ${managedJavaMajor}...` : `Install managed Java ${managedJavaMajor}`}
                  </button>
                  <p className="text-xs text-gray-500">Stored inside MineDock. System Java and PATH stay unchanged.</p>
                  {!javaCompatible && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded text-sm">
                      {selectedJavaMajor
                        ? `Selected Java ${selectedJavaMajor} is too old. ${version || serverType} requires Java ${managedJavaMajor}.`
                        : `Select a working Java ${managedJavaMajor}+ executable or install the managed runtime.`}
                    </div>
                  )}
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
                        className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-4 py-3 text-white focus:outline-none focus:border-blue-500 appearance-none font-mono text-sm"
                      >
                        {detectedJavas.map((j, i) => (
                          <option key={i} value={j}>{j}</option>
                        ))}
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
              )
            )}
          </div>
        )}

        {step === 7 && (
          <div id="tour-eula" className="space-y-6 animate-in fade-in slide-in-from-right-4">
            <h2 className="text-xl font-semibold text-white">7. {serverType === 'velocity' ? 'Ready to Install' : 'Minecraft EULA'}</h2>
            {serverType === 'velocity' ? (
              <div className="bg-[#0f0f11] border border-[#2a2b2f] p-4 rounded-md text-sm text-gray-400">
                Velocity is a proxy and does not require a Minecraft server EULA file. Continue to install the selected build.
              </div>
            ) : (
              <>
                <div className="bg-[#0f0f11] border border-[#2a2b2f] p-4 rounded-md text-sm text-gray-400 h-32 overflow-y-auto">
                  By checking below you agree to the Minecraft EULA at https://aka.ms/MinecraftEULA.
                </div>
                <label className="flex items-center gap-3 cursor-pointer p-4 bg-[#2a2b2f]/30 rounded-md border border-[#2a2b2f] hover:border-blue-500/50 transition-colors">
                  <input type="checkbox" checked={eulaAccepted} onChange={(e) => setEulaAccepted(e.target.checked)} className="w-5 h-5 rounded border-[#2a2b2f] bg-[#0f0f11] text-blue-600 focus:ring-blue-500" />
                  <span className="text-white font-medium">I accept the Minecraft EULA</span>
                </label>
              </>
            )}
          </div>
        )}

     {step === 8 && (
          <div className="fixed inset-0 z-[10001] space-y-6 animate-in fade-in flex flex-col items-center justify-center bg-[#0f0f11]">
            <h2 className="text-2xl font-bold text-white">Installing Server</h2>
            <p className="text-gray-400">{installStatus}</p>
            
            {downloadProgress > 0 && downloadProgress < 100 && (
              <div className="w-full max-w-md mt-4">
                <div className="h-2 w-full bg-[#2a2b2f] rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500" style={{ width: `${downloadProgress}%` }}></div>
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
            id="tour-wizard-next"
            onClick={() => {
              setError(null);
              if (step === 2 && !hasValidInstallPath) {
                setError('Enter a valid absolute Windows installation path');
                return;
              }
              if (step === 3 && !version) {
                setError('Select an available software version');
                return;
              }
              if (step === 5) {
                const portInUse = servers.some(s => s.port === port);
                if (portInUse) {
                   setError(`Port ${port} is already in use by another server.`);
                   return;
                }
              }
              setStep(step + 1);
            }}
            disabled={(step === 2 && !hasValidInstallPath) || (step === 3 && (loading || !version)) || (step === 6 && !runInContainer && !javaCompatible)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next <ChevronRight size={18} />
          </button>
        )}

        {step === 7 && (
          <button
            id="tour-install-server"
            onClick={() => {
              window.dispatchEvent(new Event('minedock:wizard-complete'));
              handleInstall();
            }}
            disabled={serverType !== 'velocity' && !eulaAccepted}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-md font-medium transition-colors disabled:opacity-50"
          >
            <Check size={18} /> Install Server
          </button>
        )}
      </div>
    </div>
  );
}
