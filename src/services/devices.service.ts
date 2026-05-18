import { DeviceToken } from '@/models/DeviceToken.model';
import { NotificationError } from '@/services/notifications.service';

// Reuses NotificationError → 4xx (same controller error-mapping pattern as
// the notifications slice). Scoped to env.demoUserId (no auth yet).

export async function registerDeviceToken(
  userId: string,
  body: unknown,
): Promise<{ ok: true }> {
  const input = (body ?? {}) as Record<string, unknown>;
  const token = input.token;
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new NotificationError(400, 'token is required');
  }
  const platform =
    typeof input.platform === 'string' && input.platform.trim()
      ? input.platform.trim()
      : 'android';
  const now = new Date().toISOString();

  // _id IS the token → idempotent upsert; re-registering reassigns user_id.
  await DeviceToken.updateOne(
    { _id: token },
    {
      $set: { user_id: userId, platform, updated_at: now },
      $setOnInsert: { created_at: now },
    },
    { upsert: true },
  );
  return { ok: true };
}

export async function removeDeviceToken(
  body: unknown,
): Promise<{ ok: true }> {
  const input = (body ?? {}) as Record<string, unknown>;
  const token = input.token;
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new NotificationError(400, 'token is required');
  }
  await DeviceToken.deleteOne({ _id: token });
  return { ok: true };
}
