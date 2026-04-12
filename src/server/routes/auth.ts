import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { UserQueries } from '../db/queries.js';
import { signToken, requireAuth, requireAdmin } from '../middleware/auth.js';

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

  router.get('/users', requireAuth, (_req, res) => {
    const rows = UserQueries.list.all();
    res.json({ ok: true, data: rows });
  });

  // Admin: create a new user directly (for adding family members, etc.)
  router.post('/users', requireAuth, requireAdmin, async (req, res) => {
    const schema = z.object({
      username: z.string().min(2).max(30),
      password: z.string().min(6),
      displayName: z.string().min(1).max(60),
      role: z.enum(['admin', 'user']).default('user'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });

    const existing = UserQueries.findByUsername.get(parsed.data.username);
    if (existing) return res.status(409).json({ ok: false, error: 'Username already taken' });

    const hash = await bcrypt.hash(parsed.data.password, 10);
    const result = UserQueries.create.run(
      parsed.data.username, parsed.data.displayName, hash, parsed.data.role,
    );
    res.json({
      ok: true,
      data: {
        id: Number(result.lastInsertRowid),
        username: parsed.data.username,
        displayName: parsed.data.displayName,
        role: parsed.data.role,
      },
    });
  });

  // Admin: reset a user's password
  router.patch('/users/:id/password', requireAuth, requireAdmin, async (req, res) => {
    const schema = z.object({ password: z.string().min(6) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });

    const hash = await bcrypt.hash(parsed.data.password, 10);
    UserQueries.updatePassword.run(hash, Number(req.params.id));
    res.json({ ok: true, data: { id: Number(req.params.id) } });
  });

  // Admin: update display name / role
  router.patch('/users/:id', requireAuth, requireAdmin, (req, res) => {
    const schema = z.object({
      displayName: z.string().min(1).max(60),
      role: z.enum(['admin', 'user']),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });
    UserQueries.updateProfile.run(parsed.data.displayName, parsed.data.role, Number(req.params.id));
    res.json({ ok: true, data: { id: Number(req.params.id) } });
  });

  // Admin: delete a user (can't delete yourself)
  router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user!.id) {
      return res.status(400).json({ ok: false, error: 'Cannot delete yourself' });
    }
    UserQueries.delete.run(id);
    res.json({ ok: true, data: { deleted: id } });
  });

  // Self: change own password
  router.post('/change-password', requireAuth, async (req, res) => {
    const schema = z.object({
      currentPassword: z.string(),
      newPassword: z.string().min(6),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });

    const row = UserQueries.findById.get(req.user!.id) as any;
    const ok = await bcrypt.compare(parsed.data.currentPassword, row.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: 'Current password incorrect' });

    const hash = await bcrypt.hash(parsed.data.newPassword, 10);
    UserQueries.updatePassword.run(hash, req.user!.id);
    res.json({ ok: true, data: { changed: true } });
  });

  return router;
}
