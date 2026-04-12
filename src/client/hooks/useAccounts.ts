import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

export interface Account {
  id: number;
  name: string;
  type: 'current' | 'savings' | 'credit' | 'loan' | 'investment';
  ownerUserId: number | null;
  bank: string | null;
  accountNumber: string | null;
  sortCode: string | null;
  openingBalance: number;
  currentBalance: number;
  active: number;
  createdAt: string;
}

export interface AccountInput {
  name: string;
  type: Account['type'];
  ownerUserId: number | null;
  bank?: string | null;
  accountNumber?: string | null;
  sortCode?: string | null;
  openingBalance: number;
}

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<Account[]>('/accounts');
      setAccounts(data);
      setError(null);
    } catch (e: any) {
      setError(e.error ?? 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = useCallback(async (input: AccountInput) => {
    await api('/accounts', { method: 'POST', body: JSON.stringify(input) });
    await refresh();
  }, [refresh]);

  const update = useCallback(async (id: number, input: AccountInput) => {
    await api(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(input) });
    await refresh();
  }, [refresh]);

  const archive = useCallback(async (id: number) => {
    await api(`/accounts/${id}`, { method: 'DELETE' });
    await refresh();
  }, [refresh]);

  return { accounts, loading, error, refresh, create, update, archive };
}
