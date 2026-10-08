/**
 * Sign / verify Tally JWTs against an explicit secret. Pure (no DB, no settings),
 * so rotation can be tested directly: a token signed with an old secret must not
 * verify against the new one.
 */
import jwt from 'jsonwebtoken';
import type { AuthUser } from '../../shared/types.js';

export function signTokenWith(user: AuthUser, secret: string): string {
  return jwt.sign(
    { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
    secret,
    { expiresIn: '30d', algorithm: 'HS256' },
  );
}

export function verifyTokenWith(token: string, secret: string): AuthUser | null {
  try {
    // Pin the algorithm: a token must not choose how it is checked.
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as any;
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
