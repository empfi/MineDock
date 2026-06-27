import { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

type NotificationType = 'success' | 'error' | 'warning' | 'info';
type Notification = { id: number; message: string; type: NotificationType; exiting?: boolean };

let notifications: Notification[] = [];
let nextId = 0;
const listeners = new Set<(items: Notification[]) => void>();
const publish = () => listeners.forEach(listener => listener([...notifications]));
const dismiss = (id: number) => {
  notifications = notifications.map(item => item.id === id ? { ...item, exiting: true } : item);
  publish();
  window.setTimeout(() => {
    notifications = notifications.filter(item => item.id !== id);
    publish();
  }, 180);
};

export function notify(message: string, type: NotificationType = 'info') {
  const id = nextId++;
  notifications = [...notifications, { id, message, type }];
  publish();
  window.setTimeout(() => dismiss(id), 4320);
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
          <div key={item.id} className={`app-notification ${item.exiting ? 'is-exiting' : ''} pointer-events-auto flex items-start gap-3 rounded-lg border border-[#34353a] bg-[#1c1d21] p-4 shadow-2xl`}>
            <Icon size={18} className={`${colors[item.type]} mt-0.5 shrink-0`} />
            <p className="flex-1 text-sm text-gray-200">{item.message}</p>
            <button onClick={() => dismiss(item.id)} aria-label="Dismiss notification" className="text-gray-500 hover:text-white">
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
