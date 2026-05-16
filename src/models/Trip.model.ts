import { Schema, model, InferSchemaType } from 'mongoose';

// Itineraries for the demo user. Days + timed items are embedded (one doc =
// one whole timeline), matching scripts/backfill-trips.js. Loose schema so
// the embedded item shape can evolve without a migration.
const tripSchema = new Schema(
  {
    _id: { type: String, required: true },
    user_id: { type: String, required: true },
    title: { type: String, required: true },
    destination: { type: String },
    status: { type: String }, // ONGOING | UPCOMING | COMPLETED
    cover_image: { type: String, default: null },
    map_image: { type: String, default: null },
    start_date: { type: String },
    end_date: { type: String },
    days: { type: [Schema.Types.Mixed], default: [] },
    created_at: { type: String },
    updated_at: { type: String },
  },
  { collection: 'trips', versionKey: false, _id: false, strict: false },
);

export type TripDoc = InferSchemaType<typeof tripSchema> & { _id: string };
export const Trip = model<TripDoc>('Trip', tripSchema);
