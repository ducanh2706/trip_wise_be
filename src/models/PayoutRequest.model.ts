import { InferSchemaType, Schema, model } from 'mongoose';

const payoutRequestSchema = new Schema(
  {
    _id: { type: String, required: true },
    provider_id: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'VND' },
    status: { type: String, default: 'PENDING' },
    requested_at: { type: String },
    scheduled_for: { type: String },
    paid_at: { type: String, default: null },
    note: { type: String, default: null },
    gross_amount: { type: Number, default: 0 },
    commission_amount: { type: Number, default: 0 },
    commission_rate: { type: Number, default: 0 },
    period: { type: String, default: null },
    period_start: { type: String, default: null },
    period_end: { type: String, default: null },
    paid_by: { type: String, default: null },
    booking_item_ids: { type: [String], default: [] },
  },
  { collection: 'provider_payout_requests', versionKey: false, _id: false },
);

export type PayoutRequestDoc = InferSchemaType<typeof payoutRequestSchema> & {
  _id: string;
};

export const PayoutRequest = model<PayoutRequestDoc>('PayoutRequest', payoutRequestSchema);
