import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { Clock, Plus, Trash2, Play, Check, X, Loader2, List } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import { notify } from '../components/Notifications';
import EmptyState from '../components/EmptyState';
import { ListSkeleton } from '../components/LoadingState';
import { ServerSchedule } from '../types';

export default function Schedules() {
  const navigate = useNavigate();
  const { servers, selectedServerId } = useStore();
  const selectedServer = servers.find(server => server.id === selectedServerId);

  const [schedules, setSchedules] = useState<ServerSchedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingScheduleId, setDeletingScheduleId] = useState<number | null>(null);
  const [triggeringId, setTriggeringId] = useState<number | null>(null);

  const loadSchedules = async () => {
    if (!selectedServerId) return;
    setLoading(true);
    try {
      const result = await invoke<ServerSchedule[]>('get_server_schedules', {
        serverId: selectedServerId,
      });
      setSchedules(result);
    } catch (error) {
      notify('Failed to load schedules: ' + error, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSchedules();
  }, [selectedServerId]);

  const handleOpenAddModal = () => {
    navigate('/schedules/new');
  };

  const handleOpenEditModal = (schedule: ServerSchedule) => {
    navigate(`/schedules/${schedule.id}`);
  };

  const handleToggleActive = async (schedule: ServerSchedule) => {
    const updated = { ...schedule, is_active: !schedule.is_active };
    try {
      await invoke('update_server_schedule', { schedule: updated });
      setSchedules(prev => prev.map(s => s.id === schedule.id ? updated : s));
      notify(`Schedule ${updated.is_active ? 'enabled' : 'disabled'}.`, 'success', false);
    } catch (error) {
      notify('Failed to toggle schedule: ' + error, 'error');
    }
  };

  const handleRunNow = async (id: number) => {
    setTriggeringId(id);
    try {
      await invoke('trigger_schedule_now', { id });
      notify('Schedule triggered successfully.', 'success');
    } catch (error) {
      notify('Failed to trigger schedule: ' + error, 'error');
    } finally {
      setTriggeringId(null);
    }
  };

  const handleDelete = async () => {
    if (deletingScheduleId === null) return;
    try {
      await invoke('delete_server_schedule', { id: deletingScheduleId });
      notify('Schedule deleted successfully.', 'success');
      setSchedules(prev => prev.filter(s => s.id !== deletingScheduleId));
    } catch (error) {
      notify('Failed to delete schedule: ' + error, 'error');
    } finally {
      setDeletingScheduleId(null);
    }
  };



  if (!selectedServer) return <div className="p-8 text-center text-gray-500">Select a server from the sidebar.</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Schedules</h1>
          <p className="text-gray-400">Automate actions like server restarts, backups, or console commands.</p>
        </div>
        <button
          onClick={handleOpenAddModal}
          className="action-button bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700"
        >
          <Plus size={18} />
          <span>New Schedule</span>
        </button>
      </div>

      <div>
        {loading ? (
          <div className="py-6">
            <ListSkeleton rows={3} />
          </div>
        ) : schedules.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#2a2b2f] py-16 text-center text-gray-500">
            <EmptyState
              icon={Clock}
              title="No schedules configured"
              description="Create automated schedules to start, stop, restart, backup, or send commands to your server."
              action="Create Schedule"
              onAction={handleOpenAddModal}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {schedules.map(schedule => (
              <div key={schedule.id} className={`flex flex-col sm:flex-row sm:items-center justify-between rounded-lg border border-[#2a2b2f] p-5 gap-4 transition-colors ${schedule.is_active ? 'bg-[#1c1d21] hover:border-gray-600' : 'bg-gray-900/10 opacity-70 hover:bg-[#1a1b1e]'}`}>
                <div onClick={() => handleOpenEditModal(schedule)} className="flex gap-4 items-start min-w-0 cursor-pointer flex-1 group">
                  <div className={`p-2.5 rounded-lg border bg-[#0f0f11] flex-shrink-0 transition-colors ${schedule.is_active ? 'text-blue-400 border-[#2a2b2f] group-hover:border-blue-500/30' : 'text-gray-600 border-gray-800'}`}>
                    <Clock size={20} />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-white text-base group-hover:text-blue-400 transition-colors">{schedule.name}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-gray-400">
                      <span className="px-2 py-0.5 text-xs font-semibold rounded border bg-[#0f0f11] text-gray-400 border-[#2a2b2f] flex items-center gap-1.5">
                        <List size={12} /> {schedule.tasks?.length || 0} Task{schedule.tasks?.length !== 1 ? 's' : ''}
                      </span>
                      <span className="text-gray-600">|</span>
                      <span>Status: <span className={schedule.is_active ? 'text-emerald-400 font-medium' : 'text-gray-500'}>{schedule.is_active ? 'Active' : 'Disabled'}</span></span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  <button
                    onClick={() => handleToggleActive(schedule)}
                    title={schedule.is_active ? 'Disable schedule' : 'Enable schedule'}
                    className={`p-2 rounded-md border border-[#2a2b2f] bg-[#0f0f11] transition-colors hover:text-white ${schedule.is_active ? 'text-red-400 hover:bg-red-950/20' : 'text-emerald-500 hover:bg-emerald-950/20'}`}
                  >
                    {schedule.is_active ? <X size={16} /> : <Check size={16} />}
                  </button>

                  <button
                    onClick={() => handleRunNow(schedule.id!)}
                    disabled={triggeringId === schedule.id}
                    title="Trigger schedule now"
                    className="p-2 rounded-md border border-[#2a2b2f] bg-[#0f0f11] text-blue-400 transition-colors hover:bg-blue-950/20 hover:text-blue-300 disabled:opacity-40"
                  >
                    {triggeringId === schedule.id ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                  </button>

                  <button
                    onClick={() => setDeletingScheduleId(schedule.id!)}
                    title="Delete schedule"
                    className="p-2 rounded-md border border-[#2a2b2f] bg-[#0f0f11] text-red-400 transition-colors hover:bg-red-950/20 hover:text-red-300"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>



      {/* Delete Confirmation */}
      {deletingScheduleId !== null && (
        <ConfirmDialog
          title="Delete Schedule"
          message="Are you sure you want to delete this schedule? This action cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setDeletingScheduleId(null)}
          danger
        />
      )}
    </div>
  );
}
