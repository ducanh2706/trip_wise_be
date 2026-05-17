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
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const rawLimit = Number(req.query.limit) || 10;
    const limit = Math.min(Math.max(1, rawLimit), 50);
    res.json(await getFeed(offset, limit));
  } catch (err) {
    next(err);
  }
}

export async function getSummaryHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await getSummary());
  } catch (err) {
    next(err);
  }
}

export async function getPreferencesHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await getPreferences());
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
    res.json(await updatePreferences(req.body));
  } catch (err) {
    handleNotificationError(err, res, next);
  }
}

export async function markAllReadHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await markAllRead());
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
    res.json(await markRead(String(req.params.id)));
  } catch (err) {
    handleNotificationError(err, res, next);
  }
}
