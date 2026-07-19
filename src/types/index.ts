export interface Server {
  id?: number;
  name: string;
  minecraft_version: string;
  server_type: string;
  install_path: string;
  jar_path: string;
  status: string;
  ram_min: number;
  ram_max: number;
  java_path: string;
  created_at: string;
  last_started_at?: string;
  port: number;
  share_enabled?: boolean;
  run_in_container?: boolean;
  install_path_exists?: boolean;
  backups_path_exists?: boolean;
}

export interface ServerSchedule {
  id?: number;
  server_id: number;
  name: string;
  cron_expression: string;
  is_active: boolean;
  require_online: boolean;
  tasks: ScheduleTask[];
}

export interface ScheduleTask {
  id?: number;
  schedule_id?: number;
  sequence_order: number;
  action: 'start' | 'stop' | 'restart' | 'command' | 'backup';
  payload?: string;
  time_offset_secs: number;
  continue_on_failure: boolean;
}

export interface AppSettings {
  default_server_dir: string;
  default_ram_min: number;
  default_ram_max: number;
  default_java_path: string;
  theme: string;
  confirm_delete: boolean;
  confirm_stop: boolean;
  auto_scroll_console: boolean;
  check_updates_startup: boolean;
  auto_restart: boolean;
  tunnel_enabled: boolean;
  tunnel_relay: string;
  tunnel_token: string;
}

export interface ConsoleLogEntry {
  id: number;
  text: string;
  isError: boolean;
  timestamp: string;
}
