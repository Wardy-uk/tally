import { useState } from 'react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Wallet, Lock, User, UserPlus } from 'lucide-react';

interface Props {
  hasUsers: boolean;
  onLogin: (username: string, password: string) => Promise<void>;
  onRegister: (username: string, password: string, displayName: string) => Promise<void>;
}

export function Login({ hasUsers, onLogin, onRegister }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>(hasUsers ? 'login' : 'register');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await onLogin(username, password);
      } else {
        await onRegister(username, password, displayName || username);
      }
    } catch (err: any) {
      setError(err.error ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-[420px] fade-up">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[var(--color-mint)] to-[var(--color-violet)] flex items-center justify-center shadow-[0_0_32px_rgba(74,222,128,0.35)]">
            <Wallet className="w-6 h-6 text-[#04140a]" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Tally</h1>
            <p className="text-xs text-[var(--color-text-3)]">Personal finance</p>
          </div>
        </div>

        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[24px] p-8 shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
          <div className="mb-6">
            <h2 className="text-xl font-bold tracking-tight">
              {mode === 'login' ? 'Welcome back' : hasUsers ? 'Create account' : 'Set up Tally'}
            </h2>
            <p className="text-sm text-[var(--color-text-3)] mt-1">
              {mode === 'login'
                ? 'Sign in to manage your finances'
                : hasUsers
                ? 'Create a second user account'
                : 'Create the first admin user'}
            </p>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <Input
              label="Username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              icon={<User className="w-4 h-4" />}
              autoFocus
              required
            />
            {mode === 'register' && (
              <Input
                label="Display name"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="How you'll appear in the app"
                icon={<UserPlus className="w-4 h-4" />}
              />
            )}
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              icon={<Lock className="w-4 h-4" />}
              required
              minLength={mode === 'register' ? 6 : undefined}
            />

            {error && (
              <div className="text-sm text-[var(--color-coral)] bg-[var(--color-coral-soft)] border border-[rgba(251,113,133,0.2)] rounded-[12px] px-3 py-2">
                {error}
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" block disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          {hasUsers && (
            <div className="mt-6 pt-6 border-t border-[var(--color-border)] text-center">
              <button
                type="button"
                onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
                className="text-sm text-[var(--color-text-3)] hover:text-[var(--color-mint)] transition"
              >
                {mode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in'}
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-[var(--color-text-4)] mt-6">
          v{__APP_VERSION__} · {__GIT_HASH__}
        </p>
      </div>
    </div>
  );
}
