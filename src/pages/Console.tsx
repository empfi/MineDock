import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Play, Square, Terminal as TerminalIcon, Send, RotateCw, Trash2 } from 'lucide-react';

interface LogEntry {
  id: number;
  text: string;
  isError: boolean;
  timestamp: string;
}

export default function Console() {
  const { servers, selectedServerId, settings } = useStore();
  const selectedServer = servers.find(s => s.id === selectedServerId);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [command, setCommand] = useState('');
  const [autoScroll, setAutoScroll] = useState(settings?.auto_scroll_console ?? true);
  
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const logIdCounter = useRef(0);

  useEffect(() => {
    setLogs([]); // Clear logs when switching server
  }, [selectedServerId]);

  useEffect(() => {
    if (!selectedServerId) return;

    const unlisten = listen('console-log', (event: any) => {
      const { server_id, line, is_error } = event.payload;
      
      if (server_id === selectedServerId) {
        setLogs(prev => {
          const newLogs = [...prev, {
            id: logIdCounter.current++,
            text: line,
            isError: is_error,
            timestamp: new Date().toLocaleTimeString()
          }];
          // Keep only last 1000 lines to prevent memory issues
          if (newLogs.length > 1000) {
            return newLogs.slice(newLogs.length - 1000);
          }
          return newLogs;
        });
      }
    });

    return () => {
      unlisten.then(f => f());
    };
  }, [selectedServerId]);

  useEffect(() => {
    if (autoScroll && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView();
    }
  }, [logs, autoScroll]);

  const handleStart = async () => {
    if (!selectedServerId) return;
    try {
      await invoke('start_mc_server', { id: selectedServerId });
    } catch (err) {
      console.error(err);
    }
  };

  const handleStop = async () => {
    if (!selectedServerId) return;
    try {
      await invoke('stop_mc_server', { id: selectedServerId });
    } catch (err) {
      console.error(err);
    }
  };

  const handleRestart = async () => {
    if (!selectedServerId) return;
    try {
      await invoke('stop_mc_server', { id: selectedServerId });
      // wait a bit and restart
      setTimeout(async () => {
        try {
          await invoke('start_mc_server', { id: selectedServerId });
        } catch(err) {
          console.error(err);
        }
      }, 2000);
    } catch (err) {
      console.error(err);
    }
  }

  const handleCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || !selectedServerId) return;

    if (selectedServer?.status !== 'online' && selectedServer?.status !== 'starting') {
      alert("Server is not running.");
      return;
    }

    try {
      await invoke('send_mc_command', { id: selectedServerId, command: command.trim() });
      setLogs(prev => [...prev, {
        id: logIdCounter.current++,
        text: `> ${command.trim()}`,
        isError: false,
        timestamp: new Date().toLocaleTimeString()
      }]);
      setCommand('');
    } catch (err) {
      console.error(err);
      alert('Failed to send command: ' + err);
    }
  };

  if (!selectedServer) {
    return (
      <div className="p-8 max-w-5xl mx-auto flex flex-col h-full items-center justify-center text-gray-500">
        <TerminalIcon size={48} className="mb-4 text-gray-700" />
        <p>No server selected. Select a server from the sidebar.</p>
      </div>
    );
  }

  const isRunning = selectedServer.status === 'online' || selectedServer.status === 'starting';

  return (
    <div className="flex flex-col h-full bg-[#0f0f11] p-4">
      {/* Console Header / Toolbar */}
      <div className="flex justify-between items-center bg-[#1c1d21] p-4 rounded-t-lg border border-[#2a2b2f] border-b-0">
        <div className="flex items-center gap-3">
          <TerminalIcon size={20} className="text-gray-400" />
          <h2 className="font-semibold text-white">{selectedServer.name} - Console</h2>
          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
            selectedServer.status === 'online' ? 'bg-emerald-500/10 text-emerald-400' :
            selectedServer.status === 'starting' ? 'bg-amber-500/10 text-amber-400' :
            selectedServer.status === 'stopping' ? 'bg-red-500/10 text-red-400' :
            'bg-gray-500/10 text-gray-400'
          }`}>
            {selectedServer.status.toUpperCase()}
          </span>
        </div>
        
        <div className="flex gap-2">
          {!isRunning ? (
            <button onClick={handleStart} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded text-sm transition-colors">
              <Play size={14} /> Start
            </button>
          ) : (
            <>
              <button onClick={handleRestart} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-sm transition-colors">
                <RotateCw size={14} /> Restart
              </button>
              <button onClick={handleStop} className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded text-sm transition-colors">
                <Square size={14} /> Stop
              </button>
            </>
          )}
          
          <div className="w-px h-6 bg-[#2a2b2f] mx-2 self-center"></div>
          
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} className="rounded border-gray-600 bg-transparent text-blue-500 focus:ring-0" />
            Auto-scroll
          </label>
          <button onClick={() => setLogs([])} className="p-1.5 text-gray-400 hover:text-white rounded ml-2" title="Clear Console">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Terminal View */}
      <div className="flex-1 bg-[#09090a] border border-[#2a2b2f] overflow-y-auto p-4 font-mono text-sm leading-relaxed">
        {logs.length === 0 && (
          <div className="text-gray-600 text-center mt-10">Server output will appear here.</div>
        )}
        {logs.map(log => (
          <div key={log.id} className={`break-words ${log.text.startsWith('>') ? 'text-blue-400' : log.isError ? 'text-red-400' : 'text-gray-300'}`}>
            <span className="text-gray-600 mr-2 select-none">[{log.timestamp}]</span>
            {/* Simple highlight for common MC severities */}
            {log.text.includes('WARN') && !log.isError ? (
               <span className="text-amber-400">{log.text}</span>
            ) : log.text.includes('INFO') && !log.isError ? (
               <span><span className="text-cyan-400">{log.text.substring(0, 31)}</span><span className="text-gray-300">{log.text.substring(31)}</span></span>
            ) : (
               log.text
            )}
          </div>
        ))}
        <div ref={consoleEndRef} />
      </div>

      {/* Input Field */}
      <div className="bg-[#1c1d21] border border-[#2a2b2f] border-t-0 rounded-b-lg p-2">
        <form onSubmit={handleCommand} className="flex gap-2">
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={!isRunning}
            placeholder={isRunning ? "Type a command... (e.g. say Hello)" : "Server is offline"}
            className="flex-1 bg-[#09090a] border border-[#2a2b2f] rounded px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
          <button type="submit" disabled={!isRunning || !command.trim()} className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white px-4 py-2 rounded flex items-center justify-center transition-colors">
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
