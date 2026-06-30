import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  busyMessage?: string;
  checkboxLabel?: string;
  checkboxValue?: boolean;
  onCheckboxChange?: (checked: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ title, message, confirmLabel, danger = true, busy = false, busyMessage, checkboxLabel, checkboxValue, onCheckboxChange, onConfirm, onCancel }: ConfirmDialogProps) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && !busy && onCancel();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="w-full max-w-md rounded-lg border border-[#2a2b2f] bg-[#1c1d21] shadow-xl">
        <div className="flex gap-3 p-5">
          <AlertTriangle className={danger ? 'text-red-400' : 'text-amber-400'} size={22} />
          <div>
            <h2 id="confirm-title" className="font-semibold text-white">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-400">{busy && busyMessage ? busyMessage : message}</p>
            {busy && (
              <div className="mt-4 h-1 overflow-hidden rounded-full bg-[#2a2b2f]">
                <div className="delete-progress h-full w-1/3 rounded-full bg-red-500" />
              </div>
            )}
            {checkboxLabel && (
              <label className="mt-4 flex items-center gap-2 cursor-pointer text-sm text-gray-300 hover:text-white">
                <input 
                  type="checkbox" 
                  checked={checkboxValue} 
                  disabled={busy}
                  onChange={(e) => onCheckboxChange && onCheckboxChange(e.target.checked)} 
                  className="rounded border-gray-600 bg-transparent text-blue-500 focus:ring-0" 
                />
                {checkboxLabel}
              </label>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#2a2b2f] bg-[#141517] p-4">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-md bg-[#2a2b2f] px-4 py-2 text-sm text-white hover:bg-[#3a3b3f] disabled:opacity-50">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className={`action-button px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
