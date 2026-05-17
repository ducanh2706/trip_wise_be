import { randomUUID } from 'node:crypto';
import { Notification } from '@/models/Notification.model';
import { NotificationPreference } from '@/models/NotificationPreference.model';
import { env } from '@/config/env';
import { sendPushToUser } from '@/services/push.service';

// No auth yet — the in-app inbox is per-user, so (like the wallet/trips
// slices) we pin the demo user. Override via DEMO_USER_ID in .env.

const PREVIEW_LIMIT = 50; // hard cap on a single feed page

export interface NotificationItem {
  id: string;
  type: string; // BOOKING | TRIP | MESSAGE | PROMO | SYSTEM
  title: string;
  body: string;
  read: boolean;
  actionRoute: string | null;
  createdAt: string;
  timeLabel: string; // relative, server-formatted (e.g. "2h ago")
}

export interface FeedPage {
  items: NotificationItem[];
  total: number;
  unreadCount: number;
  hasMore: boolean;
  nextOffset: number;
}

export interface NotificationSummary {
  unreadCount: number;
  total: number;
}

export interface PreferencesResponse {
  push: boolean;
  email: boolean;
  tripReminders: boolean;
  bookingUpdates: boolean;
  messages: boolean;
  promotions: boolean;
}

const PREF_KEYS: (keyof PreferencesResponse)[] = [
  'push',
  'email',
  'tripReminders',
  'bookingUpdates',
  'messages',
  'promotions',
];

const DEFAULT_PREFS: PreferencesResponse = {
  push: true,
  email: true,
  tripReminders: true,
  bookingUpdates: true,
  messages: true,
  promotions: false,
};

/** A thrown error the controller maps to a 4xx instead of a 500. */
export class NotificationError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** "just now" / "2h ago" / "Yesterday" / "May 12" — formatted server-side so
 *  every client renders the same string (mirrors wallet's server-side dates). */
function relativeLabel(iso?: string | null): string {
  if (!iso) return '';
  const then = new Date(iso);
  const t = then.getTime();
  if (Number.isNaN(t)) return '';
  const diffMs = Date.now() - t;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function mapNotification(n: {
  _id: string;
  type?: string | null;
  title?: string | null;
  body?: string | null;
  read?: boolean | null;
  action_route?: string | null;
  created_at?: string | null;
}): NotificationItem {
  return {
    id: n._id,
    type: n.type ?? 'SYSTEM',
    title: n.title ?? '',
    body: n.body ?? '',
    read: n.read ?? false,
    actionRoute: n.action_route ?? null,
    createdAt: n.created_at ?? '',
    timeLabel: relativeLabel(n.created_at),
  };
}

/** Idempotently make sure the demo user has a preferences doc. */
async function ensureDefaultPreferences(
  userId: string,
): Promise<PreferencesResponse> {
  const existing = await NotificationPreference.findById(userId).lean();
  if (existing) {
    return PREF_KEYS.reduce((acc, k) => {
      acc[k] = (existing as Record<string, unknown>)[k] as boolean ??
        DEFAULT_PREFS[k];
      return acc;
    }, {} as PreferencesResponse);
  }
  await NotificationPreference.create({
    _id: userId,
    ...DEFAULT_PREFS,
    updated_at: new Date().toISOString(),
  });
  return { ...DEFAULT_PREFS };
}

export async function getFeed(
  offset: number,
  limit: number,
): Promise<FeedPage> {
  const userId = env.demoUserId;
  const capped = Math.min(Math.max(1, limit), PREVIEW_LIMIT);

  const [total, unreadCount, rows] = await Promise.all([
    Notification.countDocuments({ user_id: userId }),
    Notification.countDocuments({ user_id: userId, read: false }),
    Notification.find({ user_id: userId })
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(capped)
      .lean(),
  ]);

  const items = rows.map(mapNotification);
  const nextOffset = offset + items.length;
  return {
    items,
    total,
    unreadCount,
    hasMore: nextOffset < total,
    nextOffset,
  };
}

export async function getSummary(): Promise<NotificationSummary> {
  const userId = env.demoUserId;
  const [total, unreadCount] = await Promise.all([
    Notification.countDocuments({ user_id: userId }),
    Notification.countDocuments({ user_id: userId, read: false }),
  ]);
  return { unreadCount, total };
}

export async function markRead(id: string): Promise<NotificationSummary> {
  const userId = env.demoUserId;
  if (!id || typeof id !== 'string') {
    throw new NotificationError(400, 'Notification id is required');
  }
  const res = await Notification.updateOne(
    { _id: id, user_id: userId },
    { $set: { read: true } },
  );
  if (res.matchedCount === 0) {
    throw new NotificationError(404, 'Notification not found');
  }
  return getSummary();
}

export async function markAllRead(): Promise<NotificationSummary> {
  const userId = env.demoUserId;
  await Notification.updateMany(
    { user_id: userId, read: false },
    { $set: { read: true } },
  );
  return getSummary();
}

export async function getPreferences(): Promise<PreferencesResponse> {
  return ensureDefaultPreferences(env.demoUserId);
}

export async function updatePreferences(
  body: unknown,
): Promise<PreferencesResponse> {
  const userId = env.demoUserId;
  const input = (body ?? {}) as Record<string, unknown>;
  const current = await ensureDefaultPreferences(userId);

  const next: PreferencesResponse = { ...current };
  for (const key of PREF_KEYS) {
    if (key in input) {
      const v = input[key];
      if (typeof v !== 'boolean') {
        throw new NotificationError(400, `"${key}" must be a boolean`);
      }
      next[key] = v;
    }
  }

  await NotificationPreference.updateOne(
    { _id: userId },
    { $set: { ...next, updated_at: new Date().toISOString() } },
    { upsert: true },
  );
  return next;
}

export interface CreateNotificationInput {
  userId?: string; // defaults to env.demoUserId
  type: string; // 'BOOKING' | 'TRIP' | 'MESSAGE' | 'PROMO' | 'SYSTEM'
  title: string;
  body?: string;
  actionRoute?: string | null;
}

/**
 * Shared entry point for runtime-generated notifications. Inserts the in-app
 * inbox row AND (preference-gated, best-effort) fires an FCM push.
 *
 * NEVER throws — domain services (wallet/trips/orders) call this AFTER their
 * own DB mutation has committed, so a notification/push failure must not roll
 * back or 500 the originating request.
 */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<void> {
  try {
    const userId = input.userId ?? env.demoUserId;
    const id = randomUUID();
    const now = new Date().toISOString();

    await Notification.create({
      _id: id,
      user_id: userId,
      type: input.type,
      title: input.title,
      body: input.body ?? '',
      read: false,
      action_route: input.actionRoute ?? null,
      created_at: now,
    });

    // Preference gate: push transport is suppressed when the user turned
    // "Push Notifications" off, but the inbox row above is always kept.
    const prefs = await ensureDefaultPreferences(userId);
    if (!prefs.push) return;

    await sendPushToUser(userId, {
      type: input.type,
      title: input.title,
      body: input.body ?? '',
      actionRoute: input.actionRoute ?? null,
      notificationId: id,
    });
  } catch (err) {
    console.error('[notifications] createNotification failed', err);
  }
}
