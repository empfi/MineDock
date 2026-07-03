import { AlertCircle, ChevronDown } from 'lucide-react';

type Action = { label: string; onClick: () => void };
type Props = {
  title: string;
  description: string;
  details?: string;
  primaryAction?: Action;
  secondaryAction?: Action;
  compact?: boolean;
};

export default function ErrorState({ title, description, details, primaryAction, secondaryAction, compact }: Props) {
  return (
    <div className={`rounded-lg border border-red-500/20 bg-red-500/5 text-center ${compact ? 'p-4' : 'px-6 py-10'}`}>
      <AlertCircle className="mx-auto text-red-400" size={compact ? 20 : 24} />
      <h2 className="mt-3 font-semibold text-white">{title}</h2>
      <p className="mx-auto mt-1 max-w-lg text-sm text-gray-400">{description}</p>
      {details && <details className="mx-auto mt-3 max-w-lg text-left text-xs text-gray-500"><summary className="flex cursor-pointer items-center justify-center gap-1"><ChevronDown size={12} /> Details</summary><pre className="mt-2 whitespace-pre-wrap select-text rounded bg-[#0f0f11] p-3">{details}</pre></details>}
      {(primaryAction || secondaryAction) && <div className="mt-4 flex justify-center gap-2">
        {secondaryAction && <button onClick={secondaryAction.onClick} className="action-button bg-[#2a2b2f] px-4 text-sm text-gray-200">{secondaryAction.label}</button>}
        {primaryAction && <button onClick={primaryAction.onClick} className="action-button bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700">{primaryAction.label}</button>}
      </div>}
    </div>
  );
}
