import { useEffect, useState } from 'react';
import { notify } from './Notifications';
import { useStore } from '../store';
import {
  cancelSafeApplyRollback,
  getSafeApplyFailure,
  rollbackSafeApply,
  subscribeSafeApplyFailure,
  type SafeApplyFailure,
} from '../lib/safeApply';

export default function SafeApplyModal() {
  const [failure, setFailure] = useState<SafeApplyFailure | null>(getSafeApplyFailure());
  const [rollingBack, setRollingBack] = useState(false);

  useEffect(() => subscribeSafeApplyFailure(setFailure), []);

  if (!failure) return null;

  const revert = async () => {
    setRollingBack(true);
    try {
      await rollbackSafeApply();
      await useStore.getState().fetchServers();
    } catch (error) {
      notify(`Rollback failed: ${error}`, 'error');
    } finally {
      setRollingBack(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[30000] flex items-center justify-center bg-black/75 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="safe-apply-title" className="w-full max-w-md rounded-xl border border-red-500/30 bg-[#1c1d21] shadow-2xl">
        <div className="p-5">
          <h2 id="safe-apply-title" className="text-lg font-semibold text-white">Update failed</h2>
          <p className="mt-2 text-sm text-gray-400">{failure.label} failed while starting {failure.server.name}.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#2a2b2f] bg-[#141517] p-4">
          <button onClick={cancelSafeApplyRollback} disabled={rollingBack} className="rounded-md bg-[#2a2b2f] px-4 py-2 text-sm text-white hover:bg-[#3a3b3f] disabled:opacity-50">Cancel</button>
          <button onClick={revert} disabled={rollingBack} className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">{rollingBack ? 'Reverting...' : 'Revert changes'}</button>
        </div>
      </section>
    </div>
  );
}
