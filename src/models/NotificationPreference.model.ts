import { Schema, model, InferSchemaType } from 'mongoose';

// One doc per user (`_id` IS the user id, so it is naturally idempotent — see
// ensureDefaultPreferences in notifications.service.ts, mirrors the wallet
// slice's ensureDefaultCard). `push` is the FCM channel master switch; the
// remaining flags gate per-category push delivery. Inbox rows are written
// regardless — the inbox is always a complete log.
//
// `email` was removed 2026-05-26 (no email transport exists; the field was
// dead weight). With `strict: false`, any legacy `email: true` value on an
// existing doc is simply ignored at read time. Re-add the field if/when an
// email transport ships.
const notificationPreferenceSchema = new Schema(
  {
    _id: { type: String, required: true }, // = user_id
    push: { type: Boolean, default: true },
    tripReminders: { type: Boolean, default: true },
    bookingUpdates: { type: Boolean, default: true },
    messages: { type: Boolean, default: true },
    promotions: { type: Boolean, default: false },
    updated_at: { type: String },
  },
  {
    collection: 'notification_preferences',
    versionKey: false,
    _id: false,
    strict: false,
  },
);

export type NotificationPreferenceDoc = InferSchemaType<
  typeof notificationPreferenceSchema
> & { _id: string };
export const NotificationPreference = model<NotificationPreferenceDoc>(
  'NotificationPreference',
  notificationPreferenceSchema,
);
