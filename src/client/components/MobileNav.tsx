import { useEffect, useState } from 'react';
import { LogOut, MoreHorizontal, RefreshCw, Wallet, X } from 'lucide-react';
import type { AuthUser } from '../../shared/types';
import { NAV, type View } from './Sidebar';
import { BUILD_LABEL, hardRefresh } from '../lib/hard-refresh';

/** Views that get a slot in the bottom tab bar; everything else lives under "More". */
const TABS: View[] = ['dashboard', 'transactions', 'budgets', 'chat'];

interface Props {
  view: View;
  onNavigate: (v: View) => void;
  user: AuthUser;
  onLogout: () => void;
}

/** Phone chrome (below md): safe-area top bar, bottom tab bar, and a "More" sheet. */
export function MobileNav({ view, onNavigate, user, onLogout }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const current = NAV.find(n => n.id === view);

  useEffect(() => {
    document.body.style.overflow = moreOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [moreOpen]);

  function go(v: View) {
    onNavigate(v);
    setMoreOpen(false);
    window.scrollTo({ top: 0 });
  }

  function refresh() {
    setRefreshing(true);
    hardRefresh();
  }

  return (
    <div className="md:hidden">
      <header
        className="fixed top-0 inset-x-0 z-30 bg-[var(--color-surface)]/90 backdrop-blur-xl border-b border-[var(--color-border)]"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="h-14 px-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--color-mint)] to-[var(--color-violet)] flex items-center justify-center shrink-0">
            <Wallet className="w-4 h-4 text-[#04140a]" strokeWidth={2.5} />
          </div>
          <div className="flex-1 min-w-0 text-base font-bold truncate">{current?.label ?? 'Tally'}</div>
          <button
            onClick={refresh}
            disabled={refreshing}
            aria-label="Hard refresh"
            className="w-10 h-10 -mr-2 rounded-xl flex items-center justify-center text-[var(--color-text-2)] active:bg-[var(--color-bg-elevated)]"
          >
            <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin text-[var(--color-mint)]' : ''}`} />
          </button>
        </div>
      </header>

      <nav
        className="fixed bottom-0 inset-x-0 z-30 bg-[var(--color-surface)]/95 backdrop-blur-xl border-t border-[var(--color-border)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="grid grid-cols-5 h-16">
          {TABS.map(id => {
            const item = NAV.find(n => n.id === id)!;
            const Icon = item.icon;
            const active = view === id;
            return (
              <button
                key={id}
                onClick={() => go(id)}
                className={`flex flex-col items-center justify-center gap-1 text-[10px] font-semibold ${active ? 'text-[var(--color-mint)]' : 'text-[var(--color-text-3)]'}`}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </button>
            );
          })}
          <button
            onClick={() => setMoreOpen(true)}
            className={`flex flex-col items-center justify-center gap-1 text-[10px] font-semibold ${!TABS.includes(view) ? 'text-[var(--color-mint)]' : 'text-[var(--color-text-3)]'}`}
          >
            <MoreHorizontal className="w-5 h-5" />
            More
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMoreOpen(false)} />
          <div
            className="absolute bottom-0 inset-x-0 bg-[var(--color-surface)] border-t border-[var(--color-border)] rounded-t-[24px] max-h-[85vh] overflow-y-auto fade-up"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <div className="text-sm font-bold">All sections</div>
              <button onClick={() => setMoreOpen(false)} aria-label="Close" className="w-9 h-9 -mr-2 rounded-xl flex items-center justify-center text-[var(--color-text-3)]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 px-4">
              {NAV.map(item => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => go(item.id)}
                    className={`flex flex-col items-center justify-center gap-2 h-20 rounded-2xl text-xs font-medium border ${
                      active
                        ? 'bg-[var(--color-mint-soft)] text-[var(--color-mint)] border-[rgba(74,222,128,0.25)]'
                        : 'bg-[var(--color-bg-elevated)] text-[var(--color-text-2)] border-[var(--color-border)]'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    {item.label}
                  </button>
                );
              })}
            </div>
            <div className="mx-4 mt-4 flex items-center gap-3 px-3 py-3 rounded-2xl bg-[var(--color-bg-elevated)]">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--color-violet)] to-[var(--color-sky)] flex items-center justify-center text-sm font-bold text-white shrink-0">
                {user.displayName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{user.displayName}</div>
                <div className="text-[10px] text-[var(--color-text-4)] tracking-wider">{BUILD_LABEL}</div>
              </div>
              <button onClick={refresh} aria-label="Hard refresh" className="h-9 px-3 rounded-lg text-xs font-semibold text-[var(--color-text-2)] border border-[var(--color-border)] flex items-center gap-1.5">
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
              </button>
              <button onClick={onLogout} aria-label="Sign out" className="w-9 h-9 rounded-lg text-[var(--color-text-3)] flex items-center justify-center">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
