import { Schema, model, InferSchemaType } from 'mongoose';

const airportSchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    location_id: { type: Number, required: true },
    created_at: { type: String },
    updated_at: { type: String },
  },
  { collection: 'airports', versionKey: false, _id: false, strict: false },
);

export type AirportDoc = InferSchemaType<typeof airportSchema> & { _id: string };
export const Airport = model<AirportDoc>('Airport', airportSchema);
