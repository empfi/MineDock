import type { LucideIcon } from 'lucide-react';

type Props = {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
};

export default function EmptyState({ icon: Icon, title, description, action, onAction }: Props) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed border-[#34353a] bg-[#18191c] px-6 py-10 text-center">
      <div className="mb-4 rounded-lg bg-[#25262a] p-3 text-gray-400"><Icon size={22} /></div>
      <h2 className="font-semibold text-white">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-gray-500">{description}</p>
      {action && onAction && <button onClick={onAction} className="action-button mt-5 bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">{action}</button>}
    </div>
  );
}
