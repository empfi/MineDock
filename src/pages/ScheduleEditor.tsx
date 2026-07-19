import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { ArrowLeft, Trash2, HelpCircle, X, Edit2, ArrowUp, ArrowDown } from 'lucide-react';
import { notify } from '../components/Notifications';
import { useUnsavedGuard } from '../hooks/useUnsavedGuard';
import { setUnsavedChanges, confirmNavigationAsync } from '../lib/navigationGuard';
import { ServerSchedule, ScheduleTask } from '../types';
import Button from '../components/Button';

// A simple preview fallback since cron-parser failed to install
function getNextRunPreview(cron: string): string {
  if (cron === '* * * * *') return 'Every minute';
  if (cron === '*/5 * * * *') return 'Every 5 minutes';
  if (cron === '0 * * * *') return 'Every hour, on the hour';
  if (cron === '0 */6 * * *') return 'Every 6 hours';
  if (cron === '0 0 * * *') return 'Every day at midnight';
  if (cron === '0 0 * * 0') return 'Every Sunday at midnight';
  return `Custom cron schedule (${cron})`;
}

export default function ScheduleEditor() {
  const { scheduleId } = useParams();
  const navigate = useNavigate();
  const { selectedServerId } = useStore();
  
  const isNew = scheduleId === 'new';
  const [loading, setLoading] = useState(!isNew);
  
  // Schedule metadata
  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [requireOnline, setRequireOnline] = useState(false);
  
  // Cron expression
  const [cronFields, setCronFields] = useState(['*/5', '*', '*', '*', '*']);
  
  // Tasks
  const [tasks, setTasks] = useState<ScheduleTask[]>([]);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTaskIndex, setEditingTaskIndex] = useState<number | null>(null);
  
  // Task Form State
  const [taskAction, setTaskAction] = useState<ScheduleTask['action']>('start');
  const [taskPayload, setTaskPayload] = useState('');
  const [taskTimeOffset, setTaskTimeOffset] = useState(0);
  const [taskContinueOnFailure, setTaskContinueOnFailure] = useState(true);

  // Dirty state tracking
  const [initialStateStr, setInitialStateStr] = useState<string | null>(null);
  
  useEffect(() => {
    if (isNew) {
      setInitialStateStr(JSON.stringify({ name: '', isActive: true, requireOnline: false, cronFields: ['*/5', '*', '*', '*', '*'], tasks: [] }));
    }
  }, [isNew]);
  
  const currentStateStr = JSON.stringify({ name, isActive, requireOnline, cronFields, tasks });
  const isDirty = initialStateStr !== null && currentStateStr !== initialStateStr;

  useUnsavedGuard(isDirty, 'Schedule Editor');

  // Load schedule if editing
  useEffect(() => {
    const loadData = async () => {
      if (!isNew && selectedServerId) {
        try {
          const schedules = await invoke<ServerSchedule[]>('get_server_schedules', { serverId: selectedServerId });
          const schedule = schedules.find(s => s.id?.toString() === scheduleId);
          if (schedule) {
            setName(schedule.name);
            setIsActive(schedule.is_active);
            setRequireOnline(schedule.require_online);
            setCronFields(schedule.cron_expression.split(' '));
            setTasks(schedule.tasks || []);
            setInitialStateStr(JSON.stringify({
              name: schedule.name,
              isActive: schedule.is_active,
              requireOnline: schedule.require_online,
              cronFields: schedule.cron_expression.split(' '),
              tasks: schedule.tasks || []
            }));
          } else {
            notify('Schedule not found', 'error');
            navigate('/schedules');
          }
        } catch (e) {
          notify('Failed to load schedule: ' + e, 'error');
        } finally {
          setLoading(false);
        }
      }
    };
    loadData();
  }, [isNew, scheduleId, selectedServerId]);

  const handleCronChange = (index: number, val: string) => {
    const newFields = [...cronFields];
    newFields[index] = val;
    setCronFields(newFields);
  };

  const openTaskModal = (index?: number) => {
    if (index !== undefined) {
      const t = tasks[index];
      setTaskAction(t.action);
      setTaskPayload(t.payload || '');
      setTaskTimeOffset(t.time_offset_secs);
      setTaskContinueOnFailure(t.continue_on_failure);
      setEditingTaskIndex(index);
    } else {
      setTaskAction('start');
      setTaskPayload('');
      setTaskTimeOffset(0);
      setTaskContinueOnFailure(true);
      setEditingTaskIndex(null);
    }
    setShowTaskModal(true);
  };

  const saveTask = (e: React.FormEvent) => {
    e.preventDefault();
    const newTask: ScheduleTask = {
      sequence_order: 0,
      action: taskAction,
      payload: taskAction === 'command' ? taskPayload : undefined,
      time_offset_secs: taskTimeOffset,
      continue_on_failure: taskContinueOnFailure
    };
    
    if (editingTaskIndex !== null) {
      const updated = [...tasks];
      updated[editingTaskIndex] = newTask;
      setTasks(updated);
    } else {
      setTasks([...tasks, newTask]);
    }
    setShowTaskModal(false);
  };

  const moveTask = (index: number, dir: -1 | 1) => {
    if (index + dir < 0 || index + dir >= tasks.length) return;
    const updated = [...tasks];
    const temp = updated[index];
    updated[index] = updated[index + dir];
    updated[index + dir] = temp;
    setTasks(updated);
  };

  const handleSave = async () => {
    if (!selectedServerId) return;
    if (!name.trim()) {
      notify('Name is required', 'warning');
      return;
    }
    if (tasks.length === 0) {
      notify('At least one task is required', 'warning');
      return;
    }

    if (cronFields.length !== 5 || cronFields.some(f => !f.trim())) {
      notify('Invalid cron expression', 'error');
      return;
    }

    // Re-assign sequence orders
    const orderedTasks = tasks.map((t, i) => ({ ...t, sequence_order: i + 1 }));

    const payload: ServerSchedule = {
      id: isNew ? undefined : parseInt(scheduleId!),
      server_id: selectedServerId,
      name,
      cron_expression: cronFields.join(' '),
      is_active: isActive,
      require_online: requireOnline,
      tasks: orderedTasks
    };

    try {
      if (isNew) {
        await invoke('add_server_schedule', { schedule: payload });
        notify('Schedule created', 'success');
      } else {
        await invoke('update_server_schedule', { schedule: payload });
        notify('Schedule updated', 'success');
      }
      setUnsavedChanges(false, '');
      navigate('/schedules');
    } catch (e) {
      notify('Failed to save schedule: ' + e, 'error');
    }
  };

  if (loading) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full">
      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-4">
          <button onClick={async () => { if (await confirmNavigationAsync()) navigate('/schedules'); }} className="p-2 hover:bg-[#1a1b1e] rounded-md transition-colors text-gray-400">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-3xl font-bold tracking-tight text-white">{isNew ? 'New Schedule' : 'Edit Schedule'}</h1>
        </div>
        <Button variant="primary" onClick={handleSave}>
          Save Schedule
        </Button>
      </div>

      <div className="space-y-6 max-w-5xl">
        {/* Name section */}
        <div className="flex flex-col">
          <label className="text-sm font-semibold text-gray-300 mb-2">Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="bg-[#0f0f11] border border-[#2a2b2f] rounded-md px-3 py-2 text-white outline-none focus:border-blue-500 w-full"
            placeholder="Daily Restart"
          />
        </div>

        {/* Toggles */}
        <div className="flex flex-col sm:flex-row gap-8">
          <div className="flex items-center gap-3">
            <label className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              Only when Server is Online?
              <span title="If enabled, this schedule will only execute if the server is currently online." className="cursor-help inline-flex items-center">
                <HelpCircle size={14} className="text-gray-500" />
              </span>
            </label>
            <button
              onClick={() => setRequireOnline(!requireOnline)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${requireOnline ? 'bg-blue-600' : 'bg-[#2a2b2f]'}`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${requireOnline ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-sm font-semibold text-gray-300">Status</label>
            <button
              onClick={() => setIsActive(!isActive)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${isActive ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/20' : 'bg-gray-800 text-gray-400 border border-[#2a2b2f]'}`}
            >
              {isActive ? 'Active' : 'Disabled'}
            </button>
          </div>
        </div>

        {/* Cron Box */}
        <div className="bg-[#141517] border border-[#2a2b2f] rounded-lg p-5">
          <h2 className="text-lg font-bold text-white mb-1">Cron</h2>
          <p className="text-sm text-gray-400 mb-4">
            Please keep in mind that the cron inputs below always assume UTC.<br />
            Preview: <strong className="text-gray-300">{getNextRunPreview(cronFields.join(' '))}</strong>
          </p>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Minute</label>
              <input type="text" value={cronFields[0]} onChange={e => handleCronChange(0, e.target.value)} className="w-full bg-[#0a0a0c] border border-[#2a2b2f] rounded-md px-3 py-2 text-white font-mono outline-none focus:border-blue-500 transition-colors" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Hour</label>
              <input type="text" value={cronFields[1]} onChange={e => handleCronChange(1, e.target.value)} className="w-full bg-[#0a0a0c] border border-[#2a2b2f] rounded-md px-3 py-2 text-white font-mono outline-none focus:border-blue-500 transition-colors" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Day of Month</label>
              <input type="text" value={cronFields[2]} onChange={e => handleCronChange(2, e.target.value)} className="w-full bg-[#0a0a0c] border border-[#2a2b2f] rounded-md px-3 py-2 text-white font-mono outline-none focus:border-blue-500 transition-colors" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Month</label>
              <input type="text" value={cronFields[3]} onChange={e => handleCronChange(3, e.target.value)} className="w-full bg-[#0a0a0c] border border-[#2a2b2f] rounded-md px-3 py-2 text-white font-mono outline-none focus:border-blue-500 transition-colors" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Day of Week</label>
              <input type="text" value={cronFields[4]} onChange={e => handleCronChange(4, e.target.value)} className="w-full bg-[#0a0a0c] border border-[#2a2b2f] rounded-md px-3 py-2 text-white font-mono outline-none focus:border-blue-500 transition-colors" />
            </div>
          </div>
        </div>

        {/* Tasks Box */}
        <div className="bg-[#141517] border border-[#2a2b2f] rounded-lg overflow-hidden">
          <div className="p-5 border-b border-[#2a2b2f] flex justify-between items-center">
            <h2 className="text-lg font-bold text-white">Tasks</h2>
            {tasks.length > 0 && (
              <Button variant="secondary" onClick={() => openTaskModal()}>Add Task</Button>
            )}
          </div>

          {tasks.length === 0 ? (
            <div className="py-16 text-center flex flex-col items-center">
              <div className="bg-[#0f0f11] p-4 rounded-full border border-[#2a2b2f] mb-4 text-gray-500">
                <X size={24} />
              </div>
              <h3 className="text-lg font-bold text-white mb-1">No tasks</h3>
              <p className="text-sm text-gray-400 mb-4">Create a task to get started.</p>
              <Button variant="primary" onClick={() => openTaskModal()}>Add First Task</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-gray-300">
                <thead className="bg-[#0f0f11] text-xs font-semibold uppercase text-gray-400 border-b border-[#2a2b2f]">
                  <tr>
                    <th className="px-6 py-4">Action</th>
                    <th className="px-6 py-4">Payload</th>
                    <th className="px-6 py-4">Time Offset</th>
                    <th className="px-6 py-4">Continue On Failure</th>
                    <th className="px-6 py-4 text-right">Manage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2a2b2f]">
                  {tasks.map((task, i) => (
                    <tr key={i} className="hover:bg-[#1a1b1e] transition-colors group">
                      <td className="px-6 py-4 font-medium text-white capitalize">{task.action}</td>
                      <td className="px-6 py-4 font-mono text-xs">{task.payload || '-'}</td>
                      <td className="px-6 py-4">{task.time_offset_secs}s</td>
                      <td className="px-6 py-4">{task.continue_on_failure ? 'Yes' : 'No'}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => moveTask(i, -1)} disabled={i === 0} title="Move Up" className="p-1.5 rounded-md text-gray-500 hover:bg-[#2a2b2f] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-500 transition-colors">
                            <ArrowUp size={16} />
                          </button>
                          <button type="button" onClick={() => moveTask(i, 1)} disabled={i === tasks.length - 1} title="Move Down" className="p-1.5 rounded-md text-gray-500 hover:bg-[#2a2b2f] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-500 transition-colors">
                            <ArrowDown size={16} />
                          </button>
                          <div className="w-px h-4 bg-[#2a2b2f] mx-1"></div>
                          <button type="button" onClick={() => openTaskModal(i)} title="Edit Task" className="p-1.5 rounded-md text-gray-500 hover:bg-blue-600/20 hover:text-blue-400 transition-colors">
                            <Edit2 size={16} />
                          </button>
                          <button type="button" onClick={() => setTasks(tasks.filter((_, idx) => idx !== i))} title="Delete Task" className="p-1.5 rounded-md text-gray-500 hover:bg-red-600/20 hover:text-red-400 transition-colors">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Task Modal */}
      {showTaskModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-[#141517] border border-[#2a2b2f] rounded-lg shadow-2xl overflow-hidden flex flex-col">
            <div className="p-5 border-b border-[#2a2b2f]">
              <h2 className="text-lg font-bold text-white">{editingTaskIndex !== null ? 'Edit Task' : 'New Task'}</h2>
            </div>
            <form onSubmit={saveTask} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1">Action</label>
                <select value={taskAction} onChange={e => setTaskAction(e.target.value as any)} className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded px-3 py-2 text-white outline-none focus:border-blue-500">
                  <option value="start">Start Server</option>
                  <option value="stop">Stop Server</option>
                  <option value="restart">Restart Server</option>
                  <option value="command">Send Command</option>
                  <option value="backup">Create Backup</option>
                </select>
              </div>

              {taskAction === 'command' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-1">Command Payload</label>
                  <input type="text" value={taskPayload} onChange={e => setTaskPayload(e.target.value)} required placeholder="say Hello!" className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded px-3 py-2 text-white font-mono text-sm outline-none focus:border-blue-500" />
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1">Time Offset (Seconds)</label>
                <input type="number" min="0" max="3600" value={taskTimeOffset} onChange={e => setTaskTimeOffset(parseInt(e.target.value) || 0)} className="w-full bg-[#0f0f11] border border-[#2a2b2f] rounded px-3 py-2 text-white outline-none focus:border-blue-500" />
                <p className="text-xs text-gray-500 mt-1">Wait this many seconds before running this task.</p>
              </div>

              <div className="flex items-center gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => setTaskContinueOnFailure(!taskContinueOnFailure)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${taskContinueOnFailure ? 'bg-blue-600' : 'bg-[#2a2b2f]'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${taskContinueOnFailure ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
                <span className="text-sm font-medium text-gray-300">Continue if this task fails?</span>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-[#2a2b2f] mt-4">
                <Button variant="secondary" onClick={() => setShowTaskModal(false)}>Cancel</Button>
                <Button variant="primary" type="submit">Save Task</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
