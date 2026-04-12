import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { chat, listConversations, getConversation, deleteConversation } from '../services/chat-service.js';

export function createChatRoutes() {
  const router = Router();

  router.get('/conversations', requireAuth, (req, res) => {
    res.json({ ok: true, data: listConversations(req.user!.id) });
  });

  router.get('/conversations/:id', requireAuth, (req, res) => {
    const data = getConversation(Number(req.params.id));
    if (!data) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, data });
  });

  router.delete('/conversations/:id', requireAuth, (req, res) => {
    deleteConversation(Number(req.params.id));
    res.json({ ok: true, data: { deleted: Number(req.params.id) } });
  });

  router.post('/message', requireAuth, async (req, res) => {
    const schema = z.object({
      conversationId: z.number().int().nullable(),
      message: z.string().min(1).max(2000),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.message });

    try {
      const result = await chat(parsed.data.conversationId ?? 0, parsed.data.message);
      res.json({ ok: true, data: result });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
