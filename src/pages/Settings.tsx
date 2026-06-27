import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { Save, Folder } from 'lucide-react';
import { AppSettings } from '../types';

export default function SettingsPage() {
  const { settings, fetchSettings } = useStore();
  const [localSettings, setLocalSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setLocalSettings(settings);
    }
  }, [settings]);

  const handleSave = async () => {
    if (!localSettings) return;
    setSaving(true);
    try {
      await invoke('save_settings', { settings: localSettings });
      await fetchSettings();
    } catch (e) {
      console.error(e);
      alert('Failed to save settings');
    } finally {
      setSaving(false);
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
    }
  };

  if (!localSettings) return <div className="p-8 text-gray-400">Loading...</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Settings</h1>
          <p className="text-gray-400">Configure global MineDock application settings.</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors disabled:opacity-50"
        >
          <Save size={18} />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <div className="space-y-6">
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
    </div>
  );
}
