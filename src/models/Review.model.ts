import { Schema, model, InferSchemaType } from 'mongoose';

const reviewSchema = new Schema(
  {
    _id: { type: Number, required: true },
    hotel_id: { type: Number, required: true },
    booking_item_id: { type: String, default: null },
    user_id: { type: String, default: null },
    author_name: { type: String, required: true },
    author_image: { type: String, default: null },
    rating: { type: Number, required: true },
    comment: { type: String, required: true },
    trip_type: { type: String, default: null },
    created_at: { type: String },
    deleted_at: { type: String, default: null },
  },
  { collection: 'reviews', versionKey: false, _id: false },
);

export type ReviewDoc = InferSchemaType<typeof reviewSchema> & { _id: number };
export const Review = model<ReviewDoc>('Review', reviewSchema);
