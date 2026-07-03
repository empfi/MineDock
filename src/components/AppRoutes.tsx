import { useEffect } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Server } from 'lucide-react';
import { useStore } from '../store';
import EmptyState from './EmptyState';
import Overview from '../pages/Overview';
import Servers from '../pages/Servers';
import Console from '../pages/Console';
import Files from '../pages/Files';
import Properties from '../pages/Properties';
import Backups from '../pages/Backups';
import Versions from '../pages/Versions';
import Logs from '../pages/Logs';
import Settings from '../pages/Settings';
import Wizard from '../pages/Wizard';
import Players from '../pages/Players';
import Worlds from '../pages/Worlds';
import Additions from '../pages/Additions';
import Health from '../pages/Health';
import Assistant from '../pages/Assistant';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Overview',
  '/servers': 'Servers',
  '/settings': 'Settings',
  '/wizard': 'Create Server',
  '/console': 'Console',
  '/players': 'Players',
  '/additions': 'Additions',
  '/worlds': 'Worlds',
  '/files': 'Files',
  '/properties': 'Properties',
  '/versions': 'Versions',
  '/backups': 'Backups',
  '/logs': 'Logs',
  '/health': 'Health',
  '/assistant': 'DockAI',
};

function ServerRequired({ children }: { children: React.ReactNode }) {
  const selectedServerId = useStore(state => state.selectedServerId);
  const navigate = useNavigate();
  if (selectedServerId) return children;
  return <div className="p-4 sm:p-6 lg:p-8"><EmptyState icon={Server} title="Choose a server" description="Select a server before opening this workspace." action="View servers" onAction={() => navigate('/servers')} /></div>;
}

export default function AppRoutes() {
  const location = useLocation();

  useEffect(() => {
    const title = `MineDock - ${PAGE_TITLES[location.pathname] ?? 'Overview'}`;
    document.title = title;
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [location.pathname]);

  const assistantActive = location.pathname === '/assistant';

  return (
    <>
    <div className={assistantActive ? 'route-view' : 'hidden'}>
      <Assistant />
    </div>
    {!assistantActive && <div key={location.pathname} className="route-view">
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/servers" element={<Servers />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/wizard" element={<Wizard />} />
        <Route path="/console" element={<ServerRequired><Console /></ServerRequired>} />
        <Route path="/players" element={<ServerRequired><Players /></ServerRequired>} />
        <Route path="/additions" element={<ServerRequired><Additions /></ServerRequired>} />
        <Route path="/worlds" element={<ServerRequired><Worlds /></ServerRequired>} />
        <Route path="/files" element={<ServerRequired><Files /></ServerRequired>} />
        <Route path="/properties" element={<ServerRequired><Properties /></ServerRequired>} />
        <Route path="/versions" element={<ServerRequired><Versions /></ServerRequired>} />
        <Route path="/backups" element={<ServerRequired><Backups /></ServerRequired>} />
        <Route path="/logs" element={<ServerRequired><Logs /></ServerRequired>} />
        <Route path="/health" element={<ServerRequired><Health /></ServerRequired>} />
      </Routes>
    </div>}
    </>
  );
}
