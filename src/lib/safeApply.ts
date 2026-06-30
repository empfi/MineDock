import { invoke } from '@tauri-apps/api/core';
import type { Server } from '../types';
import { notify } from '../components/Notifications';

type SafeApplyOptions = {
  server: Server;
  label: string;
  operation: () => Promise<void>;
  rollbackMetadata?: (() => Promise<void>) | { command: string; args: any };
  onStatus?: (status: string) => void;
  cleanupOnSuccess?: boolean;
};

export type SafeApplyFailure = {
  server: Server;
  label: string;
  backupName: string;
  error: string;
  rollbackMetadata?: (() => Promise<void>) | { command: string; args: any };
};

const ARMED_APPLIES_KEY = 'minedock_armed_applies';
const PENDING_FAILURE_KEY = 'minedock_pending_failure';

type ArmedApply = { failure: SafeApplyFailure; started: boolean; attempts?: number; timer?: number };

function loadArmedApplies(): Map<number, ArmedApply> {
  try {
    const val = localStorage.getItem(ARMED_APPLIES_KEY);
    if (val) {
      const parsed = JSON.parse(val);
      const map = new Map<number, any>(parsed.map(([k, v]: any) => [Number(k), v]));
      for (const entry of map.values()) {
        entry.started = false;
      }
      return map;
    }
  } catch (e) {
    console.error('Failed to load armed applies:', e);
  }
  return new Map();
}

function saveArmedApplies() {
  try {
    const arr = Array.from(armedApplies.entries()).map(([k, v]) => {
      const { timer, ...rest } = v;
      return [k, rest];
    });
    localStorage.setItem(ARMED_APPLIES_KEY, JSON.stringify(arr));
  } catch (e) {
    console.error('Failed to save armed applies:', e);
  }
}

// Clear any stale pending failure from local storage
try {
  localStorage.removeItem(PENDING_FAILURE_KEY);
} catch (e) {}

let pendingFailure: SafeApplyFailure | null = null;
const armedApplies = loadArmedApplies();
const listeners = new Set<(failure: SafeApplyFailure | null) => void>();
const publish = () => {
  listeners.forEach(listener => listener(pendingFailure));
};

export function getSafeApplyFailure() {
  return pendingFailure;
}

export function subscribeSafeApplyFailure(listener: (failure: SafeApplyFailure | null) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function cancelSafeApplyRollback() {
  if (pendingFailure && pendingFailure.server.id) {
    const numericId = Number(pendingFailure.server.id);
    armedApplies.delete(numericId);
    saveArmedApplies();
    console.log('[SafeApply] User cancelled/dismissed failure modal. Disarmed server:', numericId);
  }
  pendingFailure = null;
  publish();
}

function publishFailure(failure: SafeApplyFailure) {
  pendingFailure = failure;
  publish();
  console.log('[SafeApply] publishFailure called for server:', failure.server.id, 'label:', failure.label);
  window.dispatchEvent(new CustomEvent('minedock:safe-apply-failed', { detail: { serverId: Number(failure.server.id) } }));
}

export function observeSafeApplyStatus(serverId: any, status: string) {
  const numericId = Number(serverId);
  const armed = armedApplies.get(numericId);
  console.log('[SafeApply] observeSafeApplyStatus serverId:', serverId, 'numericId:', numericId, 'status:', status, 'hasArmed:', !!armed, 'armedStarted:', armed?.started);
  if (!armed) return;

  if (status === 'starting') {
    armed.started = true;
    saveArmedApplies();
    return;
  }

  const isFailureStatus = ['crashed', 'crash-loop', 'restarting'].includes(status) || (status === 'offline' && armed.started);
  if (isFailureStatus) {
    if (armed.timer) window.clearTimeout(armed.timer);
    armed.started = false;
    saveArmedApplies();
    console.log('[SafeApply] observeSafeApplyStatus failure detected for server:', numericId, 'status:', status);
    publishFailure({ ...armed.failure, error: `Server failed during startup (${status})` });
    return;
  }

  if (armed.started && status === 'online' && !armed.timer) {
    console.log('[SafeApply] observeSafeApplyStatus server online, starting verification timer for:', numericId);
    armed.timer = window.setTimeout(async () => {
      const current = await invoke<Server[]>('fetch_servers');
      if (current.find(server => Number(server.id) === numericId)?.status !== 'online') return;
      armedApplies.delete(numericId);
      saveArmedApplies();
      await invoke('remove_mc_backup', {
        serverPath: armed.failure.server.install_path,
        backupName: `${armed.failure.backupName}.zip`,
      });
      console.log('[SafeApply] observeSafeApplyStatus verification success, removed backup for:', numericId);
      notify(`${armed.failure.label} verified. Temporary restore point removed.`, 'success');
    }, 10000);
  }
}

export function failArmedSafeApply(serverId: any, error: unknown) {
  const numericId = Number(serverId);
  const armed = armedApplies.get(numericId);
  console.log('[SafeApply] failArmedSafeApply serverId:', serverId, 'numericId:', numericId, 'hasArmed:', !!armed);
  if (!armed) return false;
  if (armed.timer) window.clearTimeout(armed.timer);
  armed.started = false;
  saveArmedApplies();
  publishFailure({ ...armed.failure, error: String(error) });
  return true;
}

const activeStatuses = new Set(['online', 'starting', 'restarting', 'stopping']);

async function stopForRollback(server: Server) {
  if (!server.id) return;
  const numericId = Number(server.id);
  const servers = await invoke<Server[]>('fetch_servers');
  const current = servers.find(item => Number(item.id) === numericId);
  if (!current || !activeStatuses.has(current.status)) return;

  if (current.status !== 'stopping') await invoke('stop_mc_server', { id: numericId });
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const latest = await invoke<Server[]>('fetch_servers');
    if (latest.find(item => Number(item.id) === numericId)?.status === 'offline') return;
  }
  throw new Error('Server did not stop before rollback');
}

export async function rollbackSafeApply() {
  const failure = pendingFailure;
  if (!failure) return;
  console.log('[SafeApply] rollbackSafeApply starting for server:', failure.server.id);
  await stopForRollback(failure.server);
  await invoke('restore_safe_apply_backup', {
    serverPath: failure.server.install_path,
    backupName: `${failure.backupName}.zip`,
  });
  if (failure.rollbackMetadata) {
    if (typeof failure.rollbackMetadata === 'function') {
      await failure.rollbackMetadata();
    } else if (typeof failure.rollbackMetadata === 'object' && failure.rollbackMetadata.command) {
      await invoke(failure.rollbackMetadata.command, failure.rollbackMetadata.args);
    }
  }
  await invoke('remove_mc_backup', {
    serverPath: failure.server.install_path,
    backupName: `${failure.backupName}.zip`,
  });

  if (failure.server.id) {
    armedApplies.delete(Number(failure.server.id));
    saveArmedApplies();
  }

  pendingFailure = null;
  publish();
  notify(`${failure.label} rolled back.`, 'success');
}

export async function safeApply({ server, label, operation, rollbackMetadata, onStatus, cleanupOnSuccess = false }: SafeApplyOptions) {
  const skipBackup = localStorage.getItem('minedock:backup_before_install') !== 'true';

  if (skipBackup) {
    onStatus?.('Applying changes...');
    try {
      await operation();
      return;
    } catch (error) {
      console.error('[SafeApply] failed (without restore point):', error);
      throw error;
    }
  }

  const backupName = `safe-apply-${Date.now()}`;
  onStatus?.('Creating restore point...');
  await invoke('create_mc_backup', { serverPath: server.install_path, backupName });

  try {
    await operation();
    if (cleanupOnSuccess) {
      await invoke('remove_mc_backup', { serverPath: server.install_path, backupName: `${backupName}.zip` });
    } else if (server.id) {
      const numericId = Number(server.id);
      armedApplies.set(numericId, {
        failure: { server, label, backupName, error: '', rollbackMetadata },
        started: false,
        attempts: 0,
      });
      saveArmedApplies();
      console.log('[SafeApply] armed server:', numericId, 'backupName:', backupName);
    } else {
      notify(`Safe Apply restore point created for ${label}.`, 'info');
    }
  } catch (error) {
    publishFailure({ server, label, backupName, error: String(error), rollbackMetadata });
    throw error;
  }
}
