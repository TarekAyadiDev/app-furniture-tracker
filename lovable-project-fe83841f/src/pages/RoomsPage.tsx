import { PageHeader } from '@/components/PageHeader';
import { useFurnitureStore } from '@/hooks/useFurnitureStore';
import type { RoomName } from '@/types/furniture';
import { Sofa, UtensilsCrossed, Bed, BedDouble, Sun, DoorOpen, ChefHat, Bath } from 'lucide-react';

const ROOM_CONFIG: { name: RoomName; icon: typeof Sofa; color: string }[] = [
  { name: 'Living', icon: Sofa, color: 'bg-primary/10 text-primary' },
  { name: 'Dining', icon: UtensilsCrossed, color: 'bg-warning/10 text-warning' },
  { name: 'Master', icon: BedDouble, color: 'bg-info/10 text-info' },
  { name: 'Bedroom2', icon: Bed, color: 'bg-accent text-accent-foreground' },
  { name: 'Balcony', icon: Sun, color: 'bg-success/10 text-success' },
  { name: 'Entry', icon: DoorOpen, color: 'bg-muted text-muted-foreground' },
  { name: 'Kitchen', icon: ChefHat, color: 'bg-destructive/10 text-destructive' },
  { name: 'Bath', icon: Bath, color: 'bg-info/10 text-info' },
];

export default function RoomsPage() {
  const { getByRoom } = useFurnitureStore();

  return (
    <div className="pb-24">
      <PageHeader subtitle="By location" title="Rooms" />

      <div className="mx-4 mt-4 grid grid-cols-2 gap-3">
        {ROOM_CONFIG.map(({ name, icon: Icon, color }) => {
          const roomItems = getByRoom(name);
          const total = roomItems.reduce((s, i) => s + (i.price || 0) * i.quantity, 0);
          return (
            <div
              key={name}
              className="rounded-2xl border border-border bg-card p-4 transition-all duration-200 hover:shadow-md active:scale-[0.97]"
            >
              <div className={`inline-flex rounded-xl p-2.5 ${color}`}>
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-3 font-heading text-base text-card-foreground">{name}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {roomItems.length} item{roomItems.length !== 1 ? 's' : ''}
              </p>
              {total > 0 && (
                <p className="mt-1 text-sm font-semibold text-foreground">${total.toLocaleString()}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
