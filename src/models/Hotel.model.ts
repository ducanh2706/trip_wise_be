import { Schema, model, InferSchemaType } from 'mongoose';

const hotelSchema = new Schema(
  {
    _id: { type: Number, required: true },
    provider_id: { type: String, required: true },
    location_id: { type: Number, required: true },
    name: { type: String, required: true },
    address: { type: String, required: true },
    star_rating: { type: Number, required: true },
    latitude: { type: Number },
    longitude: { type: Number },
    status: { type: String },
    listing_status: { type: String, default: null },
    listing_category: { type: String, default: null },
    image: { type: String },
    images: { type: [String], default: undefined },
    description: { type: String, default: null },
    amenities: { type: [String], default: undefined },
    bedrooms: { type: Number, default: null },
    bathrooms: { type: Number, default: null },
    max_guests: { type: Number, default: null },
    analytics_views: { type: Number, default: 0 },
    google_map_url: { type: String, default: null },
    created_at: { type: String },
    updated_at: { type: String },
    deleted_at: { type: String, default: null },
  },
  { collection: 'hotels', versionKey: false, _id: false },
);

export type HotelDoc = InferSchemaType<typeof hotelSchema> & { _id: number };
export const Hotel = model<HotelDoc>('Hotel', hotelSchema);
