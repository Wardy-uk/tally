import { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { Login } from './components/Login';
import { Sidebar, type View } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { AccountsView } from './components/AccountsView';
import { ImportView } from './components/ImportView';
import { TransactionsView } from './components/TransactionsView';
import { RulesView } from './components/RulesView';
import { SettingsView } from './components/SettingsView';
import { SubscriptionsView } from './components/SubscriptionsView';
import { BudgetsView } from './components/BudgetsView';
import { InsightsView } from './components/InsightsView';
import { ChatView } from './components/ChatView';
import { ReceiptsView } from './components/ReceiptsView';
import { Placeholder } from './components/Placeholder';

export function App() {
  const { user, loading, hasUsers, login, register, logout } = useAuth();
  const [view, setView] = useState<View>('dashboard');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-[var(--color-text-3)]">Loading…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <Login
        hasUsers={hasUsers ?? false}
        onLogin={login}
        onRegister={register}
      />
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar view={view} onNavigate={setView} user={user} onLogout={logout} />
      <main className="flex-1 p-8 max-w-[1400px]">
        {view === 'dashboard' && <Dashboard />}
        {view === 'transactions' && <TransactionsView />}
        {view === 'accounts' && <AccountsView user={user} />}
        {view === 'import' && <ImportView />}
        {view === 'rules' && <RulesView />}
        {view === 'budgets' && <BudgetsView />}
        {view === 'insights' && <InsightsView />}
        {view === 'chat' && <ChatView />}
        {view === 'subscriptions' && <SubscriptionsView />}
        {view === 'receipts' && <ReceiptsView />}
        {view === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}
