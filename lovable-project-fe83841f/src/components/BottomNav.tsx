import { NavLink, useLocation } from 'react-router-dom';
import { ShoppingBag, List, LayoutGrid, DollarSign, Settings } from 'lucide-react';

const tabs = [
  { to: '/', icon: ShoppingBag, label: 'Shop' },
  { to: '/items', icon: List, label: 'Items' },
  { to: '/rooms', icon: LayoutGrid, label: 'Rooms' },
  { to: '/budget', icon: DollarSign, label: 'Budget' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function BottomNav() {
  const location = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur-lg safe-bottom">
      <div className="mx-auto flex max-w-lg items-center justify-around px-2 py-1">
        {tabs.map(({ to, icon: Icon, label }) => {
          const isActive = location.pathname === to;
          return (
            <NavLink
              key={to}
              to={to}
              className={`flex flex-col items-center gap-0.5 rounded-xl px-3 py-2 text-xs font-medium transition-all duration-200 ${
                isActive
                  ? 'text-primary scale-105'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className={`h-5 w-5 transition-all duration-200 ${isActive ? 'stroke-[2.5]' : ''}`} />
              <span>{label}</span>
              {isActive && (
                <span className="mt-0.5 h-1 w-1 rounded-full bg-primary" />
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
