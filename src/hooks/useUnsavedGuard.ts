import { useEffect, useRef } from 'react';

import { setUnsavedChanges } from '../lib/navigationGuard';

/**
 * Blocks route transitions when `dirty` is true.
 * Works with BrowserRouter by monkey-patching navigate and intercepting popstate.
 */
export function useUnsavedGuard(dirty: boolean, label = 'this page') {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const labelRef = useRef(label);
  labelRef.current = label;

  // Keep the global flag in sync for NavLink onClick interceptors
  useEffect(() => {
    setUnsavedChanges(dirty, label);
    return () => setUnsavedChanges(false, '');
  }, [dirty, label]);

  // Block browser back/forward
  useEffect(() => {
    if (!dirty) return;

    const handlePopState = () => {
      if (dirtyRef.current) {
        const discard = window.confirm(`You have unsaved changes in ${labelRef.current}. Discard them?`);
        if (!discard) {
          // Push the current URL back (undo the back/forward)
          window.history.pushState(null, '', window.location.href);
        }
      }
    };

    // Push a duplicate entry so we can catch the back button
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [dirty]);

  // Block window/tab close
  useEffect(() => {
    if (!dirty) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);
}
