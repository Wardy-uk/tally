const TOKEN_KEY = 'tally_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export interface ApiError {
  error: string;
  status: number;
}

export async function api<T = unknown>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...opts, headers });
  const json = await res.json().catch(() => ({ ok: false, error: 'Invalid JSON' }));

  if (!res.ok || !json.ok) {
    throw { error: json.error ?? `HTTP ${res.status}`, status: res.status } as ApiError;
  }
  return json.data as T;
}
