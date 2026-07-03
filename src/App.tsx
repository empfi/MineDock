import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useStore } from './store';
import { Server, Settings, Terminal, FolderGit2, Save, Download, FileText, Database, Plus, Users, Globe2, Play, Square, RotateCw, ArrowLeft, Copy, X, Loader2, PackageSearch, Skull, HeartPulse, Search, Brain } from 'lucide-react';
import { cn } from './lib/utils';

import Notifications, { NotificationCenter } from './components/Notifications';
import WindowState from './components/WindowState';
import ProgressHub from './components/ProgressHub';
import { notify } from './components/Notifications';
import GuidedTour from './components/GuidedTour';
import AppRoutes from './components/AppRoutes';
import SafeApplyModal from './components/SafeApplyModal';
import { failArmedSafeApply, observeSafeApplyStatus } from './lib/safeApply';
import { getSoftwareInfo } from './lib/software';
import CommandPalette from './components/CommandPalette';
import { confirmNavigation } from './lib/navigationGuard';
function Sidebar() {
  const { servers, selectedServerId, setSelectedServer } = useStore();
  const selectedServer = servers.find(s => s.id === selectedServerId);
  const location = useLocation();
  const navigate = useNavigate();
  const [serverAction, setServerAction] = useState<'start' | 'stop' | 'restart' | 'kill' | null>(null);
  const serverPaths = ['/console', '/health', '/players', '/additions', '/worlds', '/files', '/properties', '/versions', '/backups', '/logs'];
  const managingServer = Boolean(selectedServer && serverPaths.includes(location.pathname));

  const links = [
    { to: "/", icon: Database, label: "Overview", exact: true },
    { to: "/servers", icon: Server, label: "Servers", exact: false },
    { to: "/settings", icon: Settings, label: "Settings", exact: false },
    { to: "/assistant", icon: Brain, label: "DockAI", exact: false },
  ];

  const serverLinks = [
    { to: "/console", icon: Terminal, label: "Console" },
    { to: "/health", icon: HeartPulse, label: "Health" },
    { to: "/files", icon: FolderGit2, label: "Files" },
    { to: "/additions", icon: PackageSearch, label: "Additions" },
    { to: "/players", icon: Users, label: "Players" },
    { to: "/worlds", icon: Globe2, label: "Worlds" },
    { to: "/properties", icon: Save, label: "Properties" },
    { to: "/backups", icon: Database, label: "Backups" },
    { to: "/versions", icon: Download, label: "Versions" },
    { to: "/logs", icon: FileText, label: "Logs" },
  ];

  const runServerAction = async (action: 'start' | 'stop' | 'restart' | 'kill') => {
    if (!selectedServer?.id) return;
    setServerAction(action);
    try {
      if (action === 'start') {
        await invoke('start_mc_server', { id: selectedServer.id });
      } else if (action === 'kill') {
        await invoke('kill_mc_server', { id: selectedServer.id });
      } else {
        await invoke('stop_mc_server', { id: selectedServer.id });
        if (action === 'restart') {
          for (let attempt = 0; attempt < 30; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const status = useStore.getState().servers.find(server => server.id === selectedServer.id)?.status;
            if (status === 'offline') {
              await invoke('start_mc_server', { id: selectedServer.id });
              return;
            }
          }
          throw new Error('Server did not stop within 30 seconds');
        }
      }
    } catch (error) {
      if (!failArmedSafeApply(selectedServer.id, error)) {
        notify(`Failed to ${action} server: ${error}`, 'error');
      }
    } finally {
      setServerAction(null);
    }
  };

  const leaveServer = () => {
    if (!confirmNavigation()) return;
    setSelectedServer(null);
    navigate('/servers');
  };

  return (
    <div className="w-16 sm:w-20 lg:w-64 bg-[#141517] border-r border-[#2a2b2f] h-full flex flex-col flex-shrink-0">
      <div className="h-16 flex items-center justify-center lg:justify-start px-2 lg:px-4 border-b border-[#2a2b2f]">
        {managingServer && (
          <button
            onClick={leaveServer}
            title="Back to servers"
            aria-label="Back to servers"
            className="mr-2 rounded-md p-1.5 text-gray-500 transition-colors hover:bg-[#202124] hover:text-white"
          >
            <ArrowLeft size={17} />
          </button>
        )}
        <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
          {!managingServer && <img src="/logo.png" alt="MineDock" className="w-6 h-6 rounded" />}
          <span className="hidden lg:inline">{managingServer ? selectedServer?.name : 'MineDock'}</span>
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto py-4 flex flex-col gap-6">
        {!managingServer && <nav className="px-2 lg:px-4 space-y-1">
          {links.map(link => (
            <NavLink
              key={link.to}
              to={link.to}
              id={link.to === '/servers' ? 'tour-servers-tab' : undefined}
              end={link.exact}
              aria-label={link.label}
              title={link.label}
              className={({ isActive }) => cn(
                "flex items-center justify-center lg:justify-start gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive ? "bg-[#2a2b2f] text-white" : "text-gray-400 hover:text-gray-200 hover:bg-[#202124]"
              )}
            >
              <link.icon size={18} />
              <span className="hidden lg:inline">{link.label}</span>
            </NavLink>
          ))}
        </nav>}

        {managingServer && (
          <div className="flex-1 flex flex-col">
            <nav className="px-2 lg:px-4 space-y-1">
              {serverLinks.map(link => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  id={link.to === '/servers' ? 'tour-servers-tab' : undefined}
                  aria-label={link.label}
                  title={link.label}
                  className={({ isActive }) => cn(
                    "flex items-center justify-center lg:justify-start gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    isActive ? "bg-blue-600/10 text-blue-500" : "text-gray-400 hover:text-gray-200 hover:bg-[#202124]"
                  )}
                >
                  <link.icon size={18} />
                  <span className="hidden lg:inline">{link.label}</span>
                </NavLink>
              ))}
            </nav>
          </div>
        )}
      </div>

      <div className="p-2 lg:p-4 border-t border-[#2a2b2f]">
        {managingServer ? (
          <div className="space-y-2">
            <div className="grid grid-cols-4 gap-2">
              <button
                onClick={() => runServerAction('start')}
                disabled={serverAction !== null || (selectedServer?.status !== 'offline' && selectedServer?.status !== 'crashed' && selectedServer?.status !== 'crash-loop')}
                title={serverAction ? `${serverAction} in progress` : selectedServer?.status === 'online' ? 'Server is already running' : 'Start server'}
                aria-label="Start server"
                className="flex items-center justify-center py-2 rounded-md bg-emerald-600/15 text-emerald-400 hover:bg-emerald-600/25 disabled:opacity-30 disabled:cursor-not-allowed"
              >{serverAction === 'start' ? <Loader2 size={17} className="animate-spin" /> : <Play size={17} />}</button>
              <button
                onClick={() => runServerAction('restart')}
                disabled={serverAction !== null || selectedServer?.status !== 'online'}
                title={serverAction ? `${serverAction} in progress` : selectedServer?.status !== 'online' ? 'Server must be online to restart' : 'Restart server'}
                aria-label="Restart server"
                className="flex items-center justify-center py-2 rounded-md bg-blue-600/15 text-blue-400 hover:bg-blue-600/25 disabled:opacity-30 disabled:cursor-not-allowed"
              >{serverAction === 'restart' ? <Loader2 size={17} className="animate-spin" /> : <RotateCw size={17} />}</button>
              <button
                onClick={() => runServerAction('stop')}
                disabled={serverAction !== null || selectedServer?.status !== 'online'}
                title={serverAction ? `${serverAction} in progress` : selectedServer?.status !== 'online' ? 'Server is not running' : 'Stop server'}
                aria-label="Stop server"
                className="flex items-center justify-center py-2 rounded-md bg-red-600/15 text-red-400 hover:bg-red-600/25 disabled:opacity-30 disabled:cursor-not-allowed"
              >{serverAction === 'stop' ? <Loader2 size={16} className="animate-spin" /> : <Square size={16} />}</button>
              <button
                onClick={() => runServerAction('kill')}
                disabled={serverAction !== null || !selectedServer || ['offline', 'crashed', 'crash-loop', 'restarting'].includes(selectedServer.status)}
                title={selectedServer?.status === 'restarting' ? 'Waiting for automatic restart' : 'Kill server process (Force Stop)'}
                aria-label="Kill server process"
                className="flex items-center justify-center py-2 rounded-md bg-rose-600/15 text-rose-400 hover:bg-rose-600/25 disabled:opacity-30 disabled:cursor-not-allowed"
              >{serverAction === 'kill' ? <Loader2 size={17} className="animate-spin" /> : <Skull size={17} />}</button>
            </div>
          </div>
        ) : <NavLink
          to="/wizard"
          aria-label="New Server"
          title="New Server"
          className="flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white px-2 lg:px-4 py-2 rounded-md text-sm font-medium transition-colors"
        >
          <Plus size={18} />
          <span className="hidden lg:inline">New Server</span>
        </NavLink>}
      </div>
    </div>
  );
}

const appWindow = getCurrentWindow();

function TitleBar() {
  const onMinimize = () => appWindow.minimize();
  const onMaximize = () => appWindow.toggleMaximize();
  const onClose = () => appWindow.close();

  return (
    <div
      className="h-10 bg-[#141517] border-b border-[#2a2b2f] flex items-center justify-between pl-3 pr-0 select-none flex-shrink-0 z-[20000]"
    >
      <div className="flex items-center gap-2 pointer-events-none">
        <img src="/logo.png" alt="" className="w-5 h-5 rounded" />
        <span className="text-xs font-semibold text-gray-300 font-sans">MineDock</span>
      </div>
      
      {/* Spacer / Drag region */}
      <div data-tauri-drag-region className="flex-1 h-full" />
      
      <div className="flex items-center">
        <button onClick={() => window.dispatchEvent(new Event('minedock:command-palette'))} className="mr-1 flex h-7 w-44 items-center gap-2 rounded-md border border-[#2a2b2f] px-2.5 text-xs text-gray-500 hover:bg-[#202124] hover:text-gray-200" title="Open command palette">
          <Search size={13} />
          <span>Search</span>
          <kbd className="text-[10px] text-gray-600">Ctrl K</kbd>
        </button>
        <ProgressHub />
        <NotificationCenter />
        <button
          onClick={onMinimize}
          className="h-10 w-11 flex items-center justify-center text-gray-400 hover:bg-[#202124] hover:text-white transition-colors"
          title="Minimize"
          aria-label="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1">
            <line x1="0" y1="0.5" x2="10" y2="0.5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          onClick={onMaximize}
          className="h-10 w-11 flex items-center justify-center text-gray-400 hover:bg-[#202124] hover:text-white transition-colors"
          title="Maximize"
          aria-label="Maximize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          onClick={onClose}
          className="h-10 w-11 flex items-center justify-center text-gray-400 hover:bg-red-600 hover:text-white transition-colors"
          title="Close"
          aria-label="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M 1,1 L 9,9 M 9,1 L 1,9" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function Layout() {
  const { 
    fetchServers, 
    fetchSettings, 
    updateServerStatus, 
    appendConsoleLog, 
    addServerStats, 
    addOnlinePlayer, 
    removeOnlinePlayer, 
    clearOnlinePlayers 
  } = useStore();
  const { servers, selectedServerId, openServerIds, setSelectedServer, closeServerTab, moveServerTab } = useStore();
  const settings = useStore(state => state.settings);
  const selectedServer = servers.find(server => server.id === selectedServerId);
  const location = useLocation();
  const navigate = useNavigate();
  const managingServer = ['/console', '/players', '/additions', '/worlds', '/files', '/properties', '/versions', '/backups', '/logs'].includes(location.pathname);
  const [draggedTab, setDraggedTab] = useState<number | null>(null);
  const [serverPickerOpen, setServerPickerOpen] = useState(false);
  const [serverSearch, setServerSearch] = useState('');
  const serverPickerRef = useRef<HTMLDivElement>(null);
  const [closingShare, setClosingShare] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  const closeTab = (id: number) => {
    closeServerTab(id);
    if (openServerIds.length === 1) navigate('/servers');
  };
  const setSharing = async (enabled: boolean) => {
    if (!selectedServer?.id || sharingBusy) return;
    setSharingBusy(true);
    if (!enabled) {
      setClosingShare(true);
      await new Promise(resolve => setTimeout(resolve, 180));
    }
    try {
      await invoke('set_server_sharing', { id: selectedServer.id, enabled });
      await useStore.getState().fetchServers();
    } catch (error) {
      notify(`Could not update sharing: ${error}`, 'error');
    } finally {
      setClosingShare(false);
      setSharingBusy(false);
    }
  };

  useEffect(() => {
    if (!serverPickerOpen) return;
    const closePicker = (event: PointerEvent) => {
      if (!serverPickerRef.current?.contains(event.target as Node)) {
        setServerPickerOpen(false);
        setServerSearch('');
      }
    };
    document.addEventListener('pointerdown', closePicker);
    return () => document.removeEventListener('pointerdown', closePicker);
  }, [serverPickerOpen]);

  useEffect(() => {
    if (draggedTab === null) return;
    const stopDragging = () => setDraggedTab(null);
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);
    return () => {
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
    };
  }, [draggedTab]);

  const handleTabStripWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const strip = event.currentTarget;
    if (strip.scrollWidth <= strip.clientWidth) return;
    if (event.deltaY === 0 && event.deltaX === 0) return;
    strip.scrollLeft -= event.deltaX !== 0 ? event.deltaX : event.deltaY;
    event.preventDefault();
  };

  useEffect(() => {
    fetchServers();
    fetchSettings();

    const unlisten = listen('server-status-changed', (event: any) => {
      const [id, status] = event.payload;
      updateServerStatus(id, status);
      observeSafeApplyStatus(id, status);
      const name = useStore.getState().servers.find(server => server.id === id)?.name ?? 'Server';
      if (status === 'crashed') notify(`${name} crashed. Check the latest log for details.`, 'error');
      if (status === 'crash-loop') notify(`${name} restart loop stopped after repeated crashes.`, 'error');
      if (status === 'restarting') notify(`${name} crashed and is restarting.`, 'warning');
      if (status === 'offline' || status === 'crashed') {
        clearOnlinePlayers(id);
      }
    });

    const unlistenConsole = listen('console-log', (event: any) => {
      const { server_id, line, is_error } = event.payload;
      appendConsoleLog(server_id, line, is_error);

      // Simple regex parser for Minecraft server player join/leave logs
      const cleanLine = line.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
      const joinMatch = cleanLine.match(/:\s+(\w+)\s+(?:joined the game|logged in|logged in with entity id)/i) || cleanLine.match(/UUID of player (\w+) is/i);
      if (joinMatch) {
        addOnlinePlayer(server_id, joinMatch[1]);
      } else {
        const leaveMatch = cleanLine.match(/:\s+(\w+)\s+(?:left the game|disconnected|lost connection)/i);
        if (leaveMatch) {
          removeOnlinePlayer(server_id, leaveMatch[1]);
        }
      }
    });

    const unlistenStats = listen('server-stats', (event: any) => {
      const [id, cpu, memory] = event.payload;
      addServerStats(id, cpu, memory);
    });

    const unlistenRestart = listen<number>('server-auto-restart', (event) => {
      invoke('start_mc_server', { id: event.payload }).catch(error => {
        appendConsoleLog(event.payload, `Auto-restart failed: ${error}`, true);
      });
    });

    return () => {
      unlisten.then(f => f());
      unlistenConsole.then(f => f());
      unlistenStats.then(f => f());
      unlistenRestart.then(f => f());
    };
  }, []);

  useEffect(() => {
    const openFailedSafeApply = (event: Event) => {
      const serverId = (event as CustomEvent<{ serverId?: number }>).detail?.serverId;
      if (serverId) setSelectedServer(serverId);
      navigate('/console');
    };
    window.addEventListener('minedock:safe-apply-failed', openFailedSafeApply);
    return () => window.removeEventListener('minedock:safe-apply-failed', openFailedSafeApply);
  }, [navigate, setSelectedServer]);

  const onlinePlayersState = useStore(state => state.onlinePlayers);

  useEffect(() => {
    const updateDiscordPresence = async () => {
      try {
        const runningServer = servers.find(s => s.status === 'online' || s.status === 'starting');
        if (runningServer) {
          const playersCur = runningServer.status === 'online' ? (onlinePlayersState[runningServer.id!]?.length ?? 0) : undefined;
          const startTime = runningServer.status === 'online' && runningServer.last_started_at 
            ? Math.floor(new Date(runningServer.last_started_at).getTime() / 1000) 
            : undefined;

          await invoke('update_discord_rpc', {
            details: `Running: ${runningServer.name}`,
            stateStr: `${runningServer.status === 'starting' ? 'Starting...' : 'Online'} (${runningServer.server_type})`,
            playersCur,
            installPath: runningServer.install_path,
            startTime,
          });
        } else if (selectedServer) {
          await invoke('update_discord_rpc', {
            details: `Managing: ${selectedServer.name}`,
            stateStr: `Idle | Version ${selectedServer.minecraft_version}`,
          });
        } else {
          await invoke('update_discord_rpc', {
            details: 'Idle',
            stateStr: 'Managing Minecraft Servers',
          });
        }
      } catch (err) {
        console.warn('Discord RPC update skipped/failed:', err);
      }
    };

    updateDiscordPresence();
  }, [servers, selectedServer, onlinePlayersState]);

  useEffect(() => {
    return () => {
      invoke('clear_discord_rpc').catch(() => {});
    };
  }, []);

  return (
    <div className="flex flex-col w-full h-screen overflow-hidden bg-[#0f0f11] text-gray-200 font-sans select-none">
      <WindowState />
      <TitleBar />
      <div className="flex flex-1 overflow-hidden min-h-0">
        <Sidebar />
        <main className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {managingServer && (
          <div className="server-tabs flex h-10 flex-shrink-0 border-b border-[#2a2b2f] bg-[#141517]">
            <div className="relative min-w-0 flex-1 h-full">
              <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-[#141517] to-transparent" />
              <div className="w-full h-full overflow-x-auto overflow-y-hidden" onWheel={handleTabStripWheel}>
                <div className="flex h-full min-w-max">
                {openServerIds.map((id, index) => {
                  const server = servers.find(item => item.id === id);
                  if (!server) return null;
                  return (
                    <div
                      key={id}
                      role="button"
                      tabIndex={0}
                      onPointerDown={event => {
                        if (event.button !== 0) return;
                        setDraggedTab(index);
                      }}
                      onPointerEnter={event => {
                        if ((event.buttons & 1) !== 0 && draggedTab !== null && draggedTab !== index) {
                          moveServerTab(draggedTab, index);
                          setDraggedTab(index);
                        }
                      }}
                      onClick={() => { if (confirmNavigation()) setSelectedServer(id); }}
                      onAuxClick={event => {
                        if (event.button === 1) closeTab(id);
                      }}
                      className={cn(
                        'group relative z-0 flex min-w-36 max-w-56 cursor-grab items-center gap-2 border-r border-[#2a2b2f] px-3 text-xs active:cursor-grabbing',
                        selectedServerId === id
                          ? 'bg-[#1c1d21] text-white shadow-[inset_0_-2px_0_0_rgb(59_130_246)]'
                          : 'text-gray-500 hover:bg-[#1b1c1f] hover:text-gray-300'
                      )}
                      title={`${server.name} · ${server.server_type}`}
                    >
                      <img src={getSoftwareInfo(server.server_type).icon} alt="" className="h-4 w-4 flex-shrink-0 object-contain" />
                      <span className="min-w-0 flex-1 truncate text-left">{server.name}</span>
                      <span
                        role="button"
                        aria-label={`Close ${server.name}`}
                        onPointerDown={event => event.stopPropagation()}
                        onClick={event => {
                          event.stopPropagation();
                          if (confirmNavigation()) closeTab(id);
                        }}
                        className="rounded p-0.5 text-gray-600 hover:bg-[#34353a] hover:text-white"
                      ><X size={13} /></span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div ref={serverPickerRef} className="relative flex-shrink-0 border-l border-[#2a2b2f]">
              <button
                onClick={() => setServerPickerOpen(open => !open)}
                className="relative z-20 flex h-full w-10 items-center justify-center text-gray-500 hover:bg-[#1b1c1f] hover:text-white"
                title="Open another server"
                aria-label="Open another server"
              >
                <Plus size={16} />
              </button>
              {serverPickerOpen && (
                <div className="fixed z-50 mt-1 w-56 overflow-hidden rounded-md border border-[#2a2b2f] bg-[#1c1d21] p-1 shadow-xl">
                  <div className="p-1">
                    <input
                      autoFocus
                      value={serverSearch}
                      onChange={event => setServerSearch(event.target.value)}
                      placeholder="Search servers..."
                      className="w-full rounded border border-[#2a2b2f] bg-[#0f0f11] px-2.5 py-1.5 text-sm text-white outline-none placeholder:text-gray-600 focus:border-blue-500"
                    />
                  </div>
                  {servers.filter(server =>
                    server.id &&
                    !openServerIds.includes(server.id) &&
                    server.name.toLowerCase().includes(serverSearch.toLowerCase())
                  ).map(server => (
                    <button
                      key={server.id}
                      onClick={() => {
                        if (!confirmNavigation()) return;
                        setSelectedServer(server.id!);
                        setServerPickerOpen(false);
                        setServerSearch('');
                      }}
                      className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-gray-300 hover:bg-[#2a2b2f] hover:text-white"
                    >
                      <img src={getSoftwareInfo(server.server_type).icon} alt="" className="h-4 w-4 object-contain" />
                      <span className="truncate">{server.name}</span>
                    </button>
                  ))}
                  {!servers.some(server =>
                    server.id &&
                    !openServerIds.includes(server.id) &&
                    server.name.toLowerCase().includes(serverSearch.toLowerCase())
                  ) && (
                    <div className="px-3 py-2 text-sm text-gray-600">{serverSearch ? 'No matching servers' : 'All servers are open'}</div>
                  )}
                </div>
              )}
            </div>
            {settings?.tunnel_enabled && selectedServer && (
              <div className="sticky right-0 ml-auto flex flex-shrink-0 items-center border-l border-[#2a2b2f] bg-[#141517] px-2">
                <div className={`overflow-hidden transition-[max-width,opacity,margin] duration-200 ease-out ${(selectedServer.share_enabled ?? true) && !closingShare ? 'mr-2 max-w-64 opacity-100' : 'mr-0 max-w-0 opacity-0'}`}>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`host.hyperplex.de:${selectedServer.port}`);
                      notify('Public address copied.', 'success', false);
                    }}
                    className="flex whitespace-nowrap items-center gap-2 px-2 font-mono text-xs text-blue-400 hover:text-blue-300"
                    title="Copy public address"
                  >
                    host.hyperplex.de:{selectedServer.port}
                    <Copy size={13} className="text-gray-500" />
                  </button>
                </div>
                <button
                  onClick={() => setSharing(!(selectedServer.share_enabled ?? true))}
                  disabled={sharingBusy}
                  role="switch"
                  aria-checked={selectedServer.share_enabled ?? true}
                  title={(selectedServer.share_enabled ?? true) ? 'Disable public sharing' : 'Enable public sharing'}
                  className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50 ${(selectedServer.share_enabled ?? true) ? 'bg-blue-600' : 'bg-[#34353a]'}`}
                >
                  <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-200 ${(selectedServer.share_enabled ?? true) ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
            )}
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto">
        <AppRoutes />
        </div>
        </main>
      </div>
      <Notifications />
      <GuidedTour />
      <SafeApplyModal />
      <CommandPalette />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  );
}
