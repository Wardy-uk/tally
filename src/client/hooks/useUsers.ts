import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: string;
}

export function useUsers() {
  const [users, setUsers] = useState<Array<{ id: number; displayName: string }>>([]);
  useEffect(() => {
    api<UserRow[]>('/auth/users').then(rows => {
      setUsers(rows.map(u => ({ id: u.id, displayName: u.display_name })));
    }).catch(() => {});
  }, []);
  return users;
}
