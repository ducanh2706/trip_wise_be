import { Schema, model, InferSchemaType } from 'mongoose';

const bookingItemSchema = new Schema(
  {
    _id: { type: String, required: true },
    booking_id: { type: String, required: true },
    provider_id: { type: String, required: true },
    room_id: { type: Number, default: null },
    flight_id: { type: Number, default: null },
    activity_id: { type: Number, default: null },
    start_date: { type: String },
    end_date: { type: String },
    quantity: { type: Number, default: 1 },
    price_per_unit: { type: Number, default: 0 },
    total_price: { type: Number, default: 0 },
    item_status: { type: String, default: 'PENDING' },
    e_ticket_code: { type: String },
    created_at: { type: String },
    updated_at: { type: String },
  },
  { collection: 'booking_items', versionKey: false, _id: false, strict: false },
);

export type BookingItemDoc = InferSchemaType<typeof bookingItemSchema> & {
  _id: string;
};

export const BookingItem = model<BookingItemDoc>('BookingItem', bookingItemSchema);
