import { DeviceToken } from '@/models/DeviceToken.model';
import { getMessagingOrNull, isFirebaseEnabled } from '@/config/firebase';

export interface PushPayload {
  type: string;
  title: string;
  body: string;
  actionRoute: string | null;
  notificationId: string;
  // Optional FCM collapse key. When set (e.g. one per chat conversation), FCM
  // keeps only the latest undelivered message per key while the device is
  // offline, and the client uses it as a stable tray id so a newer message
  // replaces the older one instead of stacking. Omit for one-off events.
  collapseKey?: string | null;
}

// FCM error codes that mean the token is permanently dead and should be
// removed from the registry so we stop sending to it.
const STALE_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
  'messaging/invalid-registration-token',
]);

/**
 * Best-effort FCM push to every device registered for `userId`.
 *
 * Never throws: a missing service account, Firebase outage, or bad token can
 * not break the caller (createNotification → wallet/trips/orders). The in-app
 * inbox row has already been written by the time this runs.
 *
 * Sends a DATA-ONLY message (no `notification` block) so the Flutter client
 * renders it uniformly in foreground/background/killed and always has
 * `action_route` for deep-linking.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<void> {
  try {
    if (!isFirebaseEnabled) return;
    const messaging = getMessagingOrNull();
    if (!messaging) return;

    const docs = await DeviceToken.find({ user_id: userId }).lean();
    const tokens = docs.map((d) => d._id);
    if (tokens.length === 0) return;

    const android: { priority: 'high'; collapseKey?: string } = {
      priority: 'high',
    };
    if (payload.collapseKey) android.collapseKey = payload.collapseKey;

    const res = await messaging.sendEachForMulticast({
      tokens,
      data: {
        type: payload.type,
        title: payload.title,
        body: payload.body,
        action_route: payload.actionRoute ?? '',
        notification_id: payload.notificationId,
        // Mirrored into data so the client can use it as a stable tray id/tag
        // (android.collapseKey above only governs FCM offline collapsing).
        collapse_key: payload.collapseKey ?? '',
      },
      android,
    });

    const stale: string[] = [];
    res.responses.forEach((r, i) => {
      if (!r.success && r.error && STALE_TOKEN_CODES.has(r.error.code)) {
        stale.push(tokens[i]);
      }
    });
    if (stale.length > 0) {
      await DeviceToken.deleteMany({ _id: { $in: stale } });
    }
  } catch (err) {
    console.error('[push] sendPushToUser failed', err);
  }
}
