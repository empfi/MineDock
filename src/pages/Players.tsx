import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Check, Copy, ListMinus, ListPlus, Search, ShieldCheck, ShieldOff, UserX, Users, X } from 'lucide-react';
import { useStore } from '../store';
import FieldError from '../components/FieldError';
import { notify } from '../components/Notifications';

type Action = 'kick' | 'ban' | 'unban';
type PlayerInfo = {
  uuid: string;
  is_op: boolean;
  banned: boolean;
  whitelist_enabled: boolean;
  whitelisted: boolean;
  kills: number;
  deaths: number;
  play_time_minutes: number;
  money: string | null;
};
type PlayerIdentity = { id: string; name: string };

const unavailable = <span title="Server or installed plugins do not provide this value." className="text-gray-600 cursor-help">Unavailable</span>;

export default function Players() {
  const { servers, selectedServerId, onlinePlayers, consoleLogs, appendConsoleLog } = useStore();
  const server = servers.find(item => item.id === selectedServerId);
  const players = selectedServerId ? onlinePlayers[selectedServerId] || [] : [];
  const [knownPlayers, setKnownPlayers] = useState<string[]>([]);
  const logs = selectedServerId ? consoleLogs[selectedServerId] || [] : [];
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');
  const usernameError = query.trim() && !/^[A-Za-z0-9_]{3,16}$/.test(query.trim()) ? 'Use a 3–16 character Minecraft username.' : '';
  const [info, setInfo] = useState<PlayerInfo | null>(null);
  const [searching, setSearching] = useState(false);

  const allPlayers = [...new Set([...players, ...knownPlayers])];
  const filtered = allPlayers.filter(player => player.toLowerCase().includes(query.toLowerCase()));
  const details = useMemo(() => {
    if (!selected) return { uuid: '', location: '' };
    const text = logs.map(log => log.text).join('\n');
    return {
      uuid: text.match(new RegExp(`UUID of player ${selected} is ([0-9a-f-]+)`, 'i'))?.[1] || '',
      location: text.match(new RegExp(`${selected}.*?logged in.*?at \\(([^)]+)\\)`, 'i'))?.[1] || '',
    };
  }, [logs, selected]);

  const isOnline = !!selected && players.includes(selected);

  useEffect(() => {
    if (!server) return;
    const load = () => invoke<string[]>('get_player_names', { serverPath: server.install_path }).then(setKnownPlayers).catch(() => setKnownPlayers([]));
    load();
    const timer = window.setInterval(load, 3000);
    return () => window.clearInterval(timer);
  }, [server?.install_path]);

  useEffect(() => {
    setInfo(null);
    if (!selected || !server) return;
    invoke<PlayerInfo>('get_player_info', { serverPath: server.install_path, username: selected })
      .then(setInfo)
      .catch(cause => setError(String(cause)));
  }, [selected, server?.install_path]);

  const copy = async (label: string, value: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(''), 1200);
  };

  const runAction = async () => {
    if (!selectedServerId || !selected || !action || (!isOnline && action === 'kick')) return;
    const command = `${action === 'unban' ? 'pardon' : action} ${selected}${reason.trim() && action !== 'unban' ? ` ${reason.trim()}` : ''}`;
    try {
      await invoke('send_mc_command', { id: selectedServerId, command });
      appendConsoleLog(selectedServerId, `> ${command}`, false);
      setAction(null);
      setReason('');
      if (action === 'kick') setSelected(null);
      else setInfo(current => current ? { ...current, banned: action === 'ban' } : current);
    } catch (cause) {
      setError(String(cause));
    }
  };

  const searchMinecraft = async () => {
    setSearching(true);
    try {
      const player = await invoke<PlayerIdentity>('lookup_minecraft_player', { username: query.trim() });
      setKnownPlayers(current => [...new Set([...current, player.name])]);
      setSelected(player.name);
    } catch (cause) {
      notify(String(cause), 'error');
    } finally {
      setSearching(false);
    }
  };

  const toggleWhitelist = async () => {
    if (!selectedServerId || !selected || !server || !info?.whitelist_enabled) return;
    const command = `whitelist ${info.whitelisted ? 'remove' : 'add'} ${selected}`;
    try {
      if (server.status === 'online') {
        await invoke('send_mc_command', { id: selectedServerId, command });
        appendConsoleLog(selectedServerId, `> ${command}`, false);
      } else {
        await invoke('set_whitelist_player', { serverPath: server.install_path, uuid: info.uuid, username: selected, allowed: !info.whitelisted });
      }
      setInfo(current => current ? { ...current, whitelisted: !current.whitelisted } : current);
      notify(`${selected} ${info.whitelisted ? 'removed from' : 'added to'} whitelist.`, 'success');
    } catch (cause) {
      notify(String(cause), 'error');
    }
  };

  if (!server) return <div className="p-8 text-center text-gray-500">Select a server first.</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full flex flex-col h-full">
      <div className="mb-7">
        <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Players</h1>
        <p className="text-gray-400">{server.name} · {players.length} online</p>
      </div>

      <div className="flex max-w-2xl gap-2 mb-6">
        <label className="relative block flex-1">
          <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && searchMinecraft()} placeholder="Search local or any Minecraft player" aria-invalid={!!usernameError} aria-describedby="player-username-error" className="w-full bg-[#141517] border border-[#2a2b2f] rounded-md py-2.5 pl-10 pr-3 text-sm text-white outline-none focus:border-blue-500" />
          <FieldError id="player-username-error" message={usernameError} />
        </label>
        <span title={!/^[A-Za-z0-9_]{3,16}$/.test(query.trim()) ? 'Enter a valid 3–16 character Minecraft username.' : 'Search Mojang player directory'} className="flex cursor-help">
          <button onClick={searchMinecraft} disabled={searching || !/^[A-Za-z0-9_]{3,16}$/.test(query.trim())} className="px-4 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-help">
            {searching ? 'Searching…' : 'Search Mojang'}
          </button>
        </span>
      </div>

      {filtered.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(player => (
            <button
              key={player}
              onClick={() => setSelected(player)}
              className="flex items-center gap-3 bg-[#1c1d21] border border-[#2a2b2f] hover:border-gray-600 rounded-lg p-4 text-left transition-colors"
            >
              <img src={`https://mc-heads.net/avatar/${encodeURIComponent(player)}/64`} alt="" className="w-12 h-12 rounded-md [image-rendering:pixelated]" />
              <span className="min-w-0">
                <span className="block text-white font-semibold truncate">{player}</span>
                <span className={players.includes(player) ? 'text-xs text-emerald-400' : 'text-xs text-gray-500'}>{players.includes(player) ? 'Online' : 'Offline'}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-[#2a2b2f] rounded-lg text-center text-gray-500 py-16">
          <Users className="mx-auto mb-3 text-gray-700" />
          {players.length ? 'No matching players' : server.status === 'online' ? 'No players online' : 'Server offline'}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4" onMouseDown={() => setSelected(null)}>
          <section role="dialog" aria-modal="true" aria-label={`${selected} details`} onMouseDown={event => event.stopPropagation()} className="w-full max-w-2xl max-h-[90vh] bg-[#1c1d21] border border-[#34353a] rounded-xl shadow-2xl overflow-hidden flex flex-col">
            <header className="flex items-center justify-between p-5 border-b border-[#2a2b2f]">
              <div className="flex items-center gap-3">
                <img src={`https://mc-heads.net/avatar/${encodeURIComponent(selected)}/64`} alt="" className="w-12 h-12 rounded-md [image-rendering:pixelated]" />
                <div><h2 className="text-xl font-bold text-white">{selected}</h2><p className={isOnline ? 'text-sm text-emerald-400' : 'text-sm text-gray-500'}>{isOnline ? 'Online' : 'Offline'}</p></div>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Close" className="p-2 text-gray-400 hover:text-white"><X size={20} /></button>
            </header>

            <div className="p-5 overflow-y-auto">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Quick copy</h3>
              <div className="grid gap-2 mb-6">
                {[['Last location', details.location], ['UUID', info?.uuid || details.uuid], ['Username', selected]].map(([label, value]) => (
                  <button key={label} title={!value ? `${label} is not available for this player.` : `Copy ${label}`} disabled={!value} onClick={() => copy(label, value)} className="flex justify-between gap-4 bg-[#141517] border border-[#2a2b2f] rounded-md px-3 py-2.5 text-left disabled:opacity-50 disabled:cursor-help">
                    <span><span className="block text-xs text-gray-500">{label}</span><span className="text-sm text-gray-200 break-all">{value || 'Unavailable'}</span></span>
                    {copied === label ? <Check size={16} className="text-emerald-400 shrink-0 mt-2" /> : <Copy size={16} className="text-gray-500 shrink-0 mt-2" />}
                  </button>
                ))}
              </div>

              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Info</h3>
              <dl className="grid grid-cols-2 gap-px bg-[#2a2b2f] border border-[#2a2b2f] rounded-md overflow-hidden mb-6">
                {[['Is OP', info ? <span className="text-gray-200">{info.is_op ? 'Yes' : 'No'}</span> : unavailable], ['Kills', info ? <span className="text-gray-200">{info.kills}</span> : unavailable], ['Deaths', info ? <span className="text-gray-200">{info.deaths}</span> : unavailable], ['Money', info?.money ? <span className="text-emerald-400">{info.money}</span> : unavailable], ['Play time', info ? <span className="text-gray-200">{info.play_time_minutes} min</span> : unavailable], ['Status', <span className={isOnline ? 'text-emerald-400' : 'text-gray-500'}>{isOnline ? 'Online' : 'Offline'}</span>]].map(([label, value]) => (
                  <div key={String(label)} className="bg-[#141517] p-3"><dt className="text-xs text-gray-500 mb-1">{label}</dt><dd className="text-sm">{value}</dd></div>
                ))}
              </dl>

              {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
              <div className="flex justify-end gap-2">
                <span title={!info?.whitelist_enabled ? 'Enable whitelist in server.properties before managing it.' : info.whitelisted ? 'Remove player from whitelist' : 'Add player to whitelist'} className={!info?.whitelist_enabled ? 'cursor-help' : ''}>
                  <button disabled={!info?.whitelist_enabled} onClick={toggleWhitelist} className="flex items-center gap-2 px-4 py-2 rounded-md bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 disabled:opacity-40 disabled:cursor-help">
                    {info?.whitelisted ? <ListMinus size={16} /> : <ListPlus size={16} />} {info?.whitelisted ? 'Remove whitelist' : 'Whitelist'}
                  </button>
                </span>
                <span title={isOnline ? 'Kick player' : 'Player must be online to kick them.'} className={!isOnline ? 'cursor-help' : ''}>
                  <button disabled={!isOnline} onClick={() => { setError(''); setAction('kick'); }} className="flex items-center gap-2 px-4 py-2 rounded-md bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-help"><UserX size={16} /> Kick</button>
                </span>
                {info?.banned ? (
                  <button onClick={() => { setError(''); setAction('unban'); }} className="flex items-center gap-2 px-4 py-2 rounded-md bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"><ShieldCheck size={16} /> Unban</button>
                ) : (
                  <button onClick={() => { setError(''); setAction('ban'); }} className="flex items-center gap-2 px-4 py-2 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20"><ShieldOff size={16} /> Ban</button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {action && selected && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <section role="dialog" aria-modal="true" aria-label={`${action} ${selected}`} className="w-full max-w-md bg-[#1c1d21] border border-[#34353a] rounded-xl p-5 shadow-2xl">
            <h2 className="text-lg font-bold text-white mb-1">{action === 'kick' ? 'Kick' : action === 'ban' ? 'Ban' : 'Unban'} {selected}?</h2>
            {action !== 'unban' && <><p className="text-sm text-gray-400 mb-4">Reason is optional.</p><input autoFocus value={reason} onChange={event => setReason(event.target.value)} onKeyDown={event => event.key === 'Enter' && runAction()} placeholder="Reason" className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2.5 text-white outline-none focus:border-blue-500 mb-4" /></>}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setAction(null); setReason(''); }} className="px-4 py-2 text-gray-300 hover:text-white">Cancel</button>
              <button onClick={runAction} className={action === 'kick' ? 'px-4 py-2 rounded-md bg-amber-600 hover:bg-amber-700 text-white' : action === 'ban' ? 'px-4 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white' : 'px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white'}>{action === 'kick' ? 'Kick player' : action === 'ban' ? 'Ban player' : 'Unban player'}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
