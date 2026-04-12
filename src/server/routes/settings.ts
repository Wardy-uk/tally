import { Router } from 'express';
import { Settings } from '../db/settings-store.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

export function createSettingsRoutes() {
  const router = Router();

  router.get('/', requireAuth, (_req, res) => {
    res.json({ ok: true, data: Settings.publicSubset() });
  });

  router.get('/all', requireAuth, requireAdmin, (_req, res) => {
    res.json({ ok: true, data: Settings.all() });
  });

  router.put('/:key', requireAuth, requireAdmin, (req, res) => {
    const { key } = req.params;
    const { value } = req.body ?? {};
    Settings.set(key, value);
    res.json({ ok: true, data: { key, value } });
  });

  router.delete('/:key', requireAuth, requireAdmin, (req, res) => {
    Settings.remove(req.params.key);
    res.json({ ok: true, data: { removed: req.params.key } });
  });

  return router;
}
