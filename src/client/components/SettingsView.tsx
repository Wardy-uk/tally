import { useCallback, useEffect, useState } from 'react';
import {
  Key, Sparkles, CheckCircle2, XCircle, Save, Briefcase, Building2,
  Link2, Unlink, RefreshCw, Database, Download, Users, UserPlus, Trash2, Shield, Lock,
} from 'lucide-react';
import { Modal } from './ui/Modal';
import { Card, CardHeader, CardTitle } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { api, getToken } from '../lib/api';
import { useAccounts } from '../hooks/useAccounts';

type PayDayType = 'day' | 'last-working' | 'working-before';

interface SalaryEntry {
  userId: number;
  username: string;
  displayName: string;
  profile: {
    id: number;
    baseSalaryMonthly: number;
    payDay: number;
    payDayType: PayDayType;
    accountId: number | null;
    effectiveFrom: string;
  } | null;
}

export function SettingsView() {
  const [allSettings, setAllSettings] = useState<Record<string, any>>({});
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [aiStatus, setAiStatus] = useState<{ configured: boolean } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await api<Record<string, any>>('/settings/all');
        setAllSettings(s);
        if (s.openai_api_key) setApiKey(String(s.openai_api_key));
        if (s.openai_model) setModel(String(s.openai_model));
      } catch {}
      try {
        const status = await api<{ configured: boolean }>('/ai/status');
        setAiStatus(status);
      } catch {}
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      if (apiKey !== (allSettings.openai_api_key ?? '')) {
        await api('/settings/openai_api_key', { method: 'PUT', body: JSON.stringify({ value: apiKey }) });
      }
      if (model !== (allSettings.openai_model ?? 'gpt-4o-mini')) {
        await api('/settings/openai_model', { method: 'PUT', body: JSON.stringify({ value: model }) });
      }
      const status = await api<{ configured: boolean }>('/ai/status');
      setAiStatus(status);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  }

  return (
    <div className="flex flex-col gap-6 fade-up max-w-3xl">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Settings</h1>
        <p className="text-sm text-[var(--color-text-3)] mt-1">
          API keys, integrations and preferences
        </p>
      </div>

      <Card padding="lg">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--color-violet-soft)] text-[var(--color-violet)] flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <CardTitle subtitle="For categorisation, monthly insights and the chat assistant">
              OpenAI
            </CardTitle>
          </div>
        </CardHeader>

        <div className="flex flex-col gap-4">
          <Input
            label="API key"
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            icon={<Key className="w-4 h-4" />}
            placeholder="sk-…"
            hint="Stored in settings.json on the Pi, never sent to the browser"
          />
          <Select
            label="Model"
            value={model}
            onChange={e => setModel(e.target.value)}
            options={[
              { value: 'gpt-4o-mini', label: 'gpt-4o-mini (fast, cheap — recommended)' },
              { value: 'gpt-4o', label: 'gpt-4o (smarter, pricier)' },
              { value: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
              { value: 'gpt-4.1', label: 'gpt-4.1' },
            ]}
          />

          {aiStatus && (
            <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-[10px] border ${
              aiStatus.configured
                ? 'bg-[var(--color-mint-soft)] border-[rgba(74,222,128,0.25)] text-[var(--color-mint)]'
                : 'bg-[var(--color-amber-soft)] border-[rgba(251,191,36,0.25)] text-[var(--color-amber)]'
            }`}>
              {aiStatus.configured
                ? <><CheckCircle2 className="w-3.5 h-3.5" /> OpenAI is connected</>
                : <><XCircle className="w-3.5 h-3.5" /> No API key set — AI features disabled</>
              }
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={save} disabled={saving} icon={<Save className="w-4 h-4" />}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            {saved && <span className="text-sm text-[var(--color-mint)]">Saved</span>}
          </div>
        </div>
      </Card>

      <UsersSection />
      <SalarySection />
      <TrueLayerSection />
      <BackupSection />
    </div>
  );
}

// ===== Users Section =====

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: 'admin' | 'user';
  created_at: string;
}

function UsersSection() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await api<UserRow[]>('/auth/users'));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function del(u: UserRow) {
    if (!confirm(`Delete ${u.display_name}? This cannot be undone.`)) return;
    try {
      await api(`/auth/users/${u.id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setError(e.error ?? 'Delete failed');
      setTimeout(() => setError(null), 4000);
    }
  }

  async function toggleRole(u: UserRow) {
    const newRole = u.role === 'admin' ? 'user' : 'admin';
    await api(`/auth/users/${u.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ displayName: u.display_name, role: newRole }),
    });
    await load();
  }

  return (
    <Card padding="lg">
      <CardHeader>
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--color-sky-soft)] text-[var(--color-sky)] flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <CardTitle subtitle="Add family members or other admins">Users</CardTitle>
          </div>
          <Button variant="primary" size="sm" icon={<UserPlus className="w-4 h-4" />} onClick={() => setAdding(true)}>
            Add user
          </Button>
        </div>
      </CardHeader>

      {error && (
        <div className="mb-4 text-xs px-3 py-2 rounded-[10px] bg-[var(--color-coral-soft)] border border-[rgba(251,113,133,0.25)] text-[var(--color-coral)]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-[var(--color-text-3)]">Loading…</div>
      ) : (
        <div className="flex flex-col gap-2">
          {users.map(u => (
            <div key={u.id} className="flex items-center gap-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[14px] p-4 group">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[var(--color-violet)] to-[var(--color-sky)] flex items-center justify-center text-sm font-bold text-white shrink-0">
                {u.display_name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{u.display_name}</div>
                <div className="text-xs text-[var(--color-text-3)] flex items-center gap-2">
                  <span>@{u.username}</span>
                  <span>·</span>
                  <button
                    onClick={() => toggleRole(u)}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[10px] uppercase tracking-wider font-semibold transition ${
                      u.role === 'admin'
                        ? 'bg-[var(--color-mint-soft)] text-[var(--color-mint)] hover:brightness-110'
                        : 'bg-[var(--color-surface)] text-[var(--color-text-3)] hover:text-[var(--color-text)]'
                    }`}
                    title="Click to toggle role"
                  >
                    {u.role === 'admin' && <Shield className="w-2.5 h-2.5" />}
                    {u.role}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                <button
                  onClick={() => setResetting(u)}
                  className="w-8 h-8 rounded-lg hover:bg-[var(--color-bg-elevated)] text-[var(--color-text-3)] hover:text-[var(--color-amber)] flex items-center justify-center"
                  title="Reset password"
                >
                  <Lock className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => del(u)}
                  className="w-8 h-8 rounded-lg hover:bg-[var(--color-coral-soft)] text-[var(--color-text-3)] hover:text-[var(--color-coral)] flex items-center justify-center"
                  title="Delete user"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddUserModal open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />
      <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />
    </Card>
  );
}

function AddUserModal({
  open, onClose, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when the modal opens
  useEffect(() => {
    if (open) {
      setUsername(''); setDisplayName(''); setPassword(''); setRole('user'); setError(null);
    }
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/users', {
        method: 'POST',
        body: JSON.stringify({ username, displayName, password, role }),
      });
      onSaved();
    } catch (e: any) {
      setError(e.error ?? 'Failed to create user');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add user"
      subtitle="Create a login for a family member or another admin"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!username || !password || password.length < 6 || busy}
          >
            {busy ? 'Creating…' : 'Create user'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Display name"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder="e.g. Sarah"
          autoFocus
        />
        <Input
          label="Username"
          value={username}
          onChange={e => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
          placeholder="sarah"
          hint="Lowercase, no spaces — used to sign in"
        />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="At least 6 characters"
          hint="They can change it after signing in"
        />
        <Select
          label="Role"
          value={role}
          onChange={e => setRole(e.target.value as 'user' | 'admin')}
          options={[
            { value: 'user', label: 'User — can view and edit' },
            { value: 'admin', label: 'Admin — full access including settings' },
          ]}
        />
        {error && (
          <div className="text-sm text-[var(--color-coral)] bg-[var(--color-coral-soft)] border border-[rgba(251,113,133,0.2)] rounded-[12px] px-3 py-2">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ResetPasswordModal({
  user, onClose,
}: {
  user: UserRow | null;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (user) { setPassword(''); setDone(false); }
  }, [user]);

  async function submit() {
    if (!user) return;
    setBusy(true);
    try {
      await api(`/auth/users/${user.id}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ password }),
      });
      setDone(true);
      setTimeout(onClose, 1500);
    } finally { setBusy(false); }
  }

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title={`Reset password${user ? ` for ${user.display_name}` : ''}`}
      subtitle="They'll be able to sign in with the new password immediately"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={password.length < 6 || busy || done}>
            {busy ? 'Saving…' : done ? 'Saved' : 'Reset password'}
          </Button>
        </>
      }
    >
      <Input
        label="New password"
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        placeholder="At least 6 characters"
        autoFocus
      />
    </Modal>
  );
}

function SalarySection() {
  const { accounts } = useAccounts();
  const [entries, setEntries] = useState<SalaryEntry[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await api<SalaryEntry[]>('/salary');
      setEntries(data);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveProfile(
    userId: number,
    base: number,
    payDay: number,
    payDayType: PayDayType,
    accountId: number | null,
  ) {
    await api('/salary', {
      method: 'POST',
      body: JSON.stringify({
        userId,
        baseSalaryMonthly: base,
        payDay,
        payDayType,
        accountId,
        effectiveFrom: new Date().toISOString().slice(0, 10),
      }),
    });
    await load();
  }

  return (
    <Card padding="lg">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--color-mint-soft)] text-[var(--color-mint)] flex items-center justify-center">
            <Briefcase className="w-5 h-5" />
          </div>
          <CardTitle subtitle="Base monthly salary vs actual — tracks overtime & bonuses">
            Salary profiles
          </CardTitle>
        </div>
      </CardHeader>

      <div className="flex flex-col gap-6">
        {entries.map(e => (
          <SalaryProfileForm
            key={e.userId}
            entry={e}
            accounts={accounts.map(a => ({ id: a.id, name: a.name }))}
            onSave={(base, payDay, payDayType, accId) => saveProfile(e.userId, base, payDay, payDayType, accId)}
          />
        ))}
        {entries.length === 0 && (
          <div className="text-sm text-[var(--color-text-3)]">No users yet</div>
        )}
      </div>
    </Card>
  );
}

function SalaryProfileForm({
  entry, accounts, onSave,
}: {
  entry: SalaryEntry;
  accounts: Array<{ id: number; name: string }>;
  onSave: (base: number, payDay: number, payDayType: PayDayType, accountId: number | null) => Promise<void>;
}) {
  // Period toggle: store monthly internally, let user input either monthly or annual
  const [period, setPeriod] = useState<'monthly' | 'annual'>('monthly');
  const [amount, setAmount] = useState(
    entry.profile ? (entry.profile.baseSalaryMonthly / 100).toFixed(2) : '',
  );
  const [payDayType, setPayDayType] = useState<PayDayType>(entry.profile?.payDayType ?? 'day');
  const [payDay, setPayDay] = useState(String(entry.profile?.payDay ?? 28));
  const [accountId, setAccountId] = useState(String(entry.profile?.accountId ?? ''));
  const [saving, setSaving] = useState(false);

  // When the user flips between monthly/annual, recalculate the displayed amount
  function flipPeriod(next: 'monthly' | 'annual') {
    if (next === period) return;
    const n = parseFloat(amount || '0');
    if (!isNaN(n) && n > 0) {
      setAmount((next === 'annual' ? n * 12 : n / 12).toFixed(2));
    }
    setPeriod(next);
  }

  async function submit() {
    setSaving(true);
    try {
      const raw = parseFloat(amount || '0');
      const monthlyPence = Math.round((period === 'annual' ? raw / 12 : raw) * 100);
      await onSave(
        monthlyPence,
        Number(payDay),
        payDayType,
        accountId ? Number(accountId) : null,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[16px] p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--color-violet)] to-[var(--color-sky)] flex items-center justify-center text-sm font-bold text-white">
          {entry.displayName.charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="text-sm font-semibold">{entry.displayName}</div>
          <div className="text-xs text-[var(--color-text-3)]">@{entry.username}</div>
        </div>
      </div>

      {/* Salary with period toggle */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-[var(--color-text-3)] uppercase tracking-wider">
            Base salary (£ before tax)
          </label>
          <div className="flex bg-[var(--color-surface)] rounded-[8px] p-0.5 border border-[var(--color-border)]">
            <button
              type="button"
              onClick={() => flipPeriod('monthly')}
              className={`px-3 py-1 text-xs font-semibold rounded-[6px] transition ${
                period === 'monthly'
                  ? 'bg-[var(--color-mint-soft)] text-[var(--color-mint)]'
                  : 'text-[var(--color-text-3)] hover:text-[var(--color-text)]'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => flipPeriod('annual')}
              className={`px-3 py-1 text-xs font-semibold rounded-[6px] transition ${
                period === 'annual'
                  ? 'bg-[var(--color-mint-soft)] text-[var(--color-mint)]'
                  : 'text-[var(--color-text-3)] hover:text-[var(--color-text)]'
              }`}
            >
              Annual
            </button>
          </div>
        </div>
        <input
          type="number"
          step="0.01"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder={period === 'annual' ? 'e.g. 42000' : 'e.g. 3500'}
          className="w-full h-11 bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[12px] px-4 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-4)] focus:border-[var(--color-mint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-mint-soft)]"
        />
        {amount && parseFloat(amount) > 0 && (
          <p className="text-xs text-[var(--color-text-4)] mt-1.5">
            {period === 'annual'
              ? `≈ £${(parseFloat(amount) / 12).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / month`
              : `≈ £${(parseFloat(amount) * 12).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / year`}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Select
          label="Pay day"
          value={payDayType}
          onChange={e => setPayDayType(e.target.value as PayDayType)}
          options={[
            { value: 'day', label: 'Fixed day of month' },
            { value: 'last-working', label: 'Last working day of month' },
            { value: 'working-before', label: 'Working day before a date' },
          ]}
        />
        {payDayType === 'day' && (
          <Input
            label="Day of month"
            type="number"
            min="1"
            max="31"
            value={payDay}
            onChange={e => setPayDay(e.target.value)}
            hint="e.g. 28 — paid on the 28th every month"
          />
        )}
        {payDayType === 'working-before' && (
          <Input
            label="Target date (working day on or before)"
            type="number"
            min="1"
            max="31"
            value={payDay}
            onChange={e => setPayDay(e.target.value)}
            hint="e.g. 15 — paid on the 15th, or the previous Mon-Fri if it's a weekend"
          />
        )}
        {payDayType === 'last-working' && (
          <div className="text-xs text-[var(--color-text-3)] self-end pb-3">
            Paid on the last Monday-Friday of each month
          </div>
        )}
      </div>

      <div className="mt-4">
        <Select
          label="Salary hits account"
          value={accountId}
          onChange={e => setAccountId(e.target.value)}
          options={[
            { value: '', label: '— none —' },
            ...accounts.map(a => ({ value: String(a.id), label: a.name })),
          ]}
        />
      </div>

      <div className="mt-4">
        <Button variant="primary" size="sm" onClick={submit} disabled={saving || !amount}>
          {saving ? 'Saving…' : entry.profile ? 'Update' : 'Create profile'}
        </Button>
      </div>
    </div>
  );
}

// ===== TrueLayer Section =====

interface TlStatus {
  configured: boolean;
  connections: Array<{
    id: number;
    provider_name: string;
    last_sync_at: string | null;
    created_at: string;
    active: number;
  }>;
}

interface TlAccountRow {
  id: number;
  connection_id: number;
  external_id: string;
  display_name: string;
  account_type: string;
  currency: string;
  linked_account_id: number | null;
  last_sync_at: string | null;
}

function TrueLayerSection() {
  const { accounts } = useAccounts();
  const [creds, setCreds] = useState({ clientId: '', clientSecret: '', redirectUri: '', sandbox: true });
  const [status, setStatus] = useState<TlStatus | null>(null);
  const [tlAccounts, setTlAccounts] = useState<Record<number, TlAccountRow[]>>({});
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const s = await api<TlStatus>('/truelayer/status');
      setStatus(s);
      // Load accounts for each connection
      const byConn: Record<number, TlAccountRow[]> = {};
      for (const c of s.connections) {
        byConn[c.id] = await api<TlAccountRow[]>(`/truelayer/connections/${c.id}/accounts`);
      }
      setTlAccounts(byConn);
    } catch {}
  }, []);

  const loadCreds = useCallback(async () => {
    try {
      const all = await api<Record<string, any>>('/settings/all');
      setCreds({
        clientId: all.truelayer_client_id ?? '',
        clientSecret: all.truelayer_client_secret ?? '',
        redirectUri: all.truelayer_redirect_uri ?? 'http://localhost:3002/api/truelayer/callback',
        sandbox: all.truelayer_sandbox !== false,
      });
    } catch {}
  }, []);

  useEffect(() => {
    loadCreds();
    loadStatus();

    // Handle OAuth callback feedback in URL
    const params = new URLSearchParams(window.location.search);
    if (params.get('tl_connected')) {
      setFeedback('Bank account connected');
      window.history.replaceState({}, '', '/');
      loadStatus();
    } else if (params.get('tl_error')) {
      setFeedback(`Connection failed: ${params.get('tl_error')}`);
      window.history.replaceState({}, '', '/');
    }
  }, [loadStatus, loadCreds]);

  async function saveCreds() {
    setSaving(true);
    try {
      await api('/settings/truelayer_client_id', { method: 'PUT', body: JSON.stringify({ value: creds.clientId }) });
      await api('/settings/truelayer_client_secret', { method: 'PUT', body: JSON.stringify({ value: creds.clientSecret }) });
      await api('/settings/truelayer_redirect_uri', { method: 'PUT', body: JSON.stringify({ value: creds.redirectUri }) });
      await api('/settings/truelayer_sandbox', { method: 'PUT', body: JSON.stringify({ value: creds.sandbox }) });
      await loadStatus();
      setFeedback('Saved');
      setTimeout(() => setFeedback(null), 3000);
    } finally {
      setSaving(false);
    }
  }

  async function startConnect() {
    try {
      const res = await api<{ url: string }>('/truelayer/auth-url');
      window.location.href = res.url;
    } catch (e: any) {
      setFeedback(`Error: ${e.error ?? 'Could not start auth'}`);
    }
  }

  async function sync() {
    setSyncing(true);
    try {
      const res = await api<{ imported: number; skipped: number; errors: string[] }>(
        '/truelayer/sync', { method: 'POST' },
      );
      setFeedback(`Synced: ${res.imported} new, ${res.skipped} dupes${res.errors.length ? `, ${res.errors.length} errors` : ''}`);
      await loadStatus();
    } catch (e: any) {
      setFeedback(`Sync failed: ${e.error}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setFeedback(null), 5000);
    }
  }

  async function disconnect(id: number) {
    if (!confirm('Remove this bank connection? Transactions already synced will remain.')) return;
    await api(`/truelayer/connections/${id}`, { method: 'DELETE' });
    await loadStatus();
  }

  async function linkAccount(tlAcctId: number, tallyAccountId: number | null) {
    await api('/truelayer/link', {
      method: 'POST',
      body: JSON.stringify({ truelayerAccountId: tlAcctId, tallyAccountId }),
    });
    await loadStatus();
  }

  return (
    <Card padding="lg">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--color-sky-soft)] text-[var(--color-sky)] flex items-center justify-center">
            <Building2 className="w-5 h-5" />
          </div>
          <CardTitle subtitle="Live bank sync via Open Banking — no more CSV imports">
            TrueLayer (Open Banking)
          </CardTitle>
        </div>
      </CardHeader>

      {feedback && (
        <div className="mb-4 text-xs px-3 py-2 rounded-[10px] bg-[var(--color-mint-soft)] border border-[rgba(74,222,128,0.25)] text-[var(--color-mint)]">
          {feedback}
        </div>
      )}

      <div className="flex flex-col gap-4">
        <Input
          label="Client ID"
          value={creds.clientId}
          onChange={e => setCreds({ ...creds, clientId: e.target.value })}
          placeholder="tl-client-xxx"
        />
        <Input
          label="Client Secret"
          type="password"
          value={creds.clientSecret}
          onChange={e => setCreds({ ...creds, clientSecret: e.target.value })}
        />
        <Input
          label="Redirect URI"
          value={creds.redirectUri}
          onChange={e => setCreds({ ...creds, redirectUri: e.target.value })}
          hint="Must match one of the redirect URIs registered in the TrueLayer console"
        />
        <Select
          label="Mode"
          value={creds.sandbox ? 'sandbox' : 'live'}
          onChange={e => setCreds({ ...creds, sandbox: e.target.value === 'sandbox' })}
          options={[
            { value: 'sandbox', label: 'Sandbox (test data, no real accounts)' },
            { value: 'live', label: 'Live (real bank accounts)' },
          ]}
        />

        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={saveCreds} disabled={saving} icon={<Save className="w-4 h-4" />}>
            Save
          </Button>
          <Button
            variant="secondary"
            onClick={startConnect}
            disabled={!status?.configured}
            icon={<Link2 className="w-4 h-4" />}
          >
            Connect bank
          </Button>
          {status && status.connections.length > 0 && (
            <Button variant="ghost" onClick={sync} disabled={syncing} icon={<RefreshCw className="w-4 h-4" />}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </Button>
          )}
        </div>

        {status && status.connections.length > 0 && (
          <div className="mt-4 flex flex-col gap-3">
            {status.connections.map(c => (
              <div key={c.id} className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[14px] p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-sm font-semibold">{c.provider_name}</div>
                    <div className="text-xs text-[var(--color-text-3)]">
                      {c.last_sync_at
                        ? `Last synced ${new Date(c.last_sync_at).toLocaleString()}`
                        : 'Never synced'}
                    </div>
                  </div>
                  <button
                    onClick={() => disconnect(c.id)}
                    className="w-8 h-8 rounded-lg hover:bg-[var(--color-coral-soft)] text-[var(--color-text-3)] hover:text-[var(--color-coral)] flex items-center justify-center"
                    title="Disconnect"
                  >
                    <Unlink className="w-4 h-4" />
                  </button>
                </div>

                {(tlAccounts[c.id] ?? []).length > 0 && (
                  <div className="flex flex-col gap-2">
                    {tlAccounts[c.id].map(a => (
                      <div key={a.id} className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{a.display_name}</div>
                          <div className="text-[10px] text-[var(--color-text-4)] uppercase tracking-wider">
                            {a.account_type} · {a.currency}
                          </div>
                        </div>
                        <Select
                          value={String(a.linked_account_id ?? '')}
                          onChange={e => linkAccount(a.id, e.target.value ? Number(e.target.value) : null)}
                          options={[
                            { value: '', label: '— not linked —' },
                            ...accounts.map(acc => ({ value: String(acc.id), label: acc.name })),
                          ]}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ===== Backup Section =====

interface BackupFile {
  filename: string;
  size: number;
  mtime: string;
}

function BackupSection() {
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setBackups(await api<BackupFile[]>('/backup'));
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    setCreating(true);
    try {
      await api('/backup', { method: 'POST' });
      await load();
    } finally { setCreating(false); }
  }

  function downloadExport() {
    const token = getToken();
    window.open(`/api/backup/export?token=${token}`, '_blank');
  }

  return (
    <Card padding="lg">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--color-amber-soft)] text-[var(--color-amber)] flex items-center justify-center">
            <Database className="w-5 h-5" />
          </div>
          <CardTitle subtitle="Daily auto-backups with 14-day rotation. Manual export available.">
            Backups
          </CardTitle>
        </div>
      </CardHeader>

      <div className="flex gap-2 mb-4">
        <Button variant="primary" onClick={create} disabled={creating} icon={<Database className="w-4 h-4" />}>
          {creating ? 'Creating…' : 'Create backup now'}
        </Button>
        <Button variant="secondary" onClick={downloadExport} icon={<Download className="w-4 h-4" />}>
          Export JSON
        </Button>
      </div>

      {backups.length === 0 ? (
        <div className="text-xs text-[var(--color-text-3)]">No backups yet</div>
      ) : (
        <div className="flex flex-col gap-1 text-xs">
          {backups.slice(0, 8).map(b => (
            <div key={b.filename} className="flex items-center justify-between py-1.5 text-[var(--color-text-3)]">
              <span className="mono">{b.filename}</span>
              <span>{(b.size / 1024).toFixed(1)} KB</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
