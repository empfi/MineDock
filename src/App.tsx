import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { listen } from '@tauri-apps/api/event';
import { useStore } from './store';
import { Server, Settings, Terminal, FolderGit2, Save, Download, FileText, Database, Plus } from 'lucide-react';
import { cn } from './lib/utils';

// Pages
import Overview from './pages/Overview';
import Servers from './pages/Servers';
import Console from './pages/Console';
import Files from './pages/Files';
import Properties from './pages/Properties';
import Backups from './pages/Backups';
import Versions from './pages/Versions';
import Logs from './pages/Logs';
import SettingsPage from './pages/Settings';
import Wizard from './pages/Wizard';

function Sidebar() {
  const { servers, selectedServerId } = useStore();
  const selectedServer = servers.find(s => s.id === selectedServerId);

  const links = [
    { to: "/", icon: Database, label: "Overview", exact: true },
    { to: "/servers", icon: Server, label: "Servers", exact: false },
    { to: "/settings", icon: Settings, label: "Settings", exact: false },
  ];

  const serverLinks = [
    { to: "/console", icon: Terminal, label: "Console" },
    { to: "/files", icon: FolderGit2, label: "Files" },
    { to: "/properties", icon: Save, label: "Properties" },
    { to: "/versions", icon: Download, label: "Versions" },
    { to: "/backups", icon: Database, label: "Backups" },
    { to: "/logs", icon: FileText, label: "Logs" },
  ];

  return (
    <div className="w-64 bg-[#141517] border-r border-[#2a2b2f] h-screen flex flex-col flex-shrink-0">
      <div className="h-16 flex items-center px-6 border-b border-[#2a2b2f]">
        <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
          <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center">
            <Server size={14} className="text-white" />
          </div>
          MineDock
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto py-4 flex flex-col gap-6">
        <nav className="px-4 space-y-1">
          {links.map(link => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.exact}
              className={({ isActive }) => cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive ? "bg-[#2a2b2f] text-white" : "text-gray-400 hover:text-gray-200 hover:bg-[#202124]"
              )}
            >
              <link.icon size={18} />
              {link.label}
            </NavLink>
          ))}
        </nav>

        {selectedServer && (
          <div>
            <div className="px-6 mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {selectedServer.name}
            </div>
            <nav className="px-4 space-y-1">
              {serverLinks.map(link => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) => cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    isActive ? "bg-blue-600/10 text-blue-500" : "text-gray-400 hover:text-gray-200 hover:bg-[#202124]"
                  )}
                >
                  <link.icon size={18} />
                  {link.label}
                </NavLink>
              ))}
            </nav>
          </div>
        )}
      </div>

      <div className="p-4 border-t border-[#2a2b2f]">
        <NavLink
          to="/wizard"
          className="flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
        >
          <Plus size={18} />
          New Server
        </NavLink>
      </div>
    </div>
  );
}

function Layout() {
  const { fetchServers, fetchSettings, updateServerStatus } = useStore();

  useEffect(() => {
    fetchServers();
    fetchSettings();

    const unlisten = listen('server-status-changed', (event: any) => {
      const [id, status] = event.payload;
      updateServerStatus(id, status);
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  return (
    <div className="flex w-full h-screen overflow-hidden bg-[#0f0f11] text-gray-200 font-sans">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/servers" element={<Servers />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/wizard" element={<Wizard />} />
          
          <Route path="/console" element={<Console />} />
          <Route path="/files" element={<Files />} />
          <Route path="/properties" element={<Properties />} />
          <Route path="/versions" element={<Versions />} />
          <Route path="/backups" element={<Backups />} />
          <Route path="/logs" element={<Logs />} />
        </Routes>
      </main>
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
