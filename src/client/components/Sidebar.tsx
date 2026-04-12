import {
  LayoutDashboard, ArrowLeftRight, Wallet, Upload, PieChart,
  Sparkles, Repeat, Receipt, Settings, LogOut, MessageSquare, Zap, RefreshCw,
} from 'lucide-react';
import type { AuthUser } from '../../shared/types';

export type View =
  | 'dashboard' | 'transactions' | 'accounts' | 'import' | 'rules' | 'budgets'
  | 'insights' | 'subscriptions' | 'receipts' | 'chat' | 'settings';

interface Props {
  view: View;
  onNavigate: (v: View) => void;
  user: AuthUser;
  onLogout: () => void;
}

const NAV: Array<{ id: View; label: string; icon: React.FC<{ className?: string }>; group: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'main' },
  { id: 'transactions', label: 'Transactions', icon: ArrowLeftRight, group: 'main' },
  { id: 'accounts', label: 'Accounts', icon: Wallet, group: 'main' },
  { id: 'import', label: 'Import', icon: Upload, group: 'main' },
  { id: 'rules', label: 'Rules', icon: Zap, group: 'main' },
  { id: 'budgets', label: 'Budgets', icon: PieChart, group: 'analysis' },
  { id: 'insights', label: 'AI Insights', icon: Sparkles, group: 'analysis' },
  { id: 'chat', label: 'Ask Tally', icon: MessageSquare, group: 'analysis' },
  { id: 'subscriptions', label: 'Subscriptions', icon: Repeat, group: 'analysis' },
  { id: 'receipts', label: 'Receipts', icon: Receipt, group: 'analysis' },
  { id: 'settings', label: 'Settings', icon: Settings, group: 'system' },
];

export function Sidebar({ view, onNavigate, user, onLogout }: Props) {
  const groups = {
    main: NAV.filter(n => n.group === 'main'),
    analysis: NAV.filter(n => n.group === 'analysis'),
    system: NAV.filter(n => n.group === 'system'),
  };

  return (
    <aside className="w-[240px] shrink-0 bg-[var(--color-surface)] border-r border-[var(--color-border)] flex flex-col h-screen sticky top-0">
      <div className="p-5 flex items-center gap-3 border-b border-[var(--color-border)]">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--color-mint)] to-[var(--color-violet)] flex items-center justify-center shadow-[0_0_24px_rgba(74,222,128,0.3)]">
          <Wallet className="w-5 h-5 text-[#04140a]" strokeWidth={2.5} />
        </div>
        <div>
          <div className="text-base font-extrabold tracking-tight">Tally</div>
          <div className="text-[10px] text-[var(--color-text-4)] uppercase tracking-wider">v{__APP_VERSION__}</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 flex flex-col gap-5">
        <NavGroup title="Main" items={groups.main} view={view} onNavigate={onNavigate} />
        <NavGroup title="Analysis" items={groups.analysis} view={view} onNavigate={onNavigate} />
        <NavGroup title="System" items={groups.system} view={view} onNavigate={onNavigate} />
      </nav>

      <div className="p-3 border-t border-[var(--color-border)] flex flex-col gap-2">
        <button
          onClick={() => window.location.reload()}
          className="flex items-center justify-center gap-2 h-9 rounded-xl bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-xs font-semibold text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-mint)] hover:border-[rgba(74,222,128,0.3)] transition"
          title="Refresh data (reload app)"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>

        <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-[var(--color-bg-elevated)]">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--color-violet)] to-[var(--color-sky)] flex items-center justify-center text-xs font-bold text-white">
            {user.displayName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">{user.displayName}</div>
            <div className="text-[10px] text-[var(--color-text-4)] uppercase tracking-wider">{user.role}</div>
          </div>
          <button
            onClick={onLogout}
            className="w-8 h-8 rounded-lg text-[var(--color-text-3)] hover:text-[var(--color-coral)] hover:bg-[var(--color-coral-soft)] transition flex items-center justify-center"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function NavGroup({
  title, items, view, onNavigate,
}: {
  title: string;
  items: typeof NAV;
  view: View;
  onNavigate: (v: View) => void;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-[var(--color-text-4)] uppercase tracking-wider px-3 mb-1.5">
        {title}
      </div>
      <div className="flex flex-col gap-0.5">
        {items.map(item => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`flex items-center gap-3 px-3 py-2 rounded-[10px] text-sm font-medium transition-all ${
                active
                  ? 'bg-[var(--color-mint-soft)] text-[var(--color-mint)] shadow-[inset_0_0_0_1px_rgba(74,222,128,0.2)]'
                  : 'text-[var(--color-text-2)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text)]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
