import { Request, Response, NextFunction } from 'express';
import {
  registerDeviceToken,
  removeDeviceToken,
} from '@/services/devices.service';
import {
  createNotification,
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

export async function registerDeviceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.status(201).json(await registerDeviceToken(req.auth!.userId, req.body));
  } catch (err) {
    handleNotificationError(err, res, next);
  }
}

export async function unregisterDeviceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await removeDeviceToken(req.body));
  } catch (err) {
    handleNotificationError(err, res, next);
  }
}

// Verification helper: exercises createNotification (inbox row + push) with a
// canned SYSTEM payload, no domain mutation needed.
export async function testPushHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await createNotification({
      userId: req.auth!.userId,
      type: 'SYSTEM',
      title: 'Test notification',
      body: 'If you see this as a banner, push is working. 🎉',
      actionRoute: '/notification_inbox',
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
