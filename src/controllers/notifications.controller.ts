import { Request, Response, NextFunction } from 'express';
import {
  getFeed,
  getSummary,
  markRead,
  markAllRead,
  getPreferences,
  updatePreferences,
  NotificationError,
} from '@/services/notifications.service';

function handleNotificationError(
  err: unknown,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof NotificationError) {
    res.status(err.status).json({ message: err.message });
    return;
  }
  next(err);
}

export async function getFeedHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const before =
      typeof req.query.before === 'string' && req.query.before.trim()
        ? req.query.before.trim()
        : null;
    const rawLimit = Number(req.query.limit) || 10;
    const limit = Math.min(Math.max(1, rawLimit), 50);
    res.json(await getFeed(req.auth!.userId, before, limit));
  } catch (err) {
    next(err);
  }
}

export async function getSummaryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await getSummary(req.auth!.userId));
  } catch (err) {
    next(err);
  }
}

export async function getPreferencesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await getPreferences(req.auth!.userId));
  } catch (err) {
    next(err);
  }
}

export async function updatePreferencesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await updatePreferences(req.auth!.userId, req.body));
  } catch (err) {
    handleNotificationError(err, res, next);
  }
}

export async function markAllReadHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await markAllRead(req.auth!.userId));
  } catch (err) {
    handleNotificationError(err, res, next);
  }
}

export async function markReadHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await markRead(req.auth!.userId, String(req.params.id)));
  } catch (err) {
    handleNotificationError(err, res, next);
  }
}
