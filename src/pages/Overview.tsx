import { useStore, PerformanceTick } from '../store';
import { Server, Activity, Cpu } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

function MiniChart({ data, color, label, maxVal }: {
  data: PerformanceTick[];
  color: string;
  label: string;
  maxVal?: number;
}) {
  const width = 220;
  const height = 64;
  const padding = 4;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  const values = data.map(d => label === 'CPU' ? d.cpu : d.memory);
  const latest = values.length > 0 ? values[values.length - 1] : 0;
  const max = maxVal ?? Math.max(...values, 1);

  // Clamp each value so spikes never exceed the chart area
  const clamp = (v: number) => Math.max(0, Math.min(v, max));

  const points = values.map((v, i) => {
    const x = padding + (i / Math.max(values.length - 1, 1)) * chartWidth;
    const y = padding + chartHeight - (clamp(v) / max) * chartHeight;
    return `${x},${y}`;
  });

  const pathD = points.length > 1 ? `M ${points.join(' L ')}` : '';
  const fillD = points.length > 1
    ? `M ${padding},${padding + chartHeight} L ${points.join(' L ')} L ${padding + chartWidth},${padding + chartHeight} Z`
    : '';

  const strokeColor = color === 'blue' ? '#3b82f6' : '#10b981';
  const clipId = `chart-clip-${label}`;

  return (
    <div className="flex-1 min-w-0">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-gray-400">{label}</span>
        <span className={`text-sm font-bold ${color === 'blue' ? 'text-blue-400' : 'text-emerald-400'}`}>
          {label === 'CPU' ? `${latest.toFixed(1)}%` : `${latest} MB`}
        </span>
      </div>
      {/* overflow-hidden + clipPath prevent line spikes from escaping the card */}
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-hidden">
        <defs>
          <linearGradient id={`fill-grad-${label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.3" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.01" />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x={padding} y={padding} width={chartWidth} height={chartHeight} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          {fillD && <path d={fillD} fill={`url(#fill-grad-${label})`} />}
          {pathD && (
            <path
              d={pathD}
              fill="none"
              stroke={strokeColor}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </g>
        {values.length === 0 && (
          <text x={width / 2} y={height / 2} textAnchor="middle" fill="#4b5563" fontSize="10">
            Waiting for data...
          </text>
        )}
      </svg>
    </div>
  );
}

export default function Overview() {
  const { servers, serverStats, setSelectedServer } = useStore();
  const navigate = useNavigate();

  const runningServers = servers.filter(s => s.status === 'online' || s.status === 'starting');
  const totalServers = servers.length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 w-full">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Overview</h1>
          <p className="text-gray-400">Welcome to MineDock server manager.</p>
        </div>
        <button
          onClick={() => navigate('/wizard')}
          className="self-start sm:self-auto bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors"
        >
          Create Server
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-8">
        <div className="bg-[#1c1d21] border border-[#2a2b2f] rounded-lg p-6 flex flex-col">
          <div className="flex items-center gap-3 text-gray-400 mb-2">
            <Server size={20} />
            <h3 className="font-medium">Total Servers</h3>
          </div>
          <p className="text-4xl font-bold text-white">{totalServers}</p>
        </div>
        
        <div className="bg-[#1c1d21] border border-[#2a2b2f] rounded-lg p-6 flex flex-col">
          <div className="flex items-center gap-3 text-emerald-400 mb-2">
            <Activity size={20} />
            <h3 className="font-medium">Running Servers</h3>
          </div>
          <p className="text-4xl font-bold text-white">{runningServers.length}</p>
        </div>
      </div>

      {/* Performance Graphs for running servers */}
      {runningServers.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Cpu size={18} className="text-blue-400" />
            Performance Monitor
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {runningServers.map(server => {
              const ticks = serverStats[server.id!] || [];
              return (
                <div
                  key={server.id}
                  className="bg-[#1c1d21] border border-[#2a2b2f] rounded-lg p-5 cursor-pointer hover:border-gray-600 transition-colors"
                  onClick={() => { setSelectedServer(server.id || null); navigate('/console'); }}
                >
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <h3 className="font-bold text-white">{server.name}</h3>
                      <p className="text-xs text-gray-500">{server.minecraft_version} · {server.server_type}</p>
                    </div>
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-500/10 text-emerald-400">
                      {server.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex gap-6">
                    <MiniChart data={ticks} color="blue" label="CPU" maxVal={100} />
                    <MiniChart data={ticks} color="emerald" label="RAM" maxVal={server.ram_max} />
                  </div>
                  {ticks.length === 0 && (
                    <p className="text-xs text-gray-600 mt-2 text-center">
                      Collecting metrics... (updates every 2s)
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
