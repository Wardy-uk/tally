import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { aiCategoriseUncategorised } from '../services/ai-categoriser.js';
import { isConfigured } from '../services/openai-service.js';
import { detectTransfers } from '../services/transfer-detector.js';

export function createAiRoutes() {
  const router = Router();

  router.get('/status', requireAuth, (_req, res) => {
    res.json({ ok: true, data: { configured: isConfigured() } });
  });

  router.post('/categorise', requireAuth, async (req, res) => {
    const limit = Math.min(Number(req.body?.limit ?? 100), 200);
    try {
      const result = await aiCategoriseUncategorised(limit);
      res.json({ ok: true, data: result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post('/detect-transfers', requireAuth, (req, res) => {
    const window = Number(req.body?.windowDays ?? 3);
    const pairs = detectTransfers(window);
    res.json({ ok: true, data: { pairs } });
  });

  return router;
}
