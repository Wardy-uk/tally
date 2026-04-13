/**
 * Lightweight HTTP client for the Tally API.
 * Auto-authenticates using TALLY_USERNAME + TALLY_PASSWORD if no token is set,
 * and caches the token in memory for the lifetime of the MCP server process.
 */

export class TallyClient {
  private baseUrl: string;
  private token: string | null;
  private username?: string;
  private password?: string;

  constructor(config: {
    baseUrl: string;
    token?: string;
    username?: string;
    password?: string;
  }) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.token = config.token ?? null;
    this.username = config.username;
    this.password = config.password;
  }

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token;
    if (!this.username || !this.password) {
      throw new Error(
        'No Tally token or username/password configured. Set TALLY_TOKEN, or TALLY_USERNAME + TALLY_PASSWORD.',
      );
    }
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.username, password: this.password }),
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    const json = await res.json() as { ok: boolean; data?: { token: string } };
    if (!json.ok || !json.data?.token) throw new Error('Login returned no token');
    this.token = json.data.token;
    return this.token;
  }

  async request<T = unknown>(
    path: string,
    opts: RequestInit = {},
    retryOn401 = true,
  ): Promise<T> {
    const token = await this.ensureToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.headers as Record<string, string> ?? {}),
    };
    const res = await fetch(`${this.baseUrl}${path}`, { ...opts, headers });

    // Retry once on auth failure in case the cached token expired
    if (res.status === 401 && retryOn401 && (this.username && this.password)) {
      this.token = null;
      return this.request<T>(path, opts, false);
    }

    const text = await res.text();
    let json: any;
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    if (!res.ok) {
      throw new Error(`API ${path} failed (${res.status}): ${json?.error ?? text}`);
    }
    if (json && typeof json === 'object' && 'ok' in json) {
      if (!json.ok) throw new Error(json.error ?? 'Unknown error');
      return json.data as T;
    }
    return json as T;
  }

  // ----- Convenience wrappers -----

  health() {
    return this.request<{ status: string; time: string }>('/api/health');
  }

  listAccounts() {
    return this.request<Array<any>>('/api/accounts');
  }

  listTransactions(params: {
    accountId?: number;
    categoryId?: number | 'none';
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    type?: 'income' | 'expense';
    includeTransfers?: boolean;
    limit?: number;
    offset?: number;
  } = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
    return this.request<{ rows: any[]; total: number; limit: number; offset: number }>(
      `/api/transactions?${qs}`,
    );
  }

  monthlySummary(month?: string) {
    const qs = month ? `?month=${month}` : '';
    return this.request<any>(`/api/transactions/summary/monthly${qs}`);
  }

  dashboard(month?: string) {
    const qs = month ? `?month=${month}` : '';
    return this.request<any>(`/api/dashboard${qs}`);
  }

  budgetStatus(month?: string) {
    const qs = month ? `?month=${month}` : '';
    return this.request<any[]>(`/api/budgets/status${qs}`);
  }

  listCategories() {
    return this.request<any[]>('/api/categories');
  }

  listSubscriptions() {
    return this.request<any[]>('/api/subscriptions');
  }

  listRules() {
    return this.request<any[]>('/api/rules');
  }

  triggerSync() {
    return this.request<{ connections: number; accounts: number; imported: number; skipped: number; errors: string[] }>(
      '/api/truelayer/sync',
      { method: 'POST' },
    );
  }

  generateInsight(month?: string) {
    return this.request<any>('/api/insights/generate', {
      method: 'POST',
      body: JSON.stringify({ month }),
    });
  }

  chat(message: string, conversationId: number | null = null) {
    return this.request<{ reply: string; conversationId: number }>('/api/chat/message', {
      method: 'POST',
      body: JSON.stringify({ conversationId, message }),
    });
  }
}
