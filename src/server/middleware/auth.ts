import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Settings } from '../db/settings-store.js';
import { UserQueries } from '../db/queries.js';
import type { AuthUser } from '../../shared/types.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function getSecret(): string {
  return (Settings.get<string>('jwt_secret') ?? process.env.JWT_SECRET ?? 'dev-insecure-secret');
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, getSecret(), { expiresIn: '30d' });
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, getSecret()) as any;
    return {
      id: decoded.id,
      username: decoded.username,
      displayName: decoded.displayName,
      role: decoded.role,
    };
  } catch {
    return null;
  }
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
