import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AlertCircle, AlertTriangle, ChevronDown, FileText, Info, Loader2, RefreshCw } from 'lucide-react';
import { useStore } from '../store';

type LogSummary = {
  name: string;
  modified: number;
  infos: number;
  warnings: number;
  errors: number;
};

function LogLine({ line }: { line: string }) {
  const upper = line.toUpperCase();
  const color = upper.includes('ERROR') || upper.includes('SEVERE') || upper.includes('FATAL') || upper.includes('EXCEPTION')
    ? 'text-red-400 bg-red-500/5'
    : upper.includes('WARN')
      ? 'text-amber-400 bg-amber-500/5'
      : upper.includes('INFO')
        ? 'text-gray-300'
        : 'text-gray-500';
  return <div className={`px-4 py-0.5 break-words ${color}`}>{line || ' '}</div>;
}

export default function Logs() {
  const { servers, selectedServerId } = useStore();
  const server = servers.find(item => item.id === selectedServerId);
  const [logs, setLogs] = useState<LogSummary[]>([]);
  const [openLog, setOpenLog] = useState<string | null>('latest.log');
  const [contents, setContents] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadLogs = async () => {
    if (!server) return;
    setLoading(true);
    setError('');
    try {
      setLogs(await invoke<LogSummary[]>('get_log_summaries', { baseDir: server.install_path }));
    } catch (cause) {
      setError(`Could not load logs. ${cause}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadLogs(); }, [selectedServerId]);

  useEffect(() => {
    if (!server || !openLog || contents[openLog] !== undefined) return;
    invoke<string>('read_log_content', { baseDir: server.install_path, name: openLog })
      .then(content => setContents(current => ({ ...current, [openLog]: content })))
      .catch(cause => setError(String(cause)));
  }, [openLog, server?.install_path]);

  if (!server) return <div className="p-8 text-center text-gray-500">Select a server from the sidebar.</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Logs</h1>
          <p className="text-gray-400">Latest and archived server logs</p>
        </div>
        <button onClick={() => { setContents({}); loadLogs(); }} disabled={loading} className="flex items-center gap-2 bg-[#2a2b2f] hover:bg-[#3a3b3f] text-white px-4 py-2 rounded-md font-medium transition-colors disabled:opacity-50">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-md text-sm">{error}</div>}

      {loading && !logs.length ? (
        <div className="py-20 flex justify-center text-gray-500"><Loader2 className="animate-spin" /></div>
      ) : logs.length ? (
        <div className="space-y-3">
          {logs.map(log => {
            const open = openLog === log.name;
            const content = contents[log.name];
            return (
              <section key={log.name} className="bg-[#1c1d21] border border-[#2a2b2f] rounded-lg overflow-hidden">
                <button onClick={() => setOpenLog(open ? null : log.name)} className="w-full p-4 flex items-center gap-4 text-left hover:bg-[#202124] transition-colors">
                  <FileText size={18} className="text-gray-500 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-white truncate">{log.name}</span>
                    <span className="block text-xs text-gray-500 mt-0.5">{new Date(log.modified * 1000).toLocaleString()}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className="flex items-center gap-1 rounded bg-blue-500/10 text-blue-400 px-2 py-1"><Info size={12} /> Infos {log.infos}</span>
                    <span className="flex items-center gap-1 rounded bg-amber-500/10 text-amber-400 px-2 py-1"><AlertTriangle size={12} /> Warnings {log.warnings}</span>
                    <span className="flex items-center gap-1 rounded bg-red-500/10 text-red-400 px-2 py-1"><AlertCircle size={12} /> Errors {log.errors}</span>
                  </span>
                  <ChevronDown size={18} className={`text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>

                {open && (
                  <div className="border-t border-[#2a2b2f] bg-[#09090a] max-h-[34rem] overflow-auto py-3 font-mono text-xs leading-relaxed">
                    {content === undefined ? (
                      <div className="py-10 flex justify-center text-gray-600"><Loader2 className="animate-spin" /></div>
                    ) : content ? (
                      content.split(/\r?\n/).map((line, index) => <LogLine key={index} line={line} />)
                    ) : (
                      <div className="py-10 text-center text-gray-600">Log is empty.</div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="border border-dashed border-[#2a2b2f] rounded-lg py-16 text-center text-gray-500">No logs found.</div>
      )}
    </div>
  );
}
