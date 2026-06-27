import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { notify } from '../components/Notifications';
import { Folder, Loader2, PlugZap } from 'lucide-react';
import { AppSettings } from '../types';
import UnsavedChangesBar from '../components/UnsavedChangesBar';

export default function SettingsPage() {
  const { settings, fetchSettings } = useStore();
  const [localSettings, setLocalSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingRelay, setTestingRelay] = useState(false);

  useEffect(() => {
    if (settings) {
      setLocalSettings(settings);
    }
  }, [settings]);

  const handleSave = async () => {
    if (!localSettings) return;
    if (errors.length) return;
    setSaving(true);
    try {
      await invoke('save_settings', { settings: localSettings });
      await fetchSettings();
      notify('Settings saved.', 'success');
    } catch (e) {
      notify(`Failed to save settings: ${e}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const dirty = Boolean(settings && localSettings && JSON.stringify(settings) !== JSON.stringify(localSettings));
  const errors = localSettings ? [
    ...(localSettings.default_ram_min > localSettings.default_ram_max ? ['Minimum RAM cannot exceed maximum RAM.'] : []),
    ...(localSettings.tunnel_enabled && !/^[^:]+:\d+$/.test(localSettings.tunnel_relay) ? ['Relay address must use host:port format.'] : []),
    ...(localSettings.tunnel_enabled && localSettings.tunnel_token.length < 32 ? ['Relay token must contain at least 32 characters.'] : []),
  ] : [];

  const testRelay = async () => {
    if (!localSettings || errors.some(error => error.startsWith('Relay'))) return;
    setTestingRelay(true);
    try {
      await invoke('test_relay_connection', { relay: localSettings.tunnel_relay, token: localSettings.tunnel_token });
      notify('Relay connection successful.', 'success');
    } catch (error) {
      notify(`Relay test failed: ${error}`, 'error');
    } finally {
      setTestingRelay(false);
    }
  };

  const selectDir = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === 'string' && localSettings) {
        setLocalSettings({ ...localSettings, default_server_dir: selected });
      }
    } catch (e) {
      console.error(e);
      notify(`Failed to open directory picker: ${e}`, 'error');
    }
  };

  if (!localSettings) return (
    <div className="p-8 space-y-6 animate-pulse">
      <div className="h-8 w-40 rounded bg-[#25262a]" />
      {[1, 2, 3].map(item => <div key={item} className="h-44 rounded-lg border border-[#2a2b2f] bg-[#1c1d21]" />)}
    </div>
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Settings</h1>
          <p className="text-gray-400">Configure global MineDock application settings.</p>
        </div>
      </div>

      <div className="space-y-6">
        {errors.length > 0 && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {errors.map(error => <div key={error}>{error}</div>)}
          </div>
        )}
        <div className="bg-[#1c1d21] border border-[#2a2b2f] rounded-lg overflow-hidden">
          <div className="p-4 border-b border-[#2a2b2f] bg-[#141517]">
            <h2 className="text-lg font-semibold text-white">Defaults</h2>
          </div>
          <div className="p-6 space-y-6">
            
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Default Server Directory</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={localSettings.default_server_dir}
                  onChange={(e) => setLocalSettings({...localSettings, default_server_dir: e.target.value})}
                  className="flex-1 bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                  placeholder="e.g. C:\MineDock\Servers"
                />
                <button
                  onClick={selectDir}
                  className="px-4 py-2 bg-[#2a2b2f] hover:bg-[#3a3b3f] text-white rounded-md transition-colors flex items-center gap-2"
                >
                  <Folder size={18} />
                  Browse
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">Where new servers will be created by default.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Default Java Path</label>
              <input
                type="text"
                value={localSettings.default_java_path}
                onChange={(e) => setLocalSettings({...localSettings, default_java_path: e.target.value})}
                className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                placeholder="java"
              />
              <p className="text-xs text-gray-500 mt-1">Command or absolute path to java executable. 'java' uses PATH.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Default Min RAM (MB)</label>
                <input
                  type="number"
                  value={localSettings.default_ram_min}
                  onChange={(e) => setLocalSettings({...localSettings, default_ram_min: parseInt(e.target.value) || 1024})}
                  className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Default Max RAM (MB)</label>
                <input
                  type="number"
                  value={localSettings.default_ram_max}
                  onChange={(e) => setLocalSettings({...localSettings, default_ram_max: parseInt(e.target.value) || 4096})}
                  className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

          </div>
        </div>

        <div className="bg-[#1c1d21] border border-[#2a2b2f] rounded-lg overflow-hidden">
          <div className="p-4 border-b border-[#2a2b2f] bg-[#141517]">
            <h2 className="text-lg font-semibold text-white">Reliability & Public Access</h2>
          </div>
          <div className="p-6 space-y-5">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={localSettings.auto_restart}
                onChange={(e) => setLocalSettings({...localSettings, auto_restart: e.target.checked})}
                className="w-5 h-5 rounded border-[#2a2b2f] bg-[#0f0f11] text-blue-600"
              />
              <span className="text-gray-300">Restart crashed servers automatically after 5 seconds</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={localSettings.tunnel_enabled}
                onChange={(e) => setLocalSettings({...localSettings, tunnel_enabled: e.target.checked})}
                className="w-5 h-5 rounded border-[#2a2b2f] bg-[#0f0f11] text-blue-600"
              />
              <span className="text-gray-300">Enable public TCP tunnel</span>
            </label>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Relay address</label>
                <input
                  value={localSettings.tunnel_relay}
                  onChange={(e) => setLocalSettings({...localSettings, tunnel_relay: e.target.value})}
                  disabled={!localSettings.tunnel_enabled}
                  className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2 text-white disabled:opacity-50"
                  placeholder="relay.example.com:7000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Shared token</label>
                <input
                  type="password"
                  value={localSettings.tunnel_token}
                  onChange={(e) => setLocalSettings({...localSettings, tunnel_token: e.target.value})}
                  disabled={!localSettings.tunnel_enabled}
                  className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2 text-white disabled:opacity-50"
                  placeholder="At least 32 random characters"
                />
              </div>
            </div>
            <p className="text-xs text-gray-500">Each server uses its configured port publicly. Ports must be unique and open on relay firewall.</p>
            <button
              onClick={testRelay}
              disabled={!localSettings.tunnel_enabled || testingRelay || errors.some(error => error.startsWith('Relay'))}
              className="flex items-center gap-2 rounded-md bg-[#2a2b2f] px-3 py-2 text-sm text-white hover:bg-[#3a3b3f] disabled:opacity-40"
            >
              {testingRelay ? <Loader2 size={16} className="animate-spin" /> : <PlugZap size={16} />}
              {testingRelay ? 'Testing relay...' : 'Test relay connection'}
            </button>
          </div>
        </div>

        <div className="bg-[#1c1d21] border border-[#2a2b2f] rounded-lg overflow-hidden">
          <div className="p-4 border-b border-[#2a2b2f] bg-[#141517]">
            <h2 className="text-lg font-semibold text-white">Application</h2>
          </div>
          <div className="p-6 space-y-4">
            
            <label className="flex items-center gap-3 cursor-pointer">
              <input 
                type="checkbox" 
                checked={localSettings.confirm_stop}
                onChange={(e) => setLocalSettings({...localSettings, confirm_stop: e.target.checked})}
                className="w-5 h-5 rounded border-[#2a2b2f] bg-[#0f0f11] text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-900"
              />
              <span className="text-gray-300">Confirm before stopping servers</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input 
                type="checkbox" 
                checked={localSettings.confirm_delete}
                onChange={(e) => setLocalSettings({...localSettings, confirm_delete: e.target.checked})}
                className="w-5 h-5 rounded border-[#2a2b2f] bg-[#0f0f11] text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-900"
              />
              <span className="text-gray-300">Confirm before deleting files and backups</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input 
                type="checkbox" 
                checked={localSettings.auto_scroll_console}
                onChange={(e) => setLocalSettings({...localSettings, auto_scroll_console: e.target.checked})}
                className="w-5 h-5 rounded border-[#2a2b2f] bg-[#0f0f11] text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-900"
              />
              <span className="text-gray-300">Auto-scroll console by default</span>
            </label>

          </div>
        </div>
      </div>
      <UnsavedChangesBar
        dirty={dirty}
        saving={saving}
        onSave={handleSave}
        onReset={() => settings && setLocalSettings({...settings})}
        saveDisabled={errors.length > 0}
      />
    </div>
  );
}
