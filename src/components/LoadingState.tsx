import { Loader2 } from 'lucide-react';

export function InlineSpinner({ label = 'Loading' }: { label?: string }) {
  return <span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" />{label}</span>;
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return <div className="animate-pulse divide-y divide-[#2a2b2f]" aria-label="Loading">
    {Array.from({ length: rows }).map((_, index) => <div key={index} className="flex h-16 items-center gap-8 px-6"><div className="h-3 flex-1 rounded bg-[#303136]" /><div className="h-3 w-24 rounded bg-[#292a2f]" /><div className="h-3 w-20 rounded bg-[#292a2f]" /></div>)}
  </div>;
}
