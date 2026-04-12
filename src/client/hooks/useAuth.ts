import { useCallback, useEffect, useState } from 'react';
import { api, getToken, setToken } from '../lib/api';
import type { AuthUser } from '../../shared/types';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  hasUsers: boolean | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ user: null, loading: true, hasUsers: null });

  const loadMe = useCallback(async () => {
    try {
      const status = await api<{ hasUsers: boolean; userCount: number }>('/auth/status');
      const token = getToken();
      if (!token) {
        setState({ user: null, loading: false, hasUsers: status.hasUsers });
        return;
      }
      const me = await api<AuthUser>('/auth/me');
      setState({ user: me, loading: false, hasUsers: status.hasUsers });
    } catch {
      setToken(null);
      setState({ user: null, loading: false, hasUsers: null });
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api<{ token: string; user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setToken(res.token);
    setState(s => ({ ...s, user: res.user }));
  }, []);

  const register = useCallback(async (username: string, password: string, displayName: string) => {
    const res = await api<{ token: string; user: AuthUser }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName }),
    });
    setToken(res.token);
    setState(s => ({ ...s, user: res.user, hasUsers: true }));
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setState(s => ({ ...s, user: null }));
  }, []);

  return { ...state, login, register, logout, refresh: loadMe };
}
