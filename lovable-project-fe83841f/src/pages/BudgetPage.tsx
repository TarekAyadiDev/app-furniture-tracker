import { PageHeader } from '@/components/PageHeader';
import { useFurnitureStore } from '@/hooks/useFurnitureStore';
import type { ItemStatus } from '@/types/furniture';

const STATUS_ORDER: ItemStatus[] = ['Installed', 'Delivered', 'Ordered', 'Selected', 'Shortlist', 'Idea'];

export default function BudgetPage() {
  const { items, totalSpent, totalItems } = useFurnitureStore();

  const byStatus = STATUS_ORDER.map(status => {
    const statusItems = items.filter(i => i.status === status);
    const total = statusItems.reduce((s, i) => s + (i.price || 0) * i.quantity, 0);
    return { status, count: statusItems.length, total };
  }).filter(g => g.count > 0);

  return (
    <div className="pb-24">
      <PageHeader subtitle="Spending overview" title="Budget" />

      <div className="mx-4 mt-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total estimate</p>
        <p className="mt-1 font-heading text-4xl text-foreground">${totalSpent.toLocaleString()}</p>
        <p className="mt-1 text-sm text-muted-foreground">{totalItems} item{totalItems !== 1 ? 's' : ''} tracked</p>
      </div>

      {byStatus.length > 0 && (
        <div className="mx-4 mt-6 space-y-3">
          <h2 className="font-heading text-lg text-foreground">By Status</h2>
          {byStatus.map(({ status, count, total }) => (
            <div key={status} className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
              <div>
                <p className="text-sm font-medium text-card-foreground">{status}</p>
                <p className="text-xs text-muted-foreground">{count} item{count !== 1 ? 's' : ''}</p>
              </div>
              <p className="font-body text-base font-bold text-foreground">${total.toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
