import type { ItemStatus } from '@/types/furniture';

const statusStyles: Record<ItemStatus, string> = {
  Idea: 'bg-muted text-muted-foreground',
  Shortlist: 'bg-info/15 text-info',
  Selected: 'bg-primary/15 text-primary',
  Ordered: 'bg-warning/15 text-warning',
  Delivered: 'bg-accent text-accent-foreground',
  Installed: 'bg-success/15 text-success',
};

interface StatusChipProps {
  status: ItemStatus;
  selected?: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md';
}

export function StatusChip({ status, selected, onClick, size = 'md' }: StatusChipProps) {
  const base = statusStyles[status];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-full font-medium transition-all duration-150 ${
        size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3.5 py-1.5 text-sm'
      } ${base} ${
        selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''
      } ${onClick ? 'cursor-pointer active:scale-95' : 'cursor-default'}`}
    >
      {status}
    </button>
  );
}
