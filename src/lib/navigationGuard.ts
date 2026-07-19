import { ask } from '@tauri-apps/plugin-dialog';

let dirtyLabel = '';

export function setUnsavedChanges(dirty: boolean, label = 'this page') {
  dirtyLabel = dirty ? label : '';
}

export function confirmNavigation() {
  return !dirtyLabel || window.confirm(`Discard unsaved changes in ${dirtyLabel}?`);
}

export async function confirmNavigationAsync() {
  if (!dirtyLabel) return true;
  return await ask(`Discard unsaved changes in ${dirtyLabel}?`, { title: 'Unsaved Changes', kind: 'warning' });
}
