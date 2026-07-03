let dirtyLabel = '';

export function setUnsavedChanges(dirty: boolean, label = 'this page') {
  dirtyLabel = dirty ? label : '';
}

export function confirmNavigation() {
  return !dirtyLabel || window.confirm(`Discard unsaved changes in ${dirtyLabel}?`);
}
