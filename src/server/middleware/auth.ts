import { Request, Response, NextFunction } from 'express';
import { UserQueries } from '../db/queries.js';
import type { AuthUser } from '../../shared/types.js';
import { loadJwtSecret } from '../security/jwt-secret.js';
import { signTokenWith, verifyTokenWith } from '../security/token.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// The secret is resolved (and refused) by security/jwt-secret.ts — never a literal here.
function getSecret(): string {
  return loadJwtSecret().secret;
}

export function signToken(user: AuthUser): string {
  return signTokenWith(user, getSecret());
}

export function verifyToken(token: string): AuthUser | null {
  return verifyTokenWith(token, getSecret());
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query.token as string | undefined);
  if (!token) return res.status(401).json({ ok: false, error: 'No token' });

  const user = verifyToken(token);
  if (!user) return res.status(401).json({ ok: false, error: 'Invalid or expired token' });

  // Reload from DB to ensure still exists + up-to-date
  const row = UserQueries.findById.get(user.id) as any;
  if (!row) return res.status(401).json({ ok: false, error: 'User no longer exists' });

  req.user = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
  };
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin only' });
  }
  next();
}
