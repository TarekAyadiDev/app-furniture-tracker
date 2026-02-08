import { PageHeader } from '@/components/PageHeader';
import { useFurnitureStore } from '@/hooks/useFurnitureStore';
import { Download, Upload, Trash2, Database } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';

export default function SettingsPage() {
  const { items } = useFurnitureStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify({ items, exportedAt: new Date().toISOString() }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `furniture-tracker-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Data exported!');
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (data.items) {
          localStorage.setItem('furniture-tracker-items', JSON.stringify(data.items));
          toast.success('Data imported! Refresh to see changes.');
        }
      } catch {
        toast.error('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  };

  const handleClear = () => {
    if (confirm('Delete all items? This cannot be undone.')) {
      localStorage.removeItem('furniture-tracker-items');
      toast.success('All data cleared. Refresh to reset.');
      window.location.reload();
    }
  };

  return (
    <div className="pb-24">
      <PageHeader subtitle="Configuration" title="Settings" />

      <div className="mx-4 mt-4 space-y-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-card-foreground">Local Storage</p>
              <p className="text-xs text-muted-foreground">{items.length} items stored offline</p>
            </div>
          </div>
        </div>

        <button
          onClick={handleExport}
          className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-all hover:shadow-sm active:scale-[0.98]"
        >
          <div className="rounded-xl bg-success/10 p-2.5 text-success">
            <Download className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-card-foreground">Export Data</p>
            <p className="text-xs text-muted-foreground">Download JSON backup</p>
          </div>
        </button>

        <button
          onClick={() => fileRef.current?.click()}
          className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-all hover:shadow-sm active:scale-[0.98]"
        >
          <div className="rounded-xl bg-info/10 p-2.5 text-info">
            <Upload className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-card-foreground">Import Data</p>
            <p className="text-xs text-muted-foreground">Load JSON backup</p>
          </div>
        </button>
        <input ref={fileRef} type="file" accept=".json" onChange={handleImport} className="hidden" />

        <button
          onClick={handleClear}
          className="flex w-full items-center gap-3 rounded-2xl border border-destructive/20 bg-card p-4 text-left transition-all hover:shadow-sm active:scale-[0.98]"
        >
          <div className="rounded-xl bg-destructive/10 p-2.5 text-destructive">
            <Trash2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-destructive">Clear All Data</p>
            <p className="text-xs text-muted-foreground">Delete everything permanently</p>
          </div>
        </button>
      </div>
    </div>
  );
}
