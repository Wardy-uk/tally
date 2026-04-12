import { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { useUsers } from './hooks/useUsers';
import { Login } from './components/Login';
import { Sidebar, type View } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { AccountsView } from './components/AccountsView';
import { ImportView } from './components/ImportView';
import { TransactionsView } from './components/TransactionsView';
import { RulesView } from './components/RulesView';
import { SettingsView } from './components/SettingsView';
import { SubscriptionsView } from './components/SubscriptionsView';
import { Placeholder } from './components/Placeholder';

export function App() {
  const { user, loading, hasUsers, login, register, logout } = useAuth();
  const [view, setView] = useState<View>('dashboard');
  const allUsers = useUsers();

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
        {view === 'accounts' && <AccountsView user={user} allUsers={allUsers} />}
        {view === 'import' && <ImportView />}
        {view === 'rules' && <RulesView />}
        {view === 'budgets' && <Placeholder title="Budgets" description="AI-suggested and manual budgets per category" />}
        {view === 'insights' && <Placeholder title="AI Insights" description="Monthly spending analysis and advice" />}
        {view === 'chat' && <Placeholder title="Ask Tally" description="Chat about your finances" />}
        {view === 'subscriptions' && <SubscriptionsView />}
        {view === 'receipts' && <Placeholder title="Receipts" description="Upload and match receipts to transactions" />}
        {view === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}
