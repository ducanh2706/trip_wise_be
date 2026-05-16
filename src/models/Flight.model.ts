import { Schema, model, InferSchemaType } from 'mongoose';

const flightSchema = new Schema(
  {
    _id: { type: Number, required: true },
    provider_id: { type: String, required: true },
    flight_number: { type: String, required: true },
    departure_airport: { type: String, required: true },
    arrival_airport: { type: String, required: true },
    departure_time: { type: String, required: true },
    arrival_time: { type: String, required: true },
    base_price: { type: Number, required: true },
    available_seats: { type: Number },
    image: { type: String, default: null },
    created_at: { type: String },
    updated_at: { type: String },
    deleted_at: { type: String, default: null },
  },
  { collection: 'flights', versionKey: false, _id: false, strict: false },
);

export type FlightDoc = InferSchemaType<typeof flightSchema> & { _id: number };
export const Flight = model<FlightDoc>('Flight', flightSchema);
