import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { Terminal as TerminalIcon, Send, Trash2, Search, ChevronUp, ChevronDown, X, ArrowDown } from 'lucide-react';
import { notify } from '../components/Notifications';

function parseLogLine(text: string, isError: boolean) {
  const lower = text.toLowerCase();
  
  let colorClass = 'text-gray-300';
  if (text.startsWith('>')) {
    colorClass = 'text-blue-400';
  } else if (lower.includes('error') || lower.includes('fatal') || lower.includes('severe') || lower.includes('exception')) {
    colorClass = 'text-red-400';
  } else if (lower.includes('warn') || lower.includes('warning')) {
    colorClass = 'text-amber-400';
  } else if (lower.includes('info')) {
    colorClass = 'text-gray-300';
  } else if (isError) {
    colorClass = 'text-gray-400';
  }

  const errMatch = text.match(/^(\[\d{2}:\d{2}:\d{2}\]\s*\[[^\]]+ERR(?:OR)?\]:?|\[\d{2}:\d{2}:\d{2}\s+ERR(?:OR)?\]:?)/i);
  const warnMatch = text.match(/^(\[\d{2}:\d{2}:\d{2}\]\s*\[[^\]]+WARN(?:ING)?\]:?|\[\d{2}:\d{2}:\d{2}\s+WARN(?:ING)?\]:?)/i);
  const infoMatch = text.match(/^(\[\d{2}:\d{2}:\d{2}\]\s*\[[^\]]+INFO\]:?|\[\d{2}:\d{2}:\d{2}\s+INFO\]:?)/i);

  if (errMatch) {
    const len = errMatch[0].length;
    return (
      <span className="text-red-400">
        <span className="text-red-500 font-semibold">{text.substring(0, len)}</span>
        {text.substring(len)}
      </span>
    );
  }

  if (warnMatch) {
    const len = warnMatch[0].length;
    return (
      <span className="text-amber-400">
        <span className="text-amber-500 font-semibold">{text.substring(0, len)}</span>
        {text.substring(len)}
      </span>
    );
  }

  if (infoMatch) {
    const len = infoMatch[0].length;
    return (
      <span>
        <span className="text-cyan-400">{text.substring(0, len)}</span>
        <span className="text-gray-300">{text.substring(len)}</span>
      </span>
    );
  }

  if (lower.includes('warn') || lower.includes('warning')) {
    return <span className="text-amber-400">{text}</span>;
  }
  if (lower.includes('error') || lower.includes('fatal') || lower.includes('severe') || lower.includes('exception')) {
    return <span className="text-red-400">{text}</span>;
  }

  return <span className={colorClass}>{text}</span>;
}

export default function Console() {
  const { servers, selectedServerId, settings, consoleLogs, appendConsoleLog, clearConsoleLogs } = useStore();
  const selectedServer = servers.find(s => s.id === selectedServerId);

  const logs = selectedServerId ? consoleLogs[selectedServerId] || [] : [];
  const [command, setCommand] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const commandDraft = useRef('');
  const [autoScroll, setAutoScroll] = useState(settings?.auto_scroll_console ?? true);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const logRefs = useRef(new Map<number, HTMLDivElement>());
  
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);



  useEffect(() => {
    if (autoScroll && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView();
    }
  }, [logs, autoScroll]);

  useEffect(() => {
    const openSearch = () => {
      setSearchOpen(true);
    };
    window.addEventListener('minedock-find', openSearch);
    return () => window.removeEventListener('minedock-find', openSearch);
  }, []);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const matches = search
    ? logs.filter(log => log.text.toLowerCase().includes(search.toLowerCase()))
    : [];

  useEffect(() => {
    setMatchIndex(0);
  }, [search]);

  useEffect(() => {
    const match = matches[matchIndex];
    if (match) {
      setAutoScroll(false);
      logRefs.current.get(match.id)?.scrollIntoView({ block: 'center' });
    }
  }, [matchIndex, search]);

  const moveMatch = (direction: number) => {
    if (!matches.length) return;
    setMatchIndex(index => (index + direction + matches.length) % matches.length);
  };

  const handleHistoryKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const history = logs.filter(log => log.text.startsWith('> ')).map(log => log.text.slice(2));
    if (history.length === 0) return;
    e.preventDefault();
    if (e.key === 'ArrowUp') {
      if (historyIndex === -1) commandDraft.current = command;
      const next = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(next);
      setCommand(history[history.length - 1 - next]);
    } else if (historyIndex > 0) {
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setCommand(history[history.length - 1 - next]);
    } else if (historyIndex === 0) {
      setHistoryIndex(-1);
      setCommand(commandDraft.current);
    }
  };
  const handleCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || !selectedServerId) return;

    if (selectedServer?.status !== 'online' && selectedServer?.status !== 'starting') {
      notify('Server is not running.', 'warning');
      return;
    }

    try {
      await invoke('send_mc_command', { id: selectedServerId, command: command.trim() });
      appendConsoleLog(selectedServerId, `> ${command.trim()}`, false);
      setCommand('');
      setHistoryIndex(-1);
      commandDraft.current = '';
    } catch (err) {
      console.error(err);
      notify('Failed to send command: ' + err, 'error');
    }
  };

  if (!selectedServer) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 w-full flex flex-col h-full items-center justify-center text-gray-500">
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
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} className="rounded border-gray-600 bg-transparent text-blue-500 focus:ring-0" />
            Auto-scroll
          </label>
          <button onClick={() => selectedServerId && clearConsoleLogs(selectedServerId)} className="p-1.5 text-gray-400 hover:text-white rounded ml-2" title="Clear Console">
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="relative flex flex-1 min-h-0">
        {/* Terminal View */}
        <div
          ref={consoleRef}
          onScroll={event => {
            const element = event.currentTarget;
            setShowScrollDown(element.scrollHeight - element.scrollTop - element.clientHeight > 48);
          }}
          className="flex-1 bg-[#09090a] border border-[#2a2b2f] overflow-y-auto p-4 font-mono text-sm leading-relaxed"
        >
          {searchOpen && (
            <div className="sticky top-0 z-10 ml-auto mb-3 flex w-fit items-center gap-1 rounded-md border border-[#3a3b3f] bg-[#1c1d21] p-1 shadow-lg">
              <Search size={15} className="ml-2 text-gray-500" />
              <input
                ref={searchInputRef}
                autoFocus
                value={search}
                onChange={event => setSearch(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    setSearchOpen(false);
                    setSearch('');
                  } else if (event.key === 'Enter') {
                    moveMatch(event.shiftKey ? -1 : 1);
                  }
                }}
                placeholder="Find in console"
                className="w-52 bg-transparent px-2 py-1 text-sm text-white outline-none"
              />
              <span className="min-w-14 text-center text-xs text-gray-500">
                {search ? `${matches.length ? matchIndex + 1 : 0}/${matches.length}` : '0/0'}
              </span>
              <button onClick={() => moveMatch(-1)} disabled={!matches.length} className="p-1 text-gray-400 hover:text-white disabled:opacity-30" title="Previous match"><ChevronUp size={16} /></button>
              <button onClick={() => moveMatch(1)} disabled={!matches.length} className="p-1 text-gray-400 hover:text-white disabled:opacity-30" title="Next match"><ChevronDown size={16} /></button>
              <button onClick={() => { setSearchOpen(false); setSearch(''); }} className="p-1 text-gray-400 hover:text-white" title="Close search"><X size={16} /></button>
            </div>
          )}
          {logs.length === 0 && (
            <div className="text-gray-600 text-center mt-10">Server output will appear here.</div>
          )}
          {logs.map(log => {
            const hasTimestamp = /^\[\d{2}:\d{2}:\d{2}/.test(log.text);
            return (
              <div
                key={log.id}
                ref={element => {
                  if (element) logRefs.current.set(log.id, element);
                  else logRefs.current.delete(log.id);
                }}
                className={`break-words rounded-sm px-1 -mx-1 ${matches[matchIndex]?.id === log.id ? 'bg-amber-400/15 ring-1 ring-amber-400/40' : ''}`}
              >
                {!hasTimestamp && (
                  <span className="text-gray-600 mr-2 select-none">[{log.timestamp}]</span>
                )}
                {parseLogLine(log.text, log.isError)}
              </div>
            );
          })}
          <div ref={consoleEndRef} />
        </div>
        {showScrollDown && (
          <button
            onClick={() => {
              consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
              setAutoScroll(true);
            }}
            title="Jump to latest output"
            aria-label="Jump to latest output"
            className="absolute bottom-3 right-4 rounded-full border border-[#34353a] bg-[#1c1d21]/90 p-2 text-gray-500 shadow-sm backdrop-blur-sm transition-colors hover:text-gray-200"
          >
            <ArrowDown size={15} />
          </button>
        )}

      </div>

      {/* Input Field */}
      <div className="bg-[#1c1d21] border border-[#2a2b2f] border-t-0 rounded-b-lg p-2">
        <form onSubmit={handleCommand} className="flex gap-2">
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleHistoryKeyDown}
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
