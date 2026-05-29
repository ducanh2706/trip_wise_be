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
    gross_amount: { type: Number, default: 0 },
    commission_rate: { type: Number, default: 0 },
    commission_amount: { type: Number, default: 0 },
    provider_net_amount: { type: Number, default: 0 },
    escrow_status: { type: String, default: 'NONE' },
    payout_request_id: { type: String, default: null },
    paid_to_provider_at: { type: String, default: null },
    item_status: { type: String, default: 'PENDING' },
    cancellation_previous_status: { type: String, default: null },
    cancellation_requested_at: { type: String, default: null },
    cancellation_requested_by: { type: String, default: null },
    cancellation_deadline: { type: String, default: null },
    cancellation_status: { type: String, default: null },
    cancellation_reviewed_at: { type: String, default: null },
    cancellation_reviewed_by: { type: String, default: null },
    refund_amount: { type: Number, default: 0 },
    refunded_at: { type: String, default: null },
    e_ticket_code: { type: String },
    cabin_class: { type: String, default: null },
    seat_numbers: { type: [String], default: undefined },
    airline_name: { type: String, default: null },
    created_at: { type: String },
    updated_at: { type: String },
  },
  { collection: 'booking_items', versionKey: false, _id: false, strict: false },
);

export type BookingItemDoc = InferSchemaType<typeof bookingItemSchema> & {
  _id: string;
};

export const BookingItem = model<BookingItemDoc>('BookingItem', bookingItemSchema);
