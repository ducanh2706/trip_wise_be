import { Schema, model, InferSchemaType } from 'mongoose';

const activitySchema = new Schema(
  {
    _id: { type: Number, required: true },
    provider_id: { type: String, required: true },
    location_id: { type: Number, required: true },
    title: { type: String, required: true },
    type: { type: String, required: true },
    base_price: { type: Number, required: true },
    status: { type: String },
    image: { type: String, default: null },
    // Added by scripts/backfill-activities.js (Add Activity screen).
    category: { type: String, default: null }, // FOOD|SIGHTSEEING|TRANSPORT|OUTDOORS
    rating: { type: Number, default: null },
    description: { type: String, default: null },
    created_at: { type: String },
    updated_at: { type: String },
    deleted_at: { type: String, default: null },
  },
  { collection: 'activities', versionKey: false, _id: false, strict: false },
);

export type ActivityDoc = InferSchemaType<typeof activitySchema> & { _id: number };
export const Activity = model<ActivityDoc>('Activity', activitySchema);
