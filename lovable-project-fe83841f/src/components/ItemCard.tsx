import type { FurnitureItem } from '@/types/furniture';
import { StatusChip } from './StatusChip';
import { MapPin, ExternalLink, Trash2 } from 'lucide-react';

interface ItemCardProps {
  item: FurnitureItem;
  onDelete?: (id: string) => void;
  onStatusChange?: (id: string, status: FurnitureItem['status']) => void;
}

export function ItemCard({ item, onDelete, onStatusChange }: ItemCardProps) {
  return (
    <div className="group rounded-2xl border border-border bg-card p-4 transition-all duration-200 hover:shadow-md active:scale-[0.98]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-body text-base font-semibold text-card-foreground">
            {item.title}
          </h3>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            <span>{item.room}</span>
            {item.store && (
              <>
                <span className="text-border">·</span>
                <span>{item.store}</span>
              </>
            )}
          </div>
        </div>
        {item.price != null && item.price > 0 && (
          <span className="shrink-0 font-body text-lg font-bold text-foreground">
            ${item.price.toLocaleString()}
          </span>
        )}
      </div>

      {item.notes && (
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{item.notes}</p>
      )}

      <div className="mt-3 flex items-center justify-between">
        <StatusChip status={item.status} size="sm" />
        <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          {item.link && (
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(item.id)}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
