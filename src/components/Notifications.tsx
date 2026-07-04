import { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, Bell, CheckCircle2, Info, Trash2, X } from 'lucide-react';

type NotificationType = 'success' | 'error' | 'warning' | 'info';
type Notification = { id: number; message: string; type: NotificationType; createdAt?: string; exiting?: boolean };

let notifications: Notification[] = [];
let history: Notification[] = JSON.parse(localStorage.getItem('minedock-notifications') || '[]');
let unread = localStorage.getItem('minedock-notifications-unread') === 'true';
let nextId = Date.now();
const listeners = new Set<(items: Notification[]) => void>();
const historyListeners = new Set<(items: Notification[]) => void>();
const unreadListeners = new Set<(value: boolean) => void>();
const publish = () => listeners.forEach(listener => listener([...notifications]));
const publishHistory = () => {
  localStorage.setItem('minedock-notifications', JSON.stringify(history.slice(0, 100)));
  historyListeners.forEach(listener => listener([...history]));
};
const setUnread = (value: boolean) => {
  unread = value;
  localStorage.setItem('minedock-notifications-unread', String(value));
  unreadListeners.forEach(listener => listener(value));
};
const dismiss = (id: number) => {
  notifications = notifications.map(item => item.id === id ? { ...item, exiting: true } : item);
  publish();
  window.setTimeout(() => {
    notifications = notifications.filter(item => item.id !== id);
    publish();
  }, 180);
};

export function notify(message: string, type: NotificationType = 'info', saveToHistory = true) {
  const id = nextId++;
  const item = { id, message, type, createdAt: new Date().toISOString() };
  notifications = [...notifications, item];
  if (saveToHistory) {
    history = [item, ...history].slice(0, 100);
    publishHistory();
    setUnread(true);
  }
  publish();
  window.setTimeout(() => dismiss(id), 4320);
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(history);
  const [hasUnread, setHasUnread] = useState(unread);
  const centerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    historyListeners.add(setItems);
    unreadListeners.add(setHasUnread);
    return () => {
      historyListeners.delete(setItems);
      unreadListeners.delete(setHasUnread);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!centerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return <div ref={centerRef} className="relative">
    <button onClick={() => setOpen(value => {
      const next = !value;
      if (next) setUnread(false);
      return next;
    })} title="Notifications" className="relative flex h-10 w-11 items-center justify-center text-gray-400 hover:bg-[#202124] hover:text-white"><Bell size={16} />{hasUnread && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-blue-500" />}</button>
    {open && <div className="popover-enter fixed right-3 top-11 z-[110] w-96 origin-top-right overflow-hidden rounded-lg border border-[#2a2b2f] bg-[#1c1d21] shadow-2xl">
      <div className="flex items-center justify-between border-b border-[#2a2b2f] px-4 py-3"><span className="font-semibold text-white">Notifications</span><button onClick={() => { history = []; publishHistory(); }} className="text-gray-600 hover:text-red-400"><Trash2 size={15} /></button></div>
      <div className="max-h-96 overflow-y-auto">{items.length ? items.map(item => <div key={item.id} className="border-b border-[#25262a] px-4 py-3 select-text"><div className="text-sm text-gray-200 break-all">{item.message}</div><div className="mt-1 text-xs text-gray-600">{item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</div></div>) : <div className="py-12 text-center text-sm text-gray-600">No notifications.</div>}</div>
    </div>}
  </div>;
}

export default function Notifications() {
  const [items, setItems] = useState(notifications);
  useEffect(() => {
    listeners.add(setItems);
    return () => { listeners.delete(setItems); };
  }, []);

  const icons = { success: CheckCircle2, error: AlertCircle, warning: AlertTriangle, info: Info };
  const colors = { success: 'text-emerald-400', error: 'text-red-400', warning: 'text-amber-400', info: 'text-blue-400' };

  return (
    <div aria-live="polite" className="fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 pointer-events-none">
      {items.map(item => {
        const Icon = icons[item.type];
        return (
          <div key={item.id} className={`app-notification ${item.exiting ? 'is-exiting' : ''} pointer-events-auto flex items-start gap-3 rounded-lg border border-[#34353a] bg-[#1c1d21] p-4 shadow-2xl select-text`}>
            <Icon size={18} className={`${colors[item.type]} mt-0.5 shrink-0`} />
            <p className="flex-1 text-sm text-gray-200 break-all">{item.message}</p>
            <button onClick={() => dismiss(item.id)} aria-label="Dismiss notification" className="text-gray-500 hover:text-white">
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
