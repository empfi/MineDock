import { Loader2 } from 'lucide-react';

export function InlineSpinner({ label = 'Loading' }: { label?: string }) {
  return <span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" />{label}</span>;
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return <div className="animate-pulse divide-y divide-[#2a2b2f]" aria-label="Loading">
    {Array.from({ length: rows }).map((_, index) => <div key={index} className="flex h-16 items-center gap-8 px-6"><div className="h-3 flex-1 rounded bg-[#303136]" /><div className="h-3 w-24 rounded bg-[#292a2f]" /><div className="h-3 w-20 rounded bg-[#292a2f]" /></div>)}
  </div>;
}

export function LogSkeleton() {
  return (
    <div className="animate-pulse space-y-2.5 p-4 font-mono">
      <div className="h-3.5 w-3/4 rounded bg-[#2a2b2f]" />
      <div className="h-3.5 w-1/2 rounded bg-[#2a2b2f]" />
      <div className="h-3.5 w-5/6 rounded bg-[#2a2b2f]" />
      <div className="h-3.5 w-2/3 rounded bg-[#2a2b2f]" />
      <div className="h-3.5 w-4/5 rounded bg-[#2a2b2f]" />
    </div>
  );
}

export function WorldsSkeleton() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 animate-pulse">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="rounded-lg border border-[#2a2b2f] bg-[#1c1d21] p-5 h-[116px] flex flex-col justify-between">
          <div className="flex gap-3">
            <div className="h-10 w-10 rounded bg-[#2a2b2f]" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-4 w-1/3 rounded bg-[#2a2b2f]" />
              <div className="h-3.5 w-1/2 rounded bg-[#2a2b2f]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ModalVersionsSkeleton() {
  return (
    <div className="animate-pulse divide-y divide-[#27282c]">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="flex items-center justify-between px-4 py-4">
          <div className="h-3.5 w-28 rounded bg-[#2a2b2f]" />
          <div className="h-3 w-16 rounded bg-[#2a2b2f]" />
        </div>
      ))}
    </div>
  );
}
