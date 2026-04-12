import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { generateMonthlyInsight, listInsights } from '../services/insights-service.js';

export function createInsightsRoutes() {
  const router = Router();

  router.get('/', requireAuth, (_req, res) => {
    res.json({ ok: true, data: listInsights(12) });
  });

  router.post('/generate', requireAuth, async (req, res) => {
    const month = (req.body?.month as string) || new Date().toISOString().slice(0, 7);
    try {
      const insight = await generateMonthlyInsight(month);
      res.json({ ok: true, data: insight });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
