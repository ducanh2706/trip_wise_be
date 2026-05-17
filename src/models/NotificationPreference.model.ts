import { Schema, model, InferSchemaType } from 'mongoose';

// One doc per user (`_id` IS the user id, so it is naturally idempotent — see
// ensureDefaultPreferences in notifications.service.ts, mirrors the wallet
// slice's ensureDefaultCard). Channel + category opt-in flags shown on the
// Notifications settings screen. Not wired to any real push/email transport.
const notificationPreferenceSchema = new Schema(
  {
    _id: { type: String, required: true }, // = user_id
    push: { type: Boolean, default: true },
    email: { type: Boolean, default: true },
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
