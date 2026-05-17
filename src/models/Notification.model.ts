import { Schema, model, InferSchemaType } from 'mongoose';

// Per-user notification feed. Mock data seeded by scripts/backfill-notifications.js
// (real trips / payments / activities of the demo user). No push/email delivery —
// this is the in-app inbox only.
//
// type: 'BOOKING' | 'TRIP' | 'MESSAGE' | 'PROMO' | 'SYSTEM'
// action_route: optional in-app deep link (a GoRouter path the FE can navigate to).
const notificationSchema = new Schema(
  {
    _id: { type: String, required: true },
    user_id: { type: String, required: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    read: { type: Boolean, default: false },
    action_route: { type: String, default: null },
    created_at: { type: String },
  },
  { collection: 'notifications', versionKey: false, _id: false, strict: false },
);

export type NotificationDoc = InferSchemaType<typeof notificationSchema> & {
  _id: string;
};
export const Notification = model<NotificationDoc>(
  'Notification',
  notificationSchema,
);
