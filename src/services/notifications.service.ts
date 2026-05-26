import { randomUUID } from 'node:crypto';
import { Notification } from '@/models/Notification.model';
import { NotificationPreference } from '@/models/NotificationPreference.model';
import { sendPushToUser } from '@/services/push.service';

// In-app inbox + per-user preferences. Scoped to req.auth.userId from the
// controller layer (see notifications.controller.ts).

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
  // Cursor (= last item's created_at ISO string) for the next page. Null when
  // the feed is exhausted. Stable under concurrent inserts — unlike skip/limit,
  // a new notification arriving mid-scroll cannot duplicate or skip rows.
  nextCursor: string | null;
}

export interface NotificationSummary {
  unreadCount: number;
  total: number;
}

export interface PreferencesResponse {
  push: boolean;
  tripReminders: boolean;
  bookingUpdates: boolean;
  messages: boolean;
  promotions: boolean;
}

const PREF_KEYS: (keyof PreferencesResponse)[] = [
  'push',
  'tripReminders',
  'bookingUpdates',
  'messages',
  'promotions',
];

const DEFAULT_PREFS: PreferencesResponse = {
  push: true,
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
  userId: string,
  before: string | null,
  limit: number,
): Promise<FeedPage> {
  const capped = Math.min(Math.max(1, limit), PREVIEW_LIMIT);

  const findFilter: Record<string, unknown> = { user_id: userId };
  if (before) {
    findFilter.created_at = { $lt: before };
  }

  const [total, unreadCount, rows] = await Promise.all([
    Notification.countDocuments({ user_id: userId }),
    Notification.countDocuments({ user_id: userId, read: false }),
    Notification.find(findFilter)
      .sort({ created_at: -1 })
      .limit(capped)
      .lean(),
  ]);

  const items = rows.map(mapNotification);
  // Cursor = the oldest row in this page; the client passes it back as
  // `before` to fetch the next page.
  const nextCursor =
    items.length === capped ? items[items.length - 1].createdAt || null : null;
  return {
    items,
    total,
    unreadCount,
    hasMore: nextCursor !== null,
    nextCursor,
  };
}

export async function getSummary(userId: string): Promise<NotificationSummary> {
  const [total, unreadCount] = await Promise.all([
    Notification.countDocuments({ user_id: userId }),
    Notification.countDocuments({ user_id: userId, read: false }),
  ]);
  return { unreadCount, total };
}

export async function markRead(
  userId: string,
  id: string,
): Promise<NotificationSummary> {
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
  return getSummary(userId);
}

export async function markAllRead(userId: string): Promise<NotificationSummary> {
  await Notification.updateMany(
    { user_id: userId, read: false },
    { $set: { read: true } },
  );
  return getSummary(userId);
}

export async function getPreferences(
  userId: string,
): Promise<PreferencesResponse> {
  return ensureDefaultPreferences(userId);
}

export async function updatePreferences(
  userId: string,
  body: unknown,
): Promise<PreferencesResponse> {
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
  userId: string;
  type: string; // 'BOOKING' | 'TRIP' | 'MESSAGE' | 'PROMO' | 'SYSTEM'
  title: string;
  body?: string;
  actionRoute?: string | null;
  // Optional deterministic id. Pass when the caller needs idempotency — e.g.
  // a scheduled reminder ("trip starts tomorrow") that may fire if the worker
  // restarts mid-day, or a per-event notification that must not duplicate on
  // retry. A duplicate insert raises Mongo E11000 which createNotification
  // silently swallows.
  id?: string;
}

// Push-suppression map: when the user toggles off the matching category, FCM
// delivery is skipped (the inbox row is still written — the inbox stays a
// complete log). SYSTEM is always allowed: it covers transactional confirms
// (top-up, withdraw, VIP upgrade) that the user shouldn't be able to mute.
const TYPE_TO_PREF: Record<string, keyof PreferencesResponse | null> = {
  TRIP: 'tripReminders',
  BOOKING: 'bookingUpdates',
  MESSAGE: 'messages',
  PROMO: 'promotions',
  SYSTEM: null,
};

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
    const userId = input.userId;
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();

    try {
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
    } catch (insertErr) {
      // E11000 duplicate key — caller passed a deterministic id and this
      // notification was already created. No-op: the inbox row exists, the
      // user has already (or will already) be pushed. Treat any other insert
      // error as a real failure.
      if ((insertErr as { code?: number }).code === 11000) return;
      throw insertErr;
    }

    // Preference gates apply ONLY to FCM transport — the inbox row above is
    // always written so the user has a complete history. Two gates run:
    //   1. `push` channel — global off-switch for banners.
    //   2. category flag (TRIP/BOOKING/MESSAGE/PROMO) — per-type opt-out.
    // SYSTEM bypasses the category gate (transactional confirms).
    const prefs = await ensureDefaultPreferences(userId);
    if (!prefs.push) return;
    const categoryFlag = TYPE_TO_PREF[input.type];
    if (categoryFlag !== null && categoryFlag !== undefined && !prefs[categoryFlag]) {
      return;
    }

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
