import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';

interface Props {
  dirty: boolean;
  saving: boolean;
  onSave: () => void | Promise<void>;
  onReset: () => void;
  saveDisabled?: boolean;
}

export default function UnsavedChangesBar({ dirty, saving, onSave, onReset, saveDisabled }: Props) {
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const blockNavigation = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest('a[href]');
      if (!link || link.getAttribute('href') === window.location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      setShaking(false);
      requestAnimationFrame(() => setShaking(true));
    };
    const blockWindowClose = (event: BeforeUnloadEvent) => event.preventDefault();
    document.addEventListener('click', blockNavigation, true);
    window.addEventListener('beforeunload', blockWindowClose);
    return () => {
      document.removeEventListener('click', blockNavigation, true);
      window.removeEventListener('beforeunload', blockWindowClose);
    };
  }, [dirty]);

  if (!dirty) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <div
        onAnimationEnd={() => setShaking(false)}
        className={`pointer-events-auto flex w-full max-w-3xl items-center gap-4 rounded-lg border border-[#2f3035] bg-[#1c1d21] px-4 py-3 shadow-[0_12px_35px_rgba(0,0,0,0.45)] ${shaking ? 'unsaved-shake' : ''}`}
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white">Unsaved changes</div>
          <div className="text-xs text-gray-500">Save or reset before leaving this page.</div>
        </div>
        <button
          onClick={onReset}
          disabled={saving}
          className="rounded-md px-3 py-2 text-sm font-medium text-gray-400 transition-colors hover:bg-[#26272b] hover:text-white disabled:opacity-50"
        >
          Reset
        </button>
        <button
          onClick={onSave}
          disabled={saving || saveDisabled}
          className="action-button bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
