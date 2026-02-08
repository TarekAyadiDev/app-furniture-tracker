import { useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { ItemCard } from '@/components/ItemCard';
import { StatusChip } from '@/components/StatusChip';
import { useFurnitureStore } from '@/hooks/useFurnitureStore';
import type { ItemStatus } from '@/types/furniture';
import { Search } from 'lucide-react';

const ALL_STATUSES: ItemStatus[] = ['Idea', 'Shortlist', 'Selected', 'Ordered', 'Delivered', 'Installed'];

export default function ItemsPage() {
  const { items, deleteItem, updateItem } = useFurnitureStore();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<ItemStatus | null>(null);

  const filtered = items.filter(i => {
    if (filterStatus && i.status !== filterStatus) return false;
    if (search && !i.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="pb-24">
      <PageHeader subtitle="All furniture" title="Items" />

      <div className="mx-4 mt-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search items..."
            className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="mx-4 mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <button
          onClick={() => setFilterStatus(null)}
          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
            !filterStatus ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          All ({items.length})
        </button>
        {ALL_STATUSES.map(s => {
          const count = items.filter(i => i.status === s).length;
          if (count === 0) return null;
          return (
            <StatusChip
              key={s}
              status={s}
              size="sm"
              selected={filterStatus === s}
              onClick={() => setFilterStatus(filterStatus === s ? null : s)}
            />
          );
        })}
      </div>

      <div className="mx-4 mt-4 space-y-3">
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {items.length === 0 ? 'No items yet. Add your first one in Shop!' : 'No matching items.'}
          </p>
        ) : (
          filtered.map(item => (
            <ItemCard key={item.id} item={item} onDelete={deleteItem} />
          ))
        )}
      </div>
    </div>
  );
}
