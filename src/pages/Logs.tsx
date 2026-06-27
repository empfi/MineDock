import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { FileText, Loader2, RefreshCw } from 'lucide-react';

export default function Logs() {
  const { servers, selectedServerId } = useStore();
  const selectedServer = servers.find(s => s.id === selectedServerId);

  const [logContent, setLogContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedServer) {
      loadLatestLog();
    }
  }, [selectedServerId]);

  const loadLatestLog = async () => {
    if (!selectedServer) return;
    setLoading(true);
    setError(null);
    try {
      const content = await invoke<string>('read_file_content', {
        baseDir: selectedServer.install_path,
        subPath: 'logs/latest.log'
      });
      setLogContent(content);
    } catch (err: any) {
      setError("Could not load latest.log. Ensure the server has been run at least once. " + err.toString());
    } finally {
      setLoading(false);
    }
  };

  if (!selectedServer) {
    return <div className="p-8 text-center text-gray-500">Select a server from the sidebar.</div>;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto flex flex-col h-full">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Logs</h1>
          <p className="text-gray-400">View latest.log</p>
        </div>
        <button
          onClick={loadLatestLog}
          disabled={loading}
          className="flex items-center gap-2 bg-[#2a2b2f] hover:bg-[#3a3b3f] text-white px-4 py-2 rounded-md font-medium transition-colors disabled:opacity-50"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error ? (
        <div className="flex-1 border border-red-500/20 bg-red-500/5 rounded-lg flex items-center justify-center p-8 text-red-400 text-center">
          {error}
        </div>
      ) : (
        <div className="flex-1 bg-[#09090a] border border-[#2a2b2f] rounded-lg overflow-hidden flex flex-col relative">
           <div className="bg-[#141517] border-b border-[#2a2b2f] p-3 flex items-center gap-3">
             <FileText size={16} className="text-gray-400" />
             <span className="text-sm font-medium text-gray-300">logs/latest.log</span>
           </div>
           
           <div className="flex-1 overflow-y-auto p-4 font-mono text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
             {loading && !logContent ? (
               <div className="flex flex-col items-center justify-center h-full text-gray-500">
                 <Loader2 size={32} className="animate-spin mb-4" />
               </div>
             ) : logContent ? (
               logContent
             ) : (
               <div className="text-gray-500 text-center mt-10">Log is empty.</div>
             )}
           </div>
        </div>
      )}
    </div>
  );
}
