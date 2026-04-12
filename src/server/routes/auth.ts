import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { UserQueries } from '../db/queries.js';
import { signToken, requireAuth } from '../middleware/auth.js';

export function createAuthRoutes() {
  const router = Router();

  router.get('/status', (_req, res) => {
    const count = (UserQueries.count.get() as { c: number }).c;
    res.json({ ok: true, data: { hasUsers: count > 0, userCount: count } });
  });

  router.post('/register', async (req, res) => {
    const schema = z.object({
      username: z.string().min(2).max(30),
      password: z.string().min(6),
      displayName: z.string().min(1).max(60),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.message });
    }
    const { username, password, displayName } = parsed.data;

    const existing = UserQueries.findByUsername.get(username);
    if (existing) return res.status(409).json({ ok: false, error: 'Username already taken' });

    const count = (UserQueries.count.get() as { c: number }).c;
    const role = count === 0 ? 'admin' : 'user';
    const hash = await bcrypt.hash(password, 10);
    const result = UserQueries.create.run(username, displayName, hash, role);

    const user = {
      id: Number(result.lastInsertRowid),
      username,
      displayName,
      role: role as 'admin' | 'user',
    };
    const token = signToken(user);
    res.json({ ok: true, data: { token, user } });
  });

  router.post('/login', async (req, res) => {
    const schema = z.object({ username: z.string(), password: z.string() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: 'Bad input' });

    const row = UserQueries.findByUsername.get(parsed.data.username) as any;
    if (!row) return res.status(401).json({ ok: false, error: 'Invalid credentials' });

    const ok = await bcrypt.compare(parsed.data.password, row.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: 'Invalid credentials' });

    const user = {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role as 'admin' | 'user',
    };
    const token = signToken(user);
    res.json({ ok: true, data: { token, user } });
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ ok: true, data: req.user });
  });

  return router;
}
