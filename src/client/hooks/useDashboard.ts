import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

export interface DashboardData {
  month: string;
  netWorth: number;
  income: number;
  expense: number; // negative
  net: number;
  prevExpense: number;
  expenseDelta: number;
  trend: Array<{ month: string; income: number; expense: number }>;
  byCategory: Array<{ id: number | null; name: string | null; color: string | null; icon: string | null; total: number; count: number }>;
  topMerchants: Array<{ description: string; count: number; total: number }>;
  recent: Array<{
    id: number; date: string; amount: number; description: string;
    merchant: string | null; is_transfer: number;
    category_name: string | null; category_color: string | null;
    account_name: string | null;
  }>;
  accounts: Array<{ id: number; name: string; type: string; owner_user_id: number | null; balance: number }>;
  salaryWidgets: Array<{
    userId: number; displayName: string; hasProfile: boolean;
    baseMonthly: number; actualMonth: number; variance: number; payDay?: number;
  }>;
}

export function useDashboard(month?: string) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<DashboardData>(`/dashboard${month ? `?month=${month}` : ''}`);
      setData(d);
    } finally { setLoading(false); }
  }, [month]);
  useEffect(() => { refresh(); }, [refresh]);
  return { data, loading, refresh };
}
