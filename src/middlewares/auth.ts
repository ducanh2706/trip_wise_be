import { NextFunction, Request, Response } from 'express';
import { resolveAuthToken } from '@/services/auth.service';

function extractBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const [scheme, token] = headerValue.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return null;
  }
  return token.trim() || null;
}

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      next();
      return;
    }

    const auth = await resolveAuthToken(token);
    if (auth) {
      req.auth = auth;
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.auth?.userId) {
    res.status(401).json({ message: 'Authentication required' });
    return;
  }
  next();
}
