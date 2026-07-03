import { FormEvent, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ArrowUp, Check, Download, ExternalLink, KeyRound, Loader2, Plus, Search } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import ErrorState from '../components/ErrorState';
import { notify } from '../components/Notifications';
import { reportInstall } from '../components/ProgressHub';
import { safeApply } from '../lib/safeApply';

type Message = { role: 'user' | 'assistant'; content: string; hidden?: boolean; widgets?: Widget[]; sources?: Source[]; activities?: string[]; createdServerId?: number };
type Widget = { kind: string; title: string; fields: WidgetField[] | ServerOption[] };
type WidgetField = { name: string; label: string; type: string; options?: string[]; value?: string | number | boolean };
type ServerOption = { id: number; name: string; type: string; version: string };
type Source = { source: string; id: string; name: string; description: string; icon_url?: string; downloads: number };
type Reply = { message: string; widgets: Widget[]; sources: Source[]; activities: string[]; created_server_id?: number };

type ParsedAssistantContent = {
  body: string;
  reasoning: string[];
};

function extractLeadingJsonObject(text: string): { json: string; rest: string } | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{')) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < trimmed.length; index++) {
    const character = trimmed[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === '{') depth++;
    if (character === '}') {
      depth--;
      if (depth === 0) {
        return {
          json: trimmed.slice(0, index + 1),
          rest: trimmed.slice(index + 1),
        };
      }
    }
  }
  return null;
}

function parseAssistantContent(content: string): ParsedAssistantContent {
  const reasoning: string[] = [];
  const bodyWithoutReasoning = content.replace(/<reasoning>([\s\S]*?)<\/reasoning>/gi, (_, value: string) => {
    const trimmed = value.trim();
    if (trimmed) reasoning.push(trimmed);
    return '';
  });
  let body = bodyWithoutReasoning.trim();
  const leadingJson = extractLeadingJsonObject(body);
  if (leadingJson) {
    try {
      const parsed = JSON.parse(leadingJson.json) as Record<string, unknown>;
      const internalKeys = ['query', 'top_n', 'recency_days', 'source', 'project_type', 'name', 'arguments'];
      if (Object.keys(parsed).some(key => internalKeys.includes(key))) {
        body = leadingJson.rest.trim();
      }
    } catch {
      // Keep the original body when the prefix is not valid JSON.
    }
  }
  return { body, reasoning };
}

function cleanAsciiLogo(logo: string): string {
  const lines = logo.split('\n');
  let start = 0;
  while (start < lines.length && lines[start].trim() === '') {
    start++;
  }
  let end = lines.length - 1;
  while (end >= start && lines[end].trim() === '') {
    end--;
  }
  if (start > end) return '';
  const contentLines = lines.slice(start, end + 1);
  let minPadding = Infinity;
  for (const line of contentLines) {
    if (line.trim() === '') continue;
    const match = line.match(/^( *)/);
    if (match) {
      minPadding = Math.min(minPadding, match[1].length);
    }
  }
  return contentLines.map(line => {
    if (line.length <= minPadding) return '';
    return line.substring(minPadding).trimEnd();
  }).join('\n');
}

const MineDockMark = ({ className = 'h-8 w-8', logoText }: { className?: string; logoText?: string }) => {
  if (logoText) {
    const cleaned = cleanAsciiLogo(logoText);
    return (
      <div className={`${className} shrink-0 flex items-center justify-center overflow-hidden select-none relative`}>
        <pre 
          className="font-mono text-[4px] leading-[3px] text-gray-200 absolute left-1/2 top-1/2 origin-center whitespace-pre"
          style={{ transform: 'translate(-50%, -50%) scale(0.14)' }}
        >
          {cleaned}
        </pre>
      </div>
    );
  }
  return <img src="/logo.png" alt="" className={`${className} shrink-0 rounded-md`} />;
};

const starters = ['Set up a new survival server', 'Find performance plugins', 'Recommend mods for this server', 'Check what this server needs'];
const modelsByProvider = {
  openrouter: [
    { id: 'openrouter/free', label: 'Free · Best', detail: 'Highest rate limit' },
    { id: 'meta-llama/llama-3-8b-instruct', label: 'Cheapest', detail: 'Best value' },
  ],
  aws: [
    { id: 'openai.gpt-oss-120b-1:0', label: 'GPT OSS 120B', detail: 'Primary Bedrock model' },
    { id: 'anthropic.claude-haiku-4-5-20251001-v1:0', label: 'Claude Haiku 4.5', detail: 'Fastest fallback' },
    { id: 'anthropic.claude-sonnet-4-5-20250929-v1:0', label: 'Claude Sonnet 4.5', detail: 'Best reasoning' },
  ],
};
const initialMessage: Message = { role: 'assistant', content: 'Tell me what you want to build. I can ask for missing details, search compatible marketplace projects, and install approved additions into the selected server.' };

function savedMessages(): Message[] {
  try {
    const value = JSON.parse(localStorage.getItem('minedock:assistant_messages') || '[]');
    if (!Array.isArray(value) || !value.length) return [initialMessage];
    return value.map(message => ({
      ...message,
      widgets: Array.isArray(message.widgets)
        ? message.widgets.filter((widget: Widget) => Array.isArray(widget.fields) && widget.fields.length > 0)
        : [],
      sources: Array.isArray(message.sources) ? message.sources : [],
    }));
  } catch {
    return [initialMessage];
  }
}

export default function Assistant() {
  const navigate = useNavigate();
  const { servers, selectedServerId, fetchServers, setSelectedServer } = useStore();
  const server = servers.find(item => item.id === selectedServerId);
  const [connected, setConnected] = useState(false);
  const [connectionChecked, setConnectionChecked] = useState(false);
  const [key, setKey] = useState('');
  const [validatingKey, setValidatingKey] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [activity, setActivity] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [installing, setInstalling] = useState<string[]>([]);
  const [model, setModel] = useState(() => localStorage.getItem('minedock:ai_model') || 'openrouter/free');
  const [messages, setMessages] = useState<Message[]>(savedMessages);
  const [aiLogo, setAiLogo] = useState<string>('');
  const [provider, setProvider] = useState<'openrouter' | 'aws'>('openrouter');
  const endRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const initialScroll = useRef(true);

  useEffect(() => { invoke<boolean>('has_ai_key').then(setConnected).catch(() => {}).finally(() => setConnectionChecked(true)); }, []);
  useEffect(() => { invoke<string>('get_ai_logo').then(setAiLogo).catch(() => {}); }, []);
  useEffect(() => { localStorage.setItem('minedock:assistant_messages', JSON.stringify(messages.slice(-100))); }, [messages]);
  useEffect(() => {
    const availableModels = modelsByProvider[provider];
    if (!availableModels.some(option => option.id === model)) {
      const nextModel = availableModels[0].id;
      setModel(nextModel);
      localStorage.setItem('minedock:ai_model', nextModel);
    }
  }, [provider, model]);
  useEffect(() => {
    const unlisten = listen<string>('ai-activity', event => setActivity(event.payload));
    return () => { unlisten.then(remove => remove()); };
  }, []);
  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    const timer = window.setInterval(() => setElapsed(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: initialScroll.current ? 'auto' : 'smooth' });
    initialScroll.current = false;
  }, [messages, busy]);

  const connect = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    setValidatingKey(true);
    try { await invoke('set_ai_key', { provider, key }); setConnected(true); setKey(''); }
    catch (cause) { setError(String(cause)); }
    finally { setValidatingKey(false); }
  };
  const keyFormatValid = provider === 'aws'
    ? key.trim().length > 0
    : /^sk-or-v1-[a-fA-F0-9]{64}$/.test(key.trim());
  const keyFormatError = key.length > 0 && !keyFormatValid
    ? (provider === 'aws'
        ? 'Paste a Bedrock API key, or an access_key_id:secret_access_key pair.'
        : 'Expected sk-or-v1- followed by 64 hexadecimal characters.')
    : '';
  const send = async (text = input, hidden = false) => {
    const prompt = text.trim();
    if (!prompt || busyRef.current) return;
    busyRef.current = true;
    const next = [...messages, { role: 'user' as const, content: prompt, hidden }];
    setMessages(next); setInput(''); setBusy(true); setError('');
    setActivity('');
    try {
      const conversationServerId = [...next].reverse().find(message => message.createdServerId)?.createdServerId
        ?? selectedServerId
        ?? null;
      const reply = await invoke<Reply>('ai_chat', { messages: next.map(({ role, content }) => ({ role, content })), serverId: conversationServerId, model });
      await fetchServers();
      if (reply.created_server_id) setSelectedServer(reply.created_server_id);
      setMessages(items => [...items, { role: 'assistant', content: reply.message, widgets: reply.widgets, sources: reply.sources, activities: reply.activities, createdServerId: reply.created_server_id }]);
    } catch (cause) { setError(String(cause)); }
    finally { busyRef.current = false; setBusy(false); setActivity(''); }
  };
  const submitWidget = (widget: Widget, data: Record<string, string>) => send(`${widget.title}:\n${Object.entries(data).map(([name, value]) => `${name}: ${value}`).join('\n')}`, true);
  const submitServerSelect = async (serverId: number, serverName: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    // Find the last user message to re-send with the now-selected server
    const lastUserMsg = messages.filter(m => m.role === 'user').at(-1);
    if (!lastUserMsg) { busyRef.current = false; return; }
    // Append a hidden anchor message so conversationServerId is set for all future sends
    const anchor = { role: 'user' as const, content: `Working in: ${serverName}`, hidden: true, createdServerId: serverId };
    const next = [...messages, anchor];
    setMessages(next);
    setBusy(true); setError(''); setActivity('');
    try {
      const reply = await invoke<Reply>('ai_chat', {
        messages: [...next.map(({ role, content }) => ({ role, content })), { role: 'user', content: lastUserMsg.content }],
        serverId,
        model,
      });
      await fetchServers();
      if (reply.created_server_id) setSelectedServer(reply.created_server_id);
      setMessages(items => [...items, { role: 'assistant', content: reply.message, widgets: reply.widgets, sources: reply.sources, activities: reply.activities, createdServerId: reply.created_server_id }]);
    } catch (cause) { setError(String(cause)); }
    finally { busyRef.current = false; setBusy(false); setActivity(''); }
  };
  const latestMessage = messages[messages.length - 1];
  const pendingForm = !busy && latestMessage?.role === 'assistant' && !!latestMessage.widgets?.length;
  const installSource = async (source: Source) => {
    if (!server) return notify('Select a server before installing.', 'error');
    const projectType = ['fabric', 'forge', 'neoforge'].includes(server.server_type) ? 'mod' : 'plugin';
    if (server.server_type === 'vanilla') return notify('Vanilla servers cannot load marketplace additions.', 'error');
    const id = `${source.source}:${source.id}`;
    setInstalling(items => [...items, id]);
    reportInstall({ id, name: source.name, state: 'downloading' });
    try {
      await safeApply({
        server,
        label: `Install ${source.name}`,
        operation: () => invoke('install_marketplace_plugin', {
          serverPath: server.install_path, source: source.source, projectId: source.id,
          pluginName: source.name, minecraftVersion: server.minecraft_version,
          projectType, serverType: server.server_type,
        }),
      });
      reportInstall({ id, name: source.name, state: 'done' });
      notify(`${source.name} installed. Restart the server to load it.`, 'success');
    } catch (cause) {
      reportInstall({ id, name: source.name, state: 'failed' });
      notify(`Install failed: ${cause}`, 'error');
    } finally {
      setInstalling(items => items.filter(item => item !== id));
    }
  };
  const usedPorts = new Set(servers.map(item => item.port));
  let nextPort = 25565;
  while (usedPorts.has(nextPort)) nextPort++;
  const formDefaults: Record<string, string> = {
    minecraft_version: server?.minecraft_version || '',
    server_type: server && ['vanilla', 'paper', 'purpur', 'velocity', 'fabric', 'forge', 'neoforge'].includes(server.server_type) ? server.server_type : 'paper',
    ram_min_mb: String(server?.ram_min || 1024),
    ram_max_mb: String(server?.ram_max || 4096),
    port: String(nextPort),
  };
  const newChat = () => {
    setMessages([initialMessage]);
    setInput('');
    setError('');
    setActivity('');
    localStorage.removeItem('minedock:assistant_messages');
  };
  const busyLabel = activity || (elapsed < 2 ? 'Reading your request' : elapsed < 6 ? 'Planning the next steps' : elapsed < 12 ? 'Working through the details' : 'Still working');

  if (!connectionChecked) return <div className="h-full bg-[#0f0f11]" />;
  if (!connected) return <div className="flex h-full items-center justify-center p-8"><form onSubmit={connect} className="w-full max-w-md rounded-xl border border-[#2a2b2f] bg-[#1c1d21] p-6 shadow-2xl">
    <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400"><KeyRound size={21} /></div>
    <h1 className="text-xl font-semibold text-white">Connect Assistant</h1>
    <p className="mt-2 text-sm leading-relaxed text-gray-400">Key stays only in MineDock’s Rust process for this session. It is never stored in browser storage or SQLite.</p>
    
    <div className="mt-5 mb-4 flex rounded-md bg-[#0f0f11] p-0.5 border border-[#2a2b2f]">
      <button type="button" onClick={() => { setProvider('openrouter'); setError(''); }} className={`flex-1 rounded py-1.5 text-xs font-medium transition-colors ${provider === 'openrouter' ? 'bg-[#2a2b2f] text-white' : 'text-gray-400 hover:text-gray-200'}`}>OpenRouter</button>
      <button type="button" onClick={() => { setProvider('aws'); setError(''); }} className={`flex-1 rounded py-1.5 text-xs font-medium transition-colors ${provider === 'aws' ? 'bg-[#2a2b2f] text-white' : 'text-gray-400 hover:text-gray-200'}`}>AWS</button>
    </div>

    <label className="block"><span className="mb-1.5 block text-xs text-gray-500">Model</span><select value={model} onChange={event => { setModel(event.target.value); localStorage.setItem('minedock:ai_model', event.target.value); }} className="w-full rounded-md border border-[#2a2b2f] bg-[#0f0f11] px-3 py-2.5 text-sm text-white">{modelsByProvider[provider].map(option => <option key={option.id} value={option.id}>{option.label} — {option.detail}</option>)}</select></label>

    <p className="mb-4 mt-4 text-xs text-gray-500">
      Get a key from <a href={provider === 'aws' ? 'https://console.aws.amazon.com/bedrock/home#/api-keys/short-term/create' : 'https://openrouter.ai/'} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{provider === 'aws' ? 'Amazon Bedrock API keys' : 'OpenRouter'}</a>.
    </p>

    <input autoFocus type="password" value={key} onChange={event => { setKey(event.target.value.trim()); setError(''); }} placeholder={provider === 'aws' ? 'Bedrock API key or access_key:secret_key' : 'sk-or-v1-…'} aria-invalid={!!keyFormatError || !!error} aria-describedby="ai-key-status" className={`w-full rounded-md border bg-[#0f0f11] px-3 py-2.5 text-white outline-none ${keyFormatError || error ? 'border-red-500/60' : keyFormatValid ? 'border-emerald-500/60' : 'border-[#2a2b2f] focus:border-blue-500'}`} />
    <p id="ai-key-status" className={`mt-2 min-h-4 text-xs ${keyFormatError || error ? 'text-red-400' : keyFormatValid ? 'text-emerald-400' : 'text-gray-600'}`}>{error || keyFormatError || (keyFormatValid ? (provider === 'aws' ? 'Looks valid. Bedrock API keys and access_key:secret_key pairs are both supported.' : 'Format valid. Key will be verified when connecting.') : 'Keys are validated without being stored.')}</p>
    <button disabled={!keyFormatValid || validatingKey} className="action-button mt-4 w-full bg-blue-600 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">{validatingKey ? <><Loader2 size={15} className="animate-spin" /> Verifying connection…</> : 'Connect securely'}</button>
  </form></div>;

  return <div className="flex h-full flex-col bg-[#0f0f11]">
    <header className="flex h-16 flex-shrink-0 items-center justify-between border-b border-[#2a2b2f] px-4">
      <div className="flex items-center gap-3"><MineDockMark className="h-8 w-8" logoText={aiLogo} /><div><h1 className="font-semibold text-white">DockAI</h1><p className="text-xs text-gray-500">{server ? `Working with ${server.name} · ${server.minecraft_version}` : 'Server setup workspace'}</p></div></div>
      <div className="flex items-center gap-2"><button onClick={newChat} disabled={busy} className="flex h-8 items-center gap-1.5 rounded-md border border-[#303238] bg-[#18191c] px-3 text-xs font-medium text-gray-300 hover:border-[#454850] hover:bg-[#202124] hover:text-white disabled:opacity-40"><Plus size={14} /> New chat</button><select value={model} onChange={event => { setModel(event.target.value); localStorage.setItem('minedock:ai_model', event.target.value); }} className="rounded-md border border-[#2a2b2f] bg-[#141517] px-2.5 py-1.5 text-xs text-gray-300">{modelsByProvider[provider].map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div>
    </header>
    <main className="select-text flex-1 overflow-y-auto px-4 py-7 sm:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        {messages.map((message, index) => (message.hidden || (message.role === 'user' && message.content.includes('\nserver_name:') && message.content.includes('\neula_accepted:'))) ? null : <div key={index} className={`ai-message flex gap-3 ${message.role === 'user' ? 'justify-end' : ''}`}>
          {message.role === 'assistant' && <MineDockMark className="mt-0.5 h-8 w-8" logoText={aiLogo} />}
          <div className={`relative max-w-[88%] ${message.role === 'user' ? 'rounded-xl bg-blue-600 px-4 py-3 text-white' : 'min-w-0 flex-1 text-gray-200'}`}>
            {message.role === 'assistant' ? <AssistantMarkdown content={message.content} /> : <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>}
            {message.sources && message.sources.length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2">{message.sources.map(source => {
              const sourceId = `${source.source}:${source.id}`;
              const isInstalling = installing.includes(sourceId);
              return <div key={sourceId} className="flex items-center gap-3 rounded-lg border border-[#2a2b2f] bg-[#18191c] p-3 hover:border-[#414247]">{source.icon_url ? <img src={source.icon_url} className="h-9 w-9 rounded-md" /> : <Search className="m-2 text-gray-600" size={18} />}<span className="min-w-0 flex-1"><b className="block truncate text-sm text-white">{source.name}</b><span className="text-[11px] text-gray-500">{source.source} · {source.downloads.toLocaleString()} downloads</span></span><button title="Open project page" onClick={async () => { const { openUrl } = await import('@tauri-apps/plugin-opener'); openUrl(source.source === 'Modrinth' ? `https://modrinth.com/project/${source.id}` : `https://hangar.papermc.io/${source.id}`); }} className="rounded p-2 text-gray-600 hover:bg-[#25262a] hover:text-gray-300"><ExternalLink size={13} /></button><button title={`Install ${source.name}`} onClick={() => installSource(source)} disabled={isInstalling} className="flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-2.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">{isInstalling ? <Loader2 className="animate-spin" size={13} /> : <Download size={13} />}{isInstalling ? 'Installing' : 'Install'}</button></div>;
            })}</div>}
            {message.createdServerId && <button onClick={() => { setSelectedServer(message.createdServerId!); navigate('/console'); }} className="action-button mt-4 bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500">Open server</button>}
            {message.widgets?.map((widget, widgetIndex) => widget.kind === 'server_select'
              ? <ServerSelectWidget key={widgetIndex} widget={widget} completed={index < messages.length - 1 && !busy && !error} onSelect={submitServerSelect} />
              : <InlineForm key={widgetIndex} widget={widget as Widget & { fields: WidgetField[] }} defaults={formDefaults} onSubmit={values => submitWidget(widget, values)} completed={index < messages.length - 1 && !busy && !error} />)}
          </div>
        </div>)}
        {busy && <div className="ai-message flex items-center gap-3" role="status"><MineDockMark className="assistant-working-mark h-8 w-8" logoText={aiLogo} /><div className="flex items-baseline gap-2"><span key={busyLabel} className="assistant-status-enter assistant-thinking text-sm">{busyLabel}</span>{elapsed >= 3 && <span className="text-[11px] tabular-nums text-gray-600">{elapsed}s</span>}</div></div>}
        {error && <ErrorState compact title="Assistant stopped" description="No further changes were made after the failure." details={error} primaryAction={{ label: 'Retry', onClick: () => { const userMessages = messages.filter(item => item.role === 'user'); send(userMessages[userMessages.length - 1]?.content || ''); } }} />}
        <div ref={endRef} />
      </div>
    </main>
    <footer className="bg-[#0f0f11] px-4 pb-5 pt-3">
      <div className="mx-auto max-w-3xl">{messages.length === 1 && <div className="mb-3 flex flex-wrap gap-2">{starters.map(starter => <button key={starter} onClick={() => send(starter)} className="rounded-full border border-[#2a2b2f] px-3 py-1.5 text-xs text-gray-400 hover:bg-[#202124] hover:text-white">{starter}</button>)}</div>}
        <form onSubmit={event => { event.preventDefault(); send(); }} className={`assistant-composer flex items-end gap-2 rounded-2xl border border-[#34353a] bg-[#1c1d21] p-2.5 ${busy || pendingForm ? 'opacity-60' : ''}`}><textarea disabled={busy || pendingForm} rows={1} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder={pendingForm ? 'Complete the form above to continue' : busy ? 'MineDock is working…' : 'Describe the server or addition you want…'} className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-gray-600 disabled:cursor-not-allowed" /><button aria-label="Send message" disabled={!input.trim() || busy || pendingForm} className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-500 disabled:bg-[#292a2e] disabled:text-gray-600"><ArrowUp size={17} strokeWidth={2.25} /></button></form>
      </div>
    </footer>
  </div>;
}

function AssistantMarkdown({ content }: { content: string }) {
  const { body, reasoning } = parseAssistantContent(content);
  return <div className="assistant-markdown text-sm leading-6">
    {reasoning.map((entry, index) => <details key={index} className="mb-3 overflow-hidden rounded-lg border border-[#2a2b2f] bg-[#151619]">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-gray-400 marker:hidden hover:text-gray-200">
        Reasoning
      </summary>
      <div className="border-t border-[#24262b] px-3 py-2 text-xs leading-6 text-gray-400 whitespace-pre-wrap">
        {entry}
      </div>
    </details>)}
    {body && <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      a: ({ href, children }) => <a href={href} onClick={event => { event.preventDefault(); if (href) import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(href)); }}>{children}</a>,
    }}>{body}</ReactMarkdown>}
  </div>;
}

function InlineForm({ widget, defaults, onSubmit, completed }: { widget: Widget & { fields: WidgetField[] }; defaults: Record<string, string>; onSubmit: (values: Record<string, string>) => void; completed: boolean }) {
  const [customize, setCustomize] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(widget.fields.map(field => [
    field.name,
    field.value !== undefined ? String(field.value) : (defaults[field.name] || (field.type === 'checkbox' ? 'false' : ''))
  ])));
  const setupForm = widget.fields.some(field => field.name === 'server_name');
  const inferred = new Set(['minecraft_version', 'server_type', 'ram_min_mb', 'ram_max_mb', 'port']);
  const visibleFields = widget.fields.filter(field => {
    if (setupForm && field.name === 'search_query') return false;
    return customize || !inferred.has(field.name) || !values[field.name];
  });
  const isDisabled = submitted || completed;
  return <form onSubmit={event => { event.preventDefault(); if (isDisabled) return; setSubmitted(true); onSubmit(values); }} className={`mt-4 rounded-xl border border-[#34353a] bg-[#1c1d21] p-4 ${isDisabled ? 'opacity-60' : ''}`}>
    <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-white">{widget.title}</h3>{setupForm && <button disabled={isDisabled} type="button" onClick={() => setCustomize(value => !value)} className="text-xs text-gray-500 hover:text-gray-200 disabled:cursor-not-allowed">{customize ? 'Use defaults' : 'Customize'}</button>}</div>
    {setupForm && !customize && <p className="mb-3 text-xs text-gray-500">{values.server_type || 'paper'} · Minecraft {values.minecraft_version || 'choose version'} · {Number(values.ram_min_mb || 0) / 1024}–{Number(values.ram_max_mb || 0) / 1024} GB RAM · port {values.port}</p>}
    <div className="grid gap-3 sm:grid-cols-2">{visibleFields.map(field => <label key={field.name} className={field.type === 'checkbox' ? 'flex items-center gap-3 rounded-md border border-[#2a2b2f] p-3 sm:col-span-2' : 'block'}>{field.type === 'checkbox' ? <><input disabled={isDisabled} required type="checkbox" checked={values[field.name] === 'true'} onChange={event => setValues(current => ({ ...current, [field.name]: String(event.target.checked) }))} /><span className="text-sm text-gray-300">{field.label}</span></> : <><span className="mb-1 block text-xs text-gray-500">{field.label}</span>{field.type === 'select' ? <select disabled={isDisabled} required value={values[field.name] || ''} onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))} className="w-full rounded-md border border-[#2a2b2f] bg-[#0f0f11] px-3 py-2 text-sm text-white"><option value="">Choose…</option>{field.options?.map(option => <option key={option}>{option}</option>)}</select> : <input disabled={isDisabled} required type={field.type} value={values[field.name] || ''} onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))} className="w-full rounded-md border border-[#2a2b2f] bg-[#0f0f11] px-3 py-2 text-sm text-white outline-none focus:border-blue-500" />}</>}</label>)}</div>
    <button disabled={isDisabled} className={`action-button mt-4 px-4 text-sm font-medium text-white disabled:cursor-not-allowed ${completed ? 'bg-emerald-600 hover:bg-emerald-600' : 'bg-blue-600 hover:bg-blue-700'}`}>
      {completed ? (
        <span className="flex items-center gap-1.5"><Check size={15} /> Completed</span>
      ) : submitted ? (
        <span className="flex items-center gap-1.5"><Loader2 size={15} className="animate-spin" /> Working…</span>
      ) : (
        'Continue'
      )}
    </button>
  </form>;
}

function ServerSelectWidget({ widget, completed, onSelect }: { widget: Widget; completed: boolean; onSelect: (id: number, name: string) => void }) {
  const options = widget.fields as ServerOption[];
  const [selected, setSelected] = useState<number | null>(options[0]?.id ?? null);
  const [submitted, setSubmitted] = useState(false);
  const isDisabled = submitted || completed;
  const selectedOption = options.find(o => o.id === selected);
  return (
    <div className={`mt-4 rounded-xl border border-[#34353a] bg-[#1c1d21] p-4 ${isDisabled ? 'opacity-60' : ''}`}>
      <h3 className="mb-3 text-sm font-semibold text-white">{widget.title}</h3>
      <select
        disabled={isDisabled}
        value={selected ?? ''}
        onChange={e => setSelected(Number(e.target.value))}
        className="w-full rounded-md border border-[#2a2b2f] bg-[#0f0f11] px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500"
      >
        {options.map(opt => (
          <option key={opt.id} value={opt.id}>
            {opt.name} · {opt.type} {opt.version}
          </option>
        ))}
      </select>
      <button
        disabled={isDisabled || selected === null}
        onClick={() => { if (selected !== null && selectedOption) { setSubmitted(true); onSelect(selected, selectedOption.name); } }}
        className={`action-button mt-3 px-4 text-sm font-medium text-white disabled:cursor-not-allowed ${
          completed ? 'bg-emerald-600 hover:bg-emerald-600' : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {completed ? <span className="flex items-center gap-1.5"><Check size={15} /> Confirmed</span>
          : submitted ? <span className="flex items-center gap-1.5"><Loader2 size={15} className="animate-spin" /> Working…</span>
          : 'Use this server'}
      </button>
    </div>
  );
}
