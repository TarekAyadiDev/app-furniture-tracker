import { useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { StatusChip } from '@/components/StatusChip';
import { ItemCard } from '@/components/ItemCard';
import type { RoomName, ItemStatus, FurnitureItem } from '@/types/furniture';
import { useFurnitureStore } from '@/hooks/useFurnitureStore';
import { Plus } from 'lucide-react';

const ROOMS: RoomName[] = ['Living', 'Dining', 'Master', 'Bedroom2', 'Balcony', 'Entry', 'Kitchen', 'Bath'];
const STATUSES: ItemStatus[] = ['Idea', 'Shortlist', 'Selected'];

export default function ShopPage() {
  const { items, addItem, deleteItem } = useFurnitureStore();
  const [title, setTitle] = useState('');
  const [room, setRoom] = useState<RoomName>('Living');
  const [price, setPrice] = useState('');
  const [status, setStatus] = useState<ItemStatus>('Shortlist');
  const [store, setStore] = useState('');
  const [notes, setNotes] = useState('');

  const handleAdd = () => {
    if (!title.trim()) return;
    addItem({
      title: title.trim(),
      room,
      status,
      price: price ? parseFloat(price) : undefined,
      store: store.trim() || undefined,
      notes: notes.trim() || undefined,
      quantity: 1,
    });
    setTitle('');
    setPrice('');
    setStore('');
    setNotes('');
  };

  const recent = items.slice(0, 5);

  return (
    <div className="pb-24">
      <PageHeader subtitle="2B Furnishing" title="Shopping Mode" />

      <div className="mx-4 mt-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quick add</label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Queen mattress protector"
          className="mt-1.5 w-full rounded-xl border border-input bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Room</label>
            <select
              value={room}
              onChange={e => setRoom(e.target.value as RoomName)}
              className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {ROOMS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Price</label>
            <div className="relative mt-1.5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <input
                type="number"
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder="0"
                className="w-full rounded-xl border border-input bg-background py-3 pl-7 pr-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        </div>

        <div className="mt-4">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {STATUSES.map(s => (
              <StatusChip key={s} status={s} selected={status === s} onClick={() => setStatus(s)} />
            ))}
          </div>
        </div>

        <div className="mt-4">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Store (optional)</label>
          <input
            type="text"
            value={store}
            onChange={e => setStore(e.target.value)}
            placeholder="IKEA, Target, Article..."
            className="mt-1.5 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="mt-4">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Material, size, color, delivery notes..."
            rows={2}
            className="mt-1.5 w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <button
          onClick={handleAdd}
          disabled={!title.trim()}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
          Add Item
        </button>
      </div>

      {recent.length > 0 && (
        <div className="mx-4 mt-6">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-lg text-foreground">Recent</h2>
            <span className="text-xs text-muted-foreground">{items.length} total</span>
          </div>
          <div className="mt-3 space-y-3">
            {recent.map(item => (
              <ItemCard key={item.id} item={item} onDelete={deleteItem} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
