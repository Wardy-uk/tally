import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

export interface TransactionRow {
  id: number;
  account_id: number;
  date: string;
  amount: number;
  description: string;
  merchant: string | null;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  category_icon: string | null;
  account_name: string | null;
  notes: string | null;
  is_transfer: number;
  balance_after: number | null;
}

export interface TxFilter {
  accountId?: number;
  categoryId?: number | 'none';
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  type?: 'income' | 'expense';
  includeTransfers?: boolean;
  limit?: number;
  offset?: number;
}

export function useTransactions(filter: TxFilter = {}) {
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filter)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    }
    try {
      const data = await api<{ rows: TransactionRow[]; total: number }>(`/transactions?${params}`);
      setRows(data.rows);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(filter)]);

  useEffect(() => { refresh(); }, [refresh]);

  const updateCategory = useCallback(async (id: number, categoryId: number | null) => {
    await api(`/transactions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ categoryId }),
    });
    await refresh();
  }, [refresh]);

  return { rows, total, loading, refresh, updateCategory };
}
