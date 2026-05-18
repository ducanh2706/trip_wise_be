import { NextFunction, Request, Response } from 'express';
import {
  getCurrentSession,
  loginWithGoogleIdToken,
  loginUser,
  logoutSession,
  registerUser,
} from '@/services/auth.service';

export async function registerHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.status(201).json(
      await registerUser(req.body, {
        userAgent: req.get('user-agent'),
      }),
    );
  } catch (error) {
    next(error);
  }
}

export async function loginHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(
      await loginUser(req.body, {
        userAgent: req.get('user-agent'),
      }),
    );
  } catch (error) {
    next(error);
  }
}

export async function googleLoginHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(
      await loginWithGoogleIdToken(req.body, {
        userAgent: req.get('user-agent'),
      }),
    );
  } catch (error) {
    next(error);
  }
}

export async function meHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await getCurrentSession(req.auth!.userId, req.auth!.expiresAt));
  } catch (error) {
    next(error);
  }
}

export async function logoutHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await logoutSession(req.auth!.sessionId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
