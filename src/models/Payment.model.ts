import { Schema, model, InferSchemaType } from 'mongoose';

const paymentSchema = new Schema(
  {
    _id: { type: String, required: true },
    booking_id: { type: String },
    user_id: { type: String, required: true },
    payment_method: { type: String },
    amount: { type: Number },
    transaction_id: { type: String },
    status: { type: String },
    created_at: { type: String },
    updated_at: { type: String },
  },
  { collection: 'payments', versionKey: false, _id: false, strict: false },
);

export type PaymentDoc = InferSchemaType<typeof paymentSchema> & { _id: string };
export const Payment = model<PaymentDoc>('Payment', paymentSchema);
