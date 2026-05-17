import { Schema, model, InferSchemaType } from 'mongoose';

// FCM device-token registry. `_id` IS the token: a token is globally unique,
// so upsert-by-token is naturally idempotent and re-registering a token (e.g.
// on a shared device) cleanly reassigns `user_id` — no auth needed. Mirrors
// NotificationPreference's id-as-key pattern.
const deviceTokenSchema = new Schema(
  {
    _id: { type: String, required: true }, // = FCM token
    user_id: { type: String, required: true },
    platform: { type: String, default: 'android' },
    created_at: { type: String },
    updated_at: { type: String },
  },
  { collection: 'device_tokens', versionKey: false, _id: false, strict: false },
);

export type DeviceTokenDoc = InferSchemaType<typeof deviceTokenSchema> & {
  _id: string;
};
export const DeviceToken = model<DeviceTokenDoc>(
  'DeviceToken',
  deviceTokenSchema,
);
