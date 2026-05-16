import { Schema, model, InferSchemaType, Types } from 'mongoose';

const bookingSchema = new Schema(
  {
    _id: { type: Schema.Types.Mixed, required: true },
    user_id: { type: String },
    total_price: { type: Number, default: 0 },
    total_amount: { type: Number, default: 0 },
    discount_amount: { type: Number, default: 0 },
    final_amount: { type: Number, default: 0 },
    currency: { type: String, default: 'VND' },
    status: { type: String, default: 'PENDING' },
    created_at: { type: String },
    updated_at: { type: String },
    deleted_at: { type: String, default: null },
  },
  { collection: 'bookings', versionKey: false, strict: false },
);

export type BookingDoc = InferSchemaType<typeof bookingSchema> & {
  _id: Types.ObjectId | string | number;
};

export const Booking = model<BookingDoc>('Booking', bookingSchema);
